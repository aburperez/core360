/**
 * Envio de e-mail (por enquanto só o "Esqueci minha senha"). Em produção usa o
 * Resend (https://resend.com) pela API HTTP, sem biblioteca: basta a chave
 * RESEND_API_KEY na Vercel e o domínio do remetente confirmado lá. Sem a
 * chave, o envio fica desligado e a tela avisa.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(msg: EmailMessage): Promise<void>;
}

/** Remetente padrão; o domínio precisa estar confirmado no Resend. */
export const DEFAULT_FROM = "CORE 360 <nao-responda@core360prod.com.br>";

export function resendMailer(cfg: { apiKey: string; from?: string; fetch?: typeof fetch }): Mailer {
  const doFetch = cfg.fetch ?? fetch;
  return {
    async send(msg) {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: cfg.from || DEFAULT_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(`Resend ${res.status}: ${json.message ?? "erro desconhecido"}`);
      }
    },
  };
}

/** Desenvolvimento: só mostra no terminal (sem o link, que vale como senha). */
export function logMailer(): Mailer {
  return {
    async send(msg) {
      console.info("[email:log]", msg.to, msg.subject);
    },
  };
}

/** Testes: guarda o que seria enviado. */
export function memoryMailer() {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(msg: EmailMessage) {
      sent.push(msg);
    },
  };
}

const cache = globalThis as unknown as { mailer?: Mailer };

function driver() {
  return process.env.EMAIL_DRIVER ?? (process.env.RESEND_API_KEY ? "resend" : "off");
}

export function emailEnabled() {
  return driver() !== "off" || !!cache.mailer;
}

export function getMailer(): Mailer | null {
  if (cache.mailer) return cache.mailer;
  const d = driver();
  if (d === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("Defina RESEND_API_KEY");
    cache.mailer = resendMailer({ apiKey, from: process.env.EMAIL_FROM });
  } else if (d === "log") {
    cache.mailer = logMailer();
  } else {
    return null;
  }
  return cache.mailer;
}

export function setMailerForTests(m: Mailer | undefined) {
  cache.mailer = m;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** O e-mail com o link para criar a senha nova. */
export function resetPasswordEmail(p: { to: string; name: string; url: string }): EmailMessage {
  const first = p.name.trim().split(/\s+/)[0] || "";
  const hello = first ? `Olá, ${first}.` : "Olá.";
  const text = [
    hello,
    "",
    "Recebemos um pedido para criar uma nova senha para a sua conta no CORE 360.",
    "Abra o link abaixo para escolher a senha nova:",
    p.url,
    "",
    "O link vale 1 hora e só pode ser usado uma vez.",
    "Se não foi você, ignore este e-mail: sua senha continua a mesma.",
  ].join("\n");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#031C28;font-family:Arial,Helvetica,sans-serif;color:#F1F6F7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#031C28;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#043246;border-radius:16px;padding:32px">
<tr><td style="font-size:22px;font-weight:bold;color:#FFFFFF">CORE<span style="color:#00E5ED">360</span></td></tr>
<tr><td style="padding-top:24px;font-size:16px;line-height:1.5">${esc(hello)}</td></tr>
<tr><td style="padding-top:8px;font-size:16px;line-height:1.5">Recebemos um pedido para criar uma nova senha para a sua conta no CORE 360.</td></tr>
<tr><td style="padding:24px 0"><a href="${esc(p.url)}" style="display:inline-block;background:#00E5ED;color:#043246;font-weight:bold;font-size:16px;text-decoration:none;padding:14px 24px;border-radius:12px">Criar nova senha</a></td></tr>
<tr><td style="font-size:14px;line-height:1.5;color:#B8CDD3">O link vale 1 hora e só pode ser usado uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.</td></tr>
</table></td></tr></table></body></html>`;
  return { to: p.to, subject: "Criar uma nova senha no CORE 360", html, text };
}

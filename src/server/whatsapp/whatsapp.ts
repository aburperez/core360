import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Envio pelo WhatsApp usando a API oficial (WhatsApp Business Cloud API, Meta).
 * Mensagens que o sistema inicia precisam ser "modelos" aprovados pela Meta
 * (veja docs/whatsapp.md). Respostas a um botão podem ser texto livre.
 */

/** Aviso com botão "Abrir no app". */
export const TEMPLATE_ALERT = "core360_alerta";
/** Mesmo aviso, com o botão "Assumir" antes do "Abrir no app". */
export const TEMPLATE_ALERT_CLAIM = "core360_alerta_assumir";

export interface TemplateMessage {
  /** Telefone em E.164 (+5511987654321). */
  to: string;
  template: typeof TEMPLATE_ALERT | typeof TEMPLATE_ALERT_CLAIM;
  /** Parâmetros do corpo, na ordem {{1}}, {{2}}, ... */
  body: string[];
  /** Final da URL do botão "Abrir no app" (o modelo tem a base fixa). */
  urlSuffix: string;
  /** Payload assinado do botão "Assumir" (só no modelo com esse botão). */
  claimPayload?: string;
}

export interface WhatsApp {
  sendTemplate(msg: TemplateMessage): Promise<{ id: string }>;
  sendText(to: string, text: string): Promise<void>;
}

/** O WhatsApp recusa quebras de linha, tabs e espaços em sequência nos parâmetros. */
export function cleanParam(value: string, max = 120): string {
  const s = value.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s || "-";
}

export function templatePayload(msg: TemplateMessage) {
  const components: unknown[] = [
    { type: "body", parameters: msg.body.map((text) => ({ type: "text", text: cleanParam(text) })) },
  ];
  let index = 0;
  if (msg.template === TEMPLATE_ALERT_CLAIM) {
    if (!msg.claimPayload) throw new Error("Modelo com Assumir precisa do payload assinado");
    components.push({ type: "button", sub_type: "quick_reply", index: String(index++), parameters: [{ type: "payload", payload: msg.claimPayload }] });
  }
  components.push({ type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text: msg.urlSuffix }] });
  return {
    messaging_product: "whatsapp",
    to: msg.to.replace(/\D/g, ""),
    type: "template",
    template: { name: msg.template, language: { code: "pt_BR" }, components },
  };
}

export function cloudWhatsApp(cfg: { token: string; phoneNumberId: string; apiVersion?: string; fetch?: typeof fetch }): WhatsApp {
  const url = `https://graph.facebook.com/${cfg.apiVersion ?? "v21.0"}/${cfg.phoneNumberId}/messages`;
  const doFetch = cfg.fetch ?? fetch;
  async function post(payload: unknown) {
    const res = await doFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${json.error?.message ?? "erro desconhecido"}`);
    return json;
  }
  return {
    async sendTemplate(msg) {
      const json = await post(templatePayload(msg));
      return { id: json.messages?.[0]?.id ?? "" };
    },
    async sendText(to, text) {
      await post({ messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "text", text: { body: text, preview_url: false } });
    },
  };
}

/** Desenvolvimento: só mostra no terminal. */
export function logWhatsApp(): WhatsApp {
  let n = 0;
  return {
    async sendTemplate(msg) {
      console.info("[whatsapp:log]", JSON.stringify(templatePayload(msg)));
      return { id: `log-${++n}` };
    },
    async sendText(to, text) {
      console.info("[whatsapp:log]", to, text);
    },
  };
}

/** Testes: guarda o que seria enviado. `fail` simula a API fora do ar. */
export function memoryWhatsApp() {
  const templates: TemplateMessage[] = [];
  const texts: { to: string; text: string }[] = [];
  let n = 0;
  const wa = {
    templates,
    texts,
    fail: false,
    async sendTemplate(msg: TemplateMessage) {
      if (wa.fail) throw new Error("WhatsApp fora do ar (simulado)");
      templatePayload(msg); // valida o formato
      templates.push(msg);
      return { id: `wamid.mem-${++n}` };
    },
    async sendText(to: string, text: string) {
      texts.push({ to, text });
    },
  };
  return wa;
}

const disabled: WhatsApp = {
  async sendTemplate() {
    throw new Error("WhatsApp desligado (WHATSAPP_DRIVER=off)");
  },
  async sendText() {},
};

const cache = globalThis as unknown as { whatsapp?: WhatsApp };

export function whatsappEnabled() {
  return (process.env.WHATSAPP_DRIVER ?? "off") !== "off" || !!cache.whatsapp;
}

export function getWhatsApp(): WhatsApp {
  if (cache.whatsapp) return cache.whatsapp;
  const driver = process.env.WHATSAPP_DRIVER ?? "off";
  if (driver === "cloud") {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) throw new Error("Defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID");
    cache.whatsapp = cloudWhatsApp({ token, phoneNumberId, apiVersion: process.env.WHATSAPP_API_VERSION });
  } else if (driver === "log") {
    cache.whatsapp = logWhatsApp();
  } else {
    return disabled;
  }
  return cache.whatsapp;
}

export function setWhatsAppForTests(wa: WhatsApp | undefined) {
  cache.whatsapp = wa;
}

/** Confere a assinatura X-Hub-Signature-256 que a Meta manda em cada webhook. */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

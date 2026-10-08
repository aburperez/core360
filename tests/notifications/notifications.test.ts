import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createHmac } from "node:crypto";
import { actorFor, appDb, authDb, demo, expectPgError, ownerDb, workerDb, type Person } from "../helpers";
import { dispatch, processOutbox, scanSla, scanUrgentReminders, sendPending } from "@/modules/notifications/dispatcher";
import { handleWhatsAppWebhook } from "@/modules/notifications/whatsapp-webhook";
import {
  getWhatsappSettings, listNotifications, markOccurrenceRead, markRead, setWhatsappSettings,
} from "@/modules/notifications/notifications.service";
import {
  changeStatus, concludeOccurrence, createOccurrence, getOccurrence, reassignOccurrence, validateOccurrence,
} from "@/modules/occurrences/occurrences.service";
import { createInvitation, createParticipant } from "@/modules/participants/participants.service";
import { acceptInvitation } from "@/server/auth/invitations";
import { loadActor } from "@/server/authz/actor";
import { signClaim } from "@/server/whatsapp/actions";
import {
  memoryWhatsApp, TEMPLATE_ALERT, TEMPLATE_ALERT_CLAIM, verifyWebhookSignature,
} from "@/server/whatsapp/whatsapp";
import { normalizePhone } from "@/lib/phone";

/**
 * Etapa 9: avisos no app e no WhatsApp. O despacho roda com o papel
 * core_worker; o WhatsApp é simulado em memória. Urgente vai para o WhatsApp
 * só do encarregado da área, com novo alerta a cada 5 minutos sem resposta.
 */

process.env.WHATSAPP_ACTION_SECRET = "s".repeat(40);
process.env.APP_URL = "https://core360.test";

const d = demo();
const owner = ownerDb();
const app = appDb();
const worker = workerDb();
const auth$ = authDb();
const wa = memoryWhatsApp();
const deps = { db: worker, whatsapp: wa };

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), worker.$disconnect(), auth$.$disconnect()]);
});

const nameOf = new Map(Object.entries(d.users).filter(([, id]) => id).map(([k, id]) => [id as string, k]));

/** Quem recebeu avisos deste chamado (por tipo), pelo nome da demo. */
async function recipients(occurrenceId: string, type?: string) {
  const rows = await owner.notification.findMany({ where: { occurrenceId, ...(type && { type: type as never }) } });
  return rows.map((r) => nameOf.get(r.userId) ?? r.userId).sort();
}

async function newOccurrence(by: Person, data: Record<string, unknown>) {
  const actor = await actorFor(app, by);
  return createOccurrence(actor, { title: `Teste ${Math.random().toString(36).slice(2, 7)}`, ...data });
}

const phones: Partial<Record<Person, string>> = {
  joao: "(11) 98888-0001",
  rafael: "(11) 98888-0002",
  claudia: "(11) 98888-0003",
  pedro: "(11) 98888-0004",
};

beforeAll(async () => {
  // Limpa o que a carga inicial deixou na fila, para cada teste ver só o seu.
  await dispatch({ db: worker, whatsapp: null });
  for (const [person, phone] of Object.entries(phones)) {
    await setWhatsappSettings(await actorFor(app, person as Person), { phone, enabled: true });
  }
});

describe("quem é avisado", () => {
  it("chamado urgente sem responsável: Gerente, Head da área e a equipe. Mais ninguém", async () => {
    const o = await newOccurrence("carlos", { teamId: d.teams.eletrica.id, priority: "CRITICA" });
    await dispatch(deps);
    // Carlos abriu, então não é avisado. Inativo, Cliente, outra área e outro evento ficam de fora.
    // O admin da demonstração é diretor de produção da agência, então é Gerente no evento.
    expect(await recipients(o.id, "URGENTE")).toEqual(["admin", "joao", "marina", "pedro", "rafael"]);

    // Todo destinatário consegue abrir o chamado pelas regras normais do sistema.
    for (const userId of (await owner.notification.findMany({ where: { occurrenceId: o.id } })).map((n) => n.userId)) {
      const actor = await loadActor(app, userId);
      await expect(getOccurrence(actor!, o.id)).resolves.toMatchObject({ id: o.id });
    }
  });

  it("rodar o despacho de novo não repete nenhum aviso", async () => {
    const o = await newOccurrence("carlos", { teamId: d.teams.eletrica.id, status: "URGENTE" });
    await dispatch(deps);
    const before = await owner.notification.count({ where: { occurrenceId: o.id } });
    const sent = wa.templates.length;
    await dispatch(deps);
    await dispatch(deps);
    expect(await owner.notification.count({ where: { occurrenceId: o.id } })).toBe(before);
    expect(wa.templates.length).toBe(sent);
  });

  it("atribuir avisa só o novo responsável", async () => {
    const o = await newOccurrence("rafael", { teamId: d.teams.eletrica.id });
    await dispatch(deps);
    await reassignOccurrence(await actorFor(app, "rafael"), o.id, { responsibleParticipantId: d.participants.joao.id });
    await dispatch(deps);
    expect(await recipients(o.id, "ATRIBUIDA")).toEqual(["joao"]);
  });

  it("chamado normal sem responsável avisa a equipe, só no app", async () => {
    const o = await newOccurrence("rafael", { teamId: d.teams.cenografia.id });
    const sent = wa.templates.length;
    await dispatch(deps);
    expect(await recipients(o.id, "NOVA")).toEqual(["ana", "bruno"]);
    expect(wa.templates.length).toBe(sent);
  });

  it("bloqueio avisa Gerente e Head; concluir pede validação ao Head; reprovar avisa o responsável", async () => {
    const o = await newOccurrence("rafael", { teamId: d.teams.eletrica.id, responsibleParticipantId: d.participants.joao.id });
    const joao = await actorFor(app, "joao");
    await changeStatus(joao, o.id, { status: "BLOQUEIO" });
    await dispatch(deps);
    expect(await recipients(o.id, "BLOQUEIO")).toEqual(["admin", "marina", "rafael"]);

    await concludeOccurrence(joao, o.id);
    await dispatch(deps);
    expect(await recipients(o.id, "CONCLUIDA")).toEqual(["rafael"]);

    await validateOccurrence(await actorFor(app, "rafael"), o.id, { approved: false });
    await dispatch(deps);
    expect(await recipients(o.id, "REPROVADA")).toEqual(["joao"]);
  });

  it("SLA perto de vencer e vencido, uma vez cada", async () => {
    const o = await newOccurrence("marina", {
      teamId: d.teams.eletrica.id, priority: "ALTA", responsibleParticipantId: d.participants.joao.id,
    });
    await dispatch(deps);
    const due = (await owner.occurrence.findUniqueOrThrow({ where: { id: o.id } })).slaDueAt!;

    await scanSla({ ...deps, now: () => new Date(due.getTime() - 30 * 60_000) });
    expect(await recipients(o.id, "SLA_PROXIMO")).toEqual([]);

    const soon = () => new Date(due.getTime() - 60_000);
    await scanSla({ ...deps, now: soon });
    await scanSla({ ...deps, now: soon });
    expect(await recipients(o.id, "SLA_PROXIMO")).toEqual(["joao", "rafael"]);

    await scanSla({ ...deps, now: () => new Date(due.getTime() + 60_000) });
    expect(await recipients(o.id, "SLA_ESTOURADO")).toEqual(["admin", "joao", "marina", "rafael"]);
  });

  it("chamado concluído não gera aviso de SLA", async () => {
    const o = await newOccurrence("rafael", { teamId: d.teams.eletrica.id, responsibleParticipantId: d.participants.joao.id });
    await concludeOccurrence(await actorFor(app, "joao"), o.id);
    const due = (await owner.occurrence.findUniqueOrThrow({ where: { id: o.id } })).slaDueAt!;
    await scanSla({ ...deps, now: () => new Date(due.getTime() + 60_000) });
    expect(await recipients(o.id, "SLA_ESTOURADO")).toEqual([]);
  });
});

describe("WhatsApp", () => {
  async function urgentWithWhatsApp() {
    const o = await newOccurrence("carlos", { teamId: d.teams.eletrica.id, status: "URGENTE" });
    const from = wa.templates.length;
    await dispatch(deps);
    const msgs = wa.templates.slice(from).filter((m) => m.urlSuffix === o.id);
    return { o, msgs };
  }

  /** SLA perto de vencer num chamado sem responsável: a equipe recebe, com o botão Assumir. */
  async function slaWithWhatsApp() {
    const o = await newOccurrence("rafael", { teamId: d.teams.eletrica.id, priority: "ALTA" });
    await dispatch(deps);
    const due = (await owner.occurrence.findUniqueOrThrow({ where: { id: o.id } })).slaDueAt!;
    const from = wa.templates.length;
    await scanSla({ ...deps, now: () => new Date(due.getTime() - 60_000) });
    await sendPending(deps);
    const msgs = wa.templates.slice(from).filter((m) => m.urlSuffix === o.id);
    return { o, msgs };
  }

  it("urgente vai para o WhatsApp só do encarregado da área, com o botão Abrir no app", async () => {
    const { o, msgs } = await urgentWithWhatsApp();
    // João e Pedro (equipe) também aceitaram o WhatsApp, mas o urgente fica no app para eles.
    expect(msgs.map((m) => [m.to, m.template])).toEqual([[normalizePhone(phones.rafael)!, TEMPLATE_ALERT]]);
    expect(msgs[0].body).toEqual(["Chamado urgente", String(o.number), o.title, "Elétrica · Infraestrutura"]);
    expect(msgs[0].claimPayload).toBeUndefined();
    expect(await recipients(o.id, "URGENTE")).toEqual(["admin", "joao", "marina", "pedro", "rafael"]);
    const deliveries = await owner.notificationDelivery.findMany({ where: { notification: { occurrenceId: o.id } } });
    expect(deliveries.map((x) => [x.toPhone, x.status])).toEqual([[normalizePhone(phones.rafael)!, "ENVIADO"]]);
  });

  it("área sem Head: o encarregado é o Gerente", async () => {
    const marina = await actorFor(app, "marina");
    await setWhatsappSettings(marina, { phone: "(11) 98888-0005", enabled: true });
    await owner.participant.update({ where: { id: d.participants.rafael.id }, data: { active: false } });
    try {
      const { msgs } = await urgentWithWhatsApp();
      expect(msgs.map((m) => m.to)).toEqual(["+5511988880005"]);
    } finally {
      await owner.participant.update({ where: { id: d.participants.rafael.id }, data: { active: true } });
      await setWhatsappSettings(marina, { enabled: false });
    }
  });

  it("SLA sem responsável: só quem aceitou recebe; Operacional que pode assumir ganha o botão Assumir", async () => {
    const { o, msgs } = await slaWithWhatsApp();
    const byPhone = Object.fromEntries(msgs.map((m) => [m.to, m.template]));
    expect(byPhone).toEqual({
      [normalizePhone(phones.joao)!]: TEMPLATE_ALERT_CLAIM,
      [normalizePhone(phones.pedro)!]: TEMPLATE_ALERT_CLAIM,
      [normalizePhone(phones.rafael)!]: TEMPLATE_ALERT,
    });
    // Cláudia (Cliente) nem recebe o aviso.
    expect(msgs.every((m) => m.to !== normalizePhone(phones.claudia))).toBe(true);
    expect(msgs[0].body[0]).toBe("SLA perto de estourar");
    expect(msgs[0].body[1]).toBe(String(o.number));
  });

  it("Assumir pelo WhatsApp: funciona uma vez, só do número que recebeu, e fica no histórico", async () => {
    const { o, msgs } = await slaWithWhatsApp();
    const toJoao = msgs.find((m) => m.to === normalizePhone(phones.joao))!;
    const button = (payload: string, from: string) => ({
      entry: [{ changes: [{ value: { messages: [{ from, type: "button", button: { payload, text: "Assumir" } }] } }] }],
    });
    const joaoDigits = normalizePhone(phones.joao)!.slice(1);
    const pedroDigits = normalizePhone(phones.pedro)!.slice(1);
    const wdeps = { worker, app, whatsapp: wa };

    // Payload adulterado: ignorado em silêncio.
    const tampered = toJoao.claimPayload!.slice(0, -2) + (toJoao.claimPayload!.endsWith("AA") ? "BB" : "AA");
    expect(await handleWhatsAppWebhook(button(tampered, joaoDigits), wdeps)).toEqual(["assinatura-invalida"]);
    // Payload certo, mas vindo de outro número (ex.: mensagem encaminhada).
    expect(await handleWhatsAppWebhook(button(toJoao.claimPayload!, pedroDigits), wdeps)).toEqual(["numero-diferente"]);
    expect((await owner.occurrence.findUniqueOrThrow({ where: { id: o.id } })).responsibleParticipantId).toBeNull();

    expect(await handleWhatsAppWebhook(button(toJoao.claimPayload!, joaoDigits), wdeps)).toEqual(["assumido"]);
    const after = await owner.occurrence.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.responsibleParticipantId).toBe(d.participants.joao.id);
    expect(wa.texts.at(-1)?.text).toContain(`#${o.number} agora é seu`);
    const log = await owner.auditLog.findFirst({ where: { entityId: o.id, action: "REASSIGN" }, orderBy: { id: "desc" } });
    expect(log).toMatchObject({ actorUserId: d.users.joao, userAgent: expect.stringContaining("WhatsApp") });

    // Segundo toque: o botão já foi usado.
    expect(await handleWhatsAppWebhook(button(toJoao.claimPayload!, joaoDigits), wdeps)).toEqual(["ja-usado"]);

    // Pedro tenta assumir o mesmo chamado pelo botão dele: já tem responsável.
    const toPedro = msgs.find((m) => m.to === normalizePhone(phones.pedro))!;
    expect(await handleWhatsAppWebhook(button(toPedro.claimPayload!, pedroDigits), wdeps)).toEqual(["recusado"]);
    expect((await owner.occurrence.findUniqueOrThrow({ where: { id: o.id } })).responsibleParticipantId).toBe(d.participants.joao.id);
  });

  it("botão assinado para um envio não serve para outro", async () => {
    const { msgs } = await slaWithWhatsApp();
    const toJoao = msgs.find((m) => m.to === normalizePhone(phones.joao))!;
    const otherId = "00000000-0000-4000-8000-000000000000";
    const mac = toJoao.claimPayload!.split(":")[2];
    const forged = `claim:${otherId}:${mac}`;
    const r = await handleWhatsAppWebhook(
      { entry: [{ changes: [{ value: { messages: [{ from: "5511988880001", type: "button", button: { payload: forged } }] } }] }] },
      { worker, app, whatsapp: wa },
    );
    expect(r).toEqual(["assinatura-invalida"]);
    expect(signClaim(otherId)).not.toBe(forged);
  });

  it("quem foi desativado não assume pelo WhatsApp", async () => {
    const { msgs } = await slaWithWhatsApp();
    const toPedro = msgs.find((m) => m.to === normalizePhone(phones.pedro))!;
    await owner.user.update({ where: { id: d.users.pedro! }, data: { active: false } });
    try {
      const r = await handleWhatsAppWebhook(
        { entry: [{ changes: [{ value: { messages: [{ from: normalizePhone(phones.pedro)!.slice(1), type: "button", button: { payload: toPedro.claimPayload } }] } }] }] },
        { worker, app, whatsapp: wa },
      );
      expect(r).toEqual(["inativo"]);
    } finally {
      await owner.user.update({ where: { id: d.users.pedro! }, data: { active: true } });
    }
  });

  it("falha no envio: tenta de novo mais tarde e desiste depois de 4 vezes", async () => {
    const o = await newOccurrence("carlos", { teamId: d.teams.eletrica.id, status: "URGENTE" });
    await processOutbox(deps);
    const target = await owner.notificationDelivery.findFirstOrThrow({
      where: { notification: { occurrenceId: o.id, user: { id: d.users.rafael! } } },
    });
    wa.fail = true;
    try {
      let t = Date.now();
      for (let i = 1; i <= 4; i++) {
        await sendPending({ ...deps, now: () => new Date(t) });
        const row = await owner.notificationDelivery.findUniqueOrThrow({ where: { id: target.id } });
        expect(row.attempts).toBe(i);
        expect(row.status).toBe(i < 4 ? "PENDENTE" : "FALHOU");
        expect(row.lastError).toContain("fora do ar");
        t = row.nextAttemptAt.getTime() + 1000;
      }
    } finally {
      wa.fail = false;
    }
  });

  it("aviso já lido no app não vai para o WhatsApp", async () => {
    const o = await newOccurrence("carlos", { teamId: d.teams.eletrica.id, status: "URGENTE" });
    await processOutbox(deps);
    const rafael = await actorFor(app, "rafael");
    const mine = (await listNotifications(rafael)).items.filter((n) => n.occurrenceId === o.id).map((n) => n.id);
    await markRead(rafael, { ids: mine });
    await sendPending(deps);
    const delivery = await owner.notificationDelivery.findFirstOrThrow({
      where: { notification: { occurrenceId: o.id, userId: d.users.rafael! } },
    });
    expect(delivery.status).toBe("IGNORADO");
  });

  it("desligar o WhatsApp para os envios na hora", async () => {
    const rafael = await actorFor(app, "rafael");
    await setWhatsappSettings(rafael, { enabled: false });
    try {
      const { msgs } = await urgentWithWhatsApp();
      expect(msgs.some((m) => m.to === normalizePhone(phones.rafael))).toBe(false);
      expect(await getWhatsappSettings(rafael)).toEqual({ phone: normalizePhone(phones.rafael), enabled: false });
    } finally {
      await setWhatsappSettings(rafael, { phone: phones.rafael, enabled: true });
    }
  });

  it("assinatura do webhook da Meta", () => {
    const secret = "segredo-do-app";
    const raw = JSON.stringify({ entry: [] });
    const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyWebhookSignature(raw, sig, secret)).toBe(true);
    expect(verifyWebhookSignature(raw + " ", sig, secret)).toBe(false);
    expect(verifyWebhookSignature(raw, sig, "outro")).toBe(false);
    expect(verifyWebhookSignature(raw, null, secret)).toBe(false);
  });
});

describe("urgente sem resposta", () => {
  const rafaelPhone = normalizePhone(phones.rafael)!;

  /** Abre um urgente e devolve uma função que simula o despacho `min` minutos depois do aviso. */
  async function urgent() {
    const o = await newOccurrence("carlos", { teamId: d.teams.eletrica.id, status: "URGENTE" });
    await dispatch(deps);
    const first = await owner.notification.findFirstOrThrow({ where: { occurrenceId: o.id, userId: d.users.rafael!, type: "URGENTE" } });
    const later = async (min: number) => {
      const now = () => new Date(first.createdAt.getTime() + min * 60_000);
      const from = wa.templates.length;
      await scanUrgentReminders({ ...deps, now });
      await sendPending({ ...deps, now });
      return wa.templates.slice(from).filter((m) => m.urlSuffix === o.id);
    };
    return { o, later };
  }

  it("encarregado que não abre o chamado recebe novo alerta a cada 5 minutos, até 3 vezes", async () => {
    const { o, later } = await urgent();
    expect(await later(4)).toEqual([]);

    const first = await later(5);
    expect(first.map((m) => [m.to, m.template])).toEqual([[rafaelPhone, TEMPLATE_ALERT]]);
    expect(first[0].body).toEqual(["Urgente sem resposta", String(o.number), o.title, "Sem resposta há 5 min · Elétrica · Infraestrutura"]);
    // Rodar de novo na mesma janela não repete.
    expect(await later(7)).toEqual([]);

    expect((await later(10)).map((m) => m.body[3])).toEqual(["Sem resposta há 10 min · Elétrica · Infraestrutura"]);
    expect((await later(15)).length).toBe(1);
    expect(await later(20)).toEqual([]);
    // Só o encarregado recebe lembrete; a equipe e o Gerente não.
    expect(await recipients(o.id, "LEMBRETE")).toEqual(["rafael", "rafael", "rafael"]);
  });

  it("abrir o chamado (pelo botão do WhatsApp ou pelo app) para os lembretes", async () => {
    const { o, later } = await urgent();
    expect((await later(5)).length).toBe(1);
    expect(await markOccurrenceRead(await actorFor(app, "rafael"), o.id)).toEqual({ updated: 2 });
    expect(await later(10)).toEqual([]);
    expect(await later(15)).toEqual([]);
  });

  it("mexer no chamado também conta como resposta", async () => {
    const { o, later } = await urgent();
    await reassignOccurrence(await actorFor(app, "rafael"), o.id, { responsibleParticipantId: d.participants.joao.id });
    expect(await later(5)).toEqual([]);
  });

  it("chamado resolvido por outra pessoa para os lembretes", async () => {
    const { o, later } = await urgent();
    await reassignOccurrence(await actorFor(app, "marina"), o.id, { responsibleParticipantId: d.participants.joao.id });
    expect((await later(5)).length).toBe(1);
    await concludeOccurrence(await actorFor(app, "joao"), o.id);
    expect(await later(10)).toEqual([]);
  });

  it("o lembrete respeita o desligamento do WhatsApp, mas continua no app", async () => {
    const rafael = await actorFor(app, "rafael");
    const { o, later } = await urgent();
    await setWhatsappSettings(rafael, { enabled: false });
    try {
      expect(await later(5)).toEqual([]);
      expect(await recipients(o.id, "LEMBRETE")).toEqual(["rafael"]);
    } finally {
      await setWhatsappSettings(rafael, { phone: phones.rafael, enabled: true });
    }
  });
});

describe("rotas", () => {
  it("webhook sem assinatura válida é recusado antes de qualquer coisa", async () => {
    process.env.WHATSAPP_APP_SECRET = "segredo-do-app";
    process.env.WHATSAPP_VERIFY_TOKEN = "token-de-verificacao";
    const route = await import("@/app/api/whatsapp/webhook/route");
    const res = await route.POST(new Request("http://x/api/whatsapp/webhook", {
      method: "POST", body: JSON.stringify({ entry: [] }), headers: { "x-hub-signature-256": "sha256=00" },
    }));
    expect(res.status).toBe(401);

    const ok = await route.GET(new Request("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token-de-verificacao&hub.challenge=42"));
    expect(await ok.text()).toBe("42");
    const bad = await route.GET(new Request("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42"));
    expect(bad.status).toBe(403);
  });

  it("cron exige o segredo", async () => {
    const route = await import("@/app/api/cron/dispatch/route");
    delete process.env.CRON_SECRET;
    expect((await route.GET(new Request("http://x/api/cron/dispatch"))).status).toBe(503);
    process.env.CRON_SECRET = "c".repeat(32);
    process.env.WORKER_DATABASE_URL = inject("workerUrl");
    expect((await route.GET(new Request("http://x/api/cron/dispatch", { headers: { authorization: "Bearer errado" } }))).status).toBe(401);
    const ok = await route.GET(new Request("http://x/api/cron/dispatch", { headers: { authorization: `Bearer ${"c".repeat(32)}` } }));
    expect(ok.status).toBe(200);
    // A rota usa a conexão global do despacho; fecha para o banco de teste poder ser apagado.
    await (await import("@/server/db/client")).workerPrisma().$disconnect();
  });
});

describe("isolamento no banco", () => {
  it("cada um lê só os próprios avisos", async () => {
    const joao = await actorFor(app, "joao");
    const { items } = await listNotifications(joao);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((n) => n.id)).toBe(true);
    const others = await joao.run((tx) => tx.notification.count({ where: { userId: d.users.rafael! } }));
    expect(others).toBe(0);
    // Marcar como lido um aviso de outra pessoa não faz nada.
    const rafaelNote = await owner.notification.findFirstOrThrow({ where: { userId: d.users.rafael!, readAt: null } });
    expect(await markRead(joao, { ids: [rafaelNote.id] })).toEqual({ updated: 0 });
  });

  it("o app não cria avisos nem altera o texto de um aviso", async () => {
    const joao = await actorFor(app, "joao");
    await expectPgError(
      joao.run((tx) => tx.$executeRaw`INSERT INTO notifications (id, user_id, event_id, type, title)
        VALUES (gen_random_uuid(), ${d.users.marina}::uuid, ${d.events.rock.id}::uuid, 'URGENTE', 'falso')`),
      "42501",
    );
    const mine = await owner.notification.findFirstOrThrow({ where: { userId: d.users.joao! } });
    await expectPgError(joao.run((tx) => tx.$executeRaw`UPDATE notifications SET title = 'x' WHERE id = ${mine.id}::uuid`), "42501");
  });

  it("o app não lê a fila nem os envios; ninguém mexe no WhatsApp de outro", async () => {
    const joao = await actorFor(app, "joao");
    await expectPgError(joao.run((tx) => tx.$queryRaw`SELECT 1 FROM occurrence_changes LIMIT 1`), "42501");
    await expectPgError(joao.run((tx) => tx.$queryRaw`SELECT 1 FROM notification_deliveries LIMIT 1`), "42501");
    expect(await joao.run((tx) => tx.whatsappContact.count({ where: { userId: d.users.rafael! } }))).toBe(0);
    await expectPgError(
      joao.run((tx) => tx.$executeRaw`INSERT INTO whatsapp_contacts (user_id, phone, opted_in_at)
        VALUES (${d.users.marina}::uuid, '+5511999990000', now())`),
      "42501",
    );
  });

  it("o despacho não lê senhas, sessões nem fotos, e não apaga nada", async () => {
    await expectPgError(worker.$queryRaw`SELECT 1 FROM accounts LIMIT 1`, "42501");
    await expectPgError(worker.$queryRaw`SELECT 1 FROM sessions LIMIT 1`, "42501");
    await expectPgError(worker.$queryRaw`SELECT 1 FROM attachments LIMIT 1`, "42501");
    await expectPgError(worker.$executeRaw`DELETE FROM notifications`, "42501");
    await expectPgError(worker.$executeRaw`UPDATE occurrences SET title = 'x'`, "42501");
  });
});

describe("aceite no convite e telefone", () => {
  it("quem aceita o WhatsApp no convite já fica cadastrado", async () => {
    const marina = await actorFor(app, "marina");
    const email = `whats-${Math.random().toString(36).slice(2, 8)}@rockfestival.dev`;
    const p = await createParticipant(marina, {
      eventId: d.events.rock.id, name: "Zeca", email, phone: "11 97777-1234", role: "OPERACIONAL", teamId: d.teams.estrutura.id,
    });
    const inv = await createInvitation(marina, p.id);
    const r = await acceptInvitation(auth$, { token: inv.token, password: "senha-boa-1", whatsapp: { phone: "11 97777-1234", enabled: true } });
    const contact = await owner.whatsappContact.findUniqueOrThrow({ where: { userId: r.userId } });
    expect(contact.phone).toBe("+5511977771234");
    expect(contact.optedInAt).not.toBeNull();
  });

  it("normaliza telefones brasileiros e recusa lixo", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe("+5511987654321");
    expect(normalizePhone("011 98765-4321")).toBe("+5511987654321");
    expect(normalizePhone("+1 415 555 0100")).toBe("+14155550100");
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("o mesmo aviso não vai duas vezes nem com despachos simultâneos", async () => {
    const o = await newOccurrence("carlos", { teamId: d.teams.eletrica.id, status: "URGENTE" });
    const from = wa.templates.length;
    await Promise.all([dispatch(deps), dispatch(deps), dispatch(deps)]);
    const msgs = wa.templates.slice(from).filter((m) => m.urlSuffix === o.id);
    expect(msgs.map((m) => m.to)).toEqual([normalizePhone(phones.rafael)!]);
    expect(await owner.notification.count({ where: { occurrenceId: o.id, type: "URGENTE" } })).toBe(5);
  });
});


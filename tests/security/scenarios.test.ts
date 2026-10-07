import { afterAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectStatus } from "../helpers";
import { getEvent, listEvents } from "@/modules/events/events.service";
import { listAreas, createArea } from "@/modules/areas/areas.service";
import { createTeam, getTeam, listTeams } from "@/modules/teams/teams.service";
import { createParticipant, listParticipants, updateParticipant } from "@/modules/participants/participants.service";
import {
  concludeOccurrence,
  createOccurrence,
  getOccurrence,
  listOccurrences,
} from "@/modules/occurrences/occurrences.service";
import { loadActor } from "@/server/authz/actor";

/**
 * Os 10 cenários obrigatórios do briefing (item 27), pela camada de serviço:
 * é exatamente o caminho que a API e as telas usam. A mesma checagem direto
 * no banco, sem o backend, está em rls.test.ts; e pela API HTTP, em api.test.ts.
 */

const db = appDb();
const d = demo();
afterAll(() => db.$disconnect());

const ids = <T extends { id: string }>(xs: T[]) => xs.map((x) => x.id);
const uniq = () => Math.random().toString(36).slice(2, 8);

describe("Cenário 1: Gerente acessa o próprio evento", () => {
  it("vê tudo do evento: áreas, equipes, participantes e ocorrências de todas as áreas", async () => {
    const marina = await actorFor(db, "marina");
    const event = await getEvent(marina, d.events.rock.id);
    expect(event.myRole).toBe("GERENTE");

    expect(ids(await listAreas(marina, d.events.rock.id))).toEqual(
      expect.arrayContaining([d.areas.infra.id, d.areas.ab.id]),
    );
    expect(ids(await listTeams(marina, d.events.rock.id))).toEqual(
      expect.arrayContaining(Object.values(d.teams).filter((t) => t.eventId === d.events.rock.id).map((t) => t.id)),
    );
    const people = ids(await listParticipants(marina, d.events.rock.id));
    expect(people).toEqual(expect.arrayContaining([d.participants.joao.id, d.participants.beatriz.id, d.participants.ana.id]));

    const occ = ids(await listOccurrences(marina, d.events.rock.id));
    expect(occ).toEqual(
      expect.arrayContaining([d.occurrences.quadroEletrico.id, d.occurrences.painelCenografia.id, d.occurrences.chopeira.id]),
    );
    const detail = await getOccurrence(marina, d.occurrences.chopeira.id);
    expect(detail.can.manage).toBe(true);
  });
});

describe("Cenário 2: Gerente tenta acessar outro evento", () => {
  it("é negado em todas as portas (evento, listas e ocorrência por ID)", async () => {
    const marina = await actorFor(db, "marina");
    const other = d.events.congresso.id;

    expect(ids(await listEvents(marina))).not.toContain(other);
    await expectStatus(getEvent(marina, other), 404);
    await expectStatus(listOccurrences(marina, other), 404);
    await expectStatus(listParticipants(marina, other), 404);
    await expectStatus(listAreas(marina, other), 404);
    await expectStatus(getOccurrence(marina, d.occurrences.congressoTomada.id), 404);
    await expectStatus(getTeam(marina, d.teams.congressoEletrica.id), 404);
    await expectStatus(
      createOccurrence(marina, { teamId: d.teams.congressoEletrica.id, title: "Intrusa" }),
      404,
    );
  });
});

describe("Cenário 3: Head de Infra acessa Infra", () => {
  it("vê equipes, participantes e ocorrências de toda a Infra", async () => {
    const rafael = await actorFor(db, "rafael");
    const teams = ids(await listTeams(rafael, d.events.rock.id));
    expect(teams.sort()).toEqual([d.teams.eletrica.id, d.teams.estrutura.id, d.teams.cenografia.id].sort());

    const people = ids(await listParticipants(rafael, d.events.rock.id));
    expect(people).toEqual(expect.arrayContaining([d.participants.joao.id, d.participants.ana.id, d.participants.marcos.id]));

    const occ = ids(await listOccurrences(rafael, d.events.rock.id));
    expect(occ).toEqual(expect.arrayContaining([d.occurrences.quadroEletrico.id, d.occurrences.painelCenografia.id]));
    expect((await getOccurrence(rafael, d.occurrences.painelCenografia.id)).can.manage).toBe(true);

    const team = await createTeam(rafael, { areaId: d.areas.infra.id, name: `Iluminação ${uniq()}` });
    expect(team.areaId).toBe(d.areas.infra.id);
  });
});

describe("Cenário 4: Head de Infra tenta acessar A&B", () => {
  it("não vê nada interno de A&B e não consegue gravar lá", async () => {
    const rafael = await actorFor(db, "rafael");
    const rock = d.events.rock.id;

    await expectStatus(getOccurrence(rafael, d.occurrences.chopeira.id), 404);
    expect(await listOccurrences(rafael, rock, { areaId: d.areas.ab.id })).toEqual([]);
    expect(ids(await listOccurrences(rafael, rock))).not.toContain(d.occurrences.chopeira.id);
    expect(await listTeams(rafael, rock, d.areas.ab.id)).toEqual([]);
    expect(ids(await listParticipants(rafael, rock))).not.toContain(d.participants.beatriz.id);
    await expectStatus(getTeam(rafael, d.teams.bar.id), 404);

    await expectStatus(createOccurrence(rafael, { teamId: d.teams.bar.id, title: "Intrusa" }), 404);
    await expectStatus(createTeam(rafael, { areaId: d.areas.ab.id, name: "Equipe intrusa" }), 403);
    await expectStatus(
      createParticipant(rafael, {
        eventId: rock, name: "Intruso", email: `intruso-${uniq()}@x.dev`, role: "OPERACIONAL", teamId: d.teams.bar.id,
      }),
      404,
    );
  });
});

describe("Cenário 5: Operacional da Elétrica acessa Elétrica", () => {
  it("vê a equipe e as ocorrências dela, abre e conclui chamado atribuído a ele", async () => {
    const joao = await actorFor(db, "joao");
    const rock = d.events.rock.id;

    expect(ids(await listTeams(joao, rock))).toEqual([d.teams.eletrica.id]);
    expect(ids(await listOccurrences(joao, rock))).toContain(d.occurrences.quadroEletrico.id);
    const people = ids(await listParticipants(joao, rock));
    expect(people).toEqual(expect.arrayContaining([d.participants.carlos.id, d.participants.pedro.id]));

    const mine = await createOccurrence(joao, {
      teamId: d.teams.eletrica.id, title: "Extensão danificada no camarim",
      responsibleParticipantId: d.participants.joao.id, priority: "ALTA",
    });
    expect(mine.eventId).toBe(rock);
    expect(mine.slaDueAt).not.toBeNull();

    const done = await concludeOccurrence(joao, mine.id);
    expect(done.status).toBe("CONCLUIDO");
    expect(done.concludedById).toBe(d.users.joao);
    expect(done.durationSeconds).toBeGreaterThanOrEqual(0);

    const detail = await getOccurrence(joao, mine.id);
    expect(detail.can.conclude).toBe(false);
    expect(detail.history.map((h) => h.action)).toEqual(["CREATE", "CONCLUDE"]);
  });
});

describe("Cenário 6: Operacional da Elétrica tenta acessar Cenografia", () => {
  it("não vê a ocorrência, a equipe nem as pessoas da Cenografia", async () => {
    const joao = await actorFor(db, "joao");
    const rock = d.events.rock.id;

    await expectStatus(getOccurrence(joao, d.occurrences.painelCenografia.id), 404);
    expect(await listOccurrences(joao, rock, { teamId: d.teams.cenografia.id })).toEqual([]);
    await expectStatus(getTeam(joao, d.teams.cenografia.id), 404);
    expect(ids(await listParticipants(joao, rock))).not.toContain(d.participants.ana.id);
    await expectStatus(createOccurrence(joao, { teamId: d.teams.cenografia.id, title: "Intrusa" }), 404);
    // E muito menos A&B.
    await expectStatus(getOccurrence(joao, d.occurrences.chopeira.id), 404);
    expect(ids(await listAreas(joao, rock))).toEqual([d.areas.infra.id]);
  });

  it("no OUTRO evento o mesmo João é Head e vê a Infra de lá (papel por evento)", async () => {
    const joao = await actorFor(db, "joao");
    expect((await getEvent(joao, d.events.congresso.id)).myRole).toBe("HEAD");
    expect(ids(await listOccurrences(joao, d.events.congresso.id))).toContain(d.occurrences.congressoTomada.id);
  });

  it("não pode concluir chamado da própria equipe atribuído a outra pessoa", async () => {
    const carlos = await actorFor(db, "carlos");
    const detail = await getOccurrence(carlos, d.occurrences.quadroEletrico.id);
    expect(detail.can.conclude).toBe(false);
    await expectStatus(concludeOccurrence(carlos, d.occurrences.quadroEletrico.id), 403);
  });
});

describe("Cenário 7: Cliente só olha", () => {
  it("não cria área, equipe nem pessoas", async () => {
    const claudia = await actorFor(db, "claudia");
    const rock = d.events.rock.id;
    await expectStatus(createArea(claudia, { eventId: rock, name: `Credenciamento ${uniq()}` }), 403);
    await expectStatus(createTeam(claudia, { areaId: d.areas.infra.id, name: "Portaria" }), [403, 404]);
    await expectStatus(
      createParticipant(claudia, { eventId: rock, name: "Fernanda", email: `fernanda-${uniq()}@rockfestival.dev`, role: "OPERACIONAL", teamId: d.teams.eletrica.id }),
      [403, 404],
    );
    await expectStatus(updateParticipant(claudia, d.participants.pedro.id, { active: false }), [403, 404]);
  });

  it("cliente não vê ocorrências enquanto o andamento não for liberado", async () => {
    const claudia = await actorFor(db, "claudia");
    expect(await listOccurrences(claudia, d.events.rock.id)).toEqual([]);
    await expectStatus(getOccurrence(claudia, d.occurrences.quadroEletrico.id), 404);
  });
});

describe("Cenário 8: Cliente tenta criar Admin (e outras escaladas)", () => {
  const base = () => ({ eventId: d.events.rock.id, name: "Escalada", email: `esc-${uniq()}@x.dev` });

  it("ADMIN não é um papel aceito, e o Cliente não cadastra ninguém", async () => {
    const claudia = await actorFor(db, "claudia");
    await expectStatus(createParticipant(claudia, { ...base(), role: "ADMIN" }), 422);
    await expectStatus(createParticipant(claudia, { ...base(), role: "CLIENTE", isAdmin: true }), 403);
    // Campo extra "isAdmin" é descartado; não existe privilégio global por participante.
    const p = await createParticipant(await actorFor(db, "marina"), { ...base(), role: "CLIENTE", isAdmin: true });
    expect(p).not.toHaveProperty("isAdmin");
  });

  it("Cliente não cria Gerente nem Head", async () => {
    const claudia = await actorFor(db, "claudia");
    await expectStatus(createParticipant(claudia, { ...base(), role: "GERENTE" }), 403);
    await expectStatus(createParticipant(claudia, { ...base(), role: "HEAD", areaId: d.areas.infra.id }), [403, 404]);
  });

  it("Cliente não promove um Operacional a Head", async () => {
    const claudia = await actorFor(db, "claudia");
    await expectStatus(updateParticipant(claudia, d.participants.pedro.id, { role: "HEAD" }), [403, 404]);
  });

  it("ninguém altera a própria participação", async () => {
    const claudia = await actorFor(db, "claudia");
    await expectStatus(updateParticipant(claudia, d.participants.claudia.id, { role: "GERENTE" }), 403);
    const rafael = await actorFor(db, "rafael");
    await expectStatus(updateParticipant(rafael, d.participants.rafael.id, { areaId: d.areas.ab.id }), 403);
  });

  it("Head só cadastra Operacional na própria área; Gerente não cria Gerente", async () => {
    const rafael = await actorFor(db, "rafael");
    await expectStatus(createParticipant(rafael, { ...base(), role: "HEAD", areaId: d.areas.infra.id }), 403);
    const ok = await createParticipant(rafael, { ...base(), role: "OPERACIONAL", teamId: d.teams.estrutura.id });
    expect(ok.role).toBe("OPERACIONAL");

    const marina = await actorFor(db, "marina");
    await expectStatus(createParticipant(marina, { ...base(), role: "GERENTE" }), 403);
  });
});

describe("Cenário 9: Usuário inativo tenta acessar", () => {
  it("o backend não monta o usuário (equivale a não autenticado)", async () => {
    expect(await loadActor(db, d.users.inativo!)).toBeNull();
  });

  it("participação desativada some do escopo imediatamente", async () => {
    const owner = (await import("../helpers")).ownerDb();
    const temp = await owner.user.create({ data: { email: `temp-${uniq()}@x.dev`, name: "Temp" } });
    const p = await owner.participant.create({
      data: {
        eventId: d.events.rock.id, userId: temp.id, name: "Temp", email: temp.email,
        role: "OPERACIONAL", areaId: d.areas.infra.id, teamId: d.teams.eletrica.id,
      },
    });
    const before = await loadActor(db, temp.id);
    expect(before!.memberships).toHaveLength(1);

    const marina = await actorFor(db, "marina");
    await updateParticipant(marina, p.id, { active: false });
    const after = await loadActor(db, temp.id);
    expect(after!.memberships).toHaveLength(0);
    await expectStatus(listOccurrences(after!, d.events.rock.id), 404);
    await owner.$disconnect();
  });
});

describe("Cenário 10 (serviço): IDs forjados não ampliam o acesso", () => {
  it("campos controlados pelo servidor são ignorados ou recusados", async () => {
    const joao = await actorFor(db, "joao");
    const o = await createOccurrence(joao, {
      teamId: d.teams.eletrica.id, title: "Forjando campos",
      // tudo abaixo vem "do navegador" e não pode valer:
      eventId: d.events.congresso.id, areaId: d.areas.ab.id, clientId: d.clients.saude.id,
      createdById: d.users.admin, number: 1, concludedAt: new Date(),
    });
    expect(o).toMatchObject({
      eventId: d.events.rock.id, areaId: d.areas.infra.id, clientId: d.clients.rock.id,
      createdById: d.users.joao, status: "PENDENTE", concludedAt: null,
    });
    // Abrir já "concluído" é recusado.
    await expectStatus(
      createOccurrence(joao, { teamId: d.teams.eletrica.id, title: "X", status: "CONCLUIDO" }),
      422,
    );
  });

  it("responsável de outro evento é recusado", async () => {
    const marina = await actorFor(db, "marina");
    await expectStatus(
      createOccurrence(marina, {
        teamId: d.teams.eletrica.id, title: "X", responsibleParticipantId: d.participants.paulo.id,
      }),
      422,
    );
  });

  it("ID que não é UUID responde 404, sem erro interno", async () => {
    const marina = await actorFor(db, "marina");
    await expectStatus(getOccurrence(marina, "1 OR 1=1"), 404);
    await expectStatus(getEvent(marina, "../../etc"), 404);
  });
});

describe("contatos e assumir chamado", () => {
  it("Operacional vê o Head da própria área e o Gerente, mas não o Head de outra área", async () => {
    const joao = await actorFor(db, "joao");
    const people = ids(await listParticipants(joao, d.events.rock.id));
    expect(people).toEqual(expect.arrayContaining([d.participants.rafael.id, d.participants.marina.id]));
    expect(people).not.toContain(d.participants.beatriz.id);
    expect(people).not.toContain(d.participants.ana.id);
    expect(people).not.toContain(d.participants.claudia.id);
  });

  it("Operacional assume chamado livre da própria equipe, e não o de outra", async () => {
    const { claimOccurrence } = await import("@/modules/occurrences/occurrences.service");
    const rafael = await actorFor(db, "rafael");
    const free = await createOccurrence(rafael, { teamId: d.teams.eletrica.id, title: "Sem dono" });
    const carlos = await actorFor(db, "carlos");
    expect((await getOccurrence(carlos, free.id)).can.claim).toBe(true);
    const claimed = await claimOccurrence(carlos, free.id);
    expect(claimed).toMatchObject({ responsibleParticipantId: d.participants.carlos.id, status: "EM_ANDAMENTO" });
    // Já tem dono: ninguém mais "assume".
    await expectStatus(claimOccurrence(await actorFor(db, "pedro"), free.id), 403);
    // Agora o Carlos pode concluir.
    expect((await concludeOccurrence(carlos, free.id)).status).toBe("CONCLUIDO");

    const other = await createOccurrence(rafael, { teamId: d.teams.cenografia.id, title: "Outra equipe" });
    await expectStatus(claimOccurrence(carlos, other.id), 404);
  });

  it("Operacional vê o nome de quem abriu o chamado", async () => {
    const joao = await actorFor(db, "joao");
    const o = await getOccurrence(joao, d.occurrences.quadroEletrico.id);
    expect(o.createdBy?.name).toBe("Rafael Head Infra");
  });
});

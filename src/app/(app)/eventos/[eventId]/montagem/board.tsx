import type { listArrivals } from "@/modules/arrivals/arrivals.service";
import { ARRIVAL_STATUS } from "@/modules/arrivals/arrival-meta";
import { dayText, weekday } from "@/modules/schedule/schedule-meta";
import { toLocalInput } from "@/lib/tz";
import { Panel } from "@/components/panel";
import { EmptyState, cx } from "@/components/ui";
import { ArrivalDialog, StatusButtons } from "./actions";

type Data = Awaited<ReturnType<typeof listArrivals>>;

const hm = (d: Date, timeZone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** O mapa de montagem, por dia: a Pré-produção edita; o campo marca o status. */
export function ArrivalsBoard({ data, eventId }: { data: Data; eventId: string }) {
  const tz = data.timezone;
  const groups = [...data.days.map((d) => ({ key: d, items: data.items.filter((i) => i.day === d) })), { key: null, items: data.items.filter((i) => !i.day) }]
    .filter((g) => g.items.length > 0);
  const t = data.totals;
  const stats = [
    { label: "Chegadas", value: t.total, tone: "border-border bg-surface" },
    { label: "Chegaram", value: t.arrived, tone: "border-border bg-surface" },
    { label: "Montadas", value: t.done, tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
    { label: "Atrasadas", value: t.late, tone: t.late ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-border bg-surface" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={cx("rounded-2xl border p-3", s.tone)}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</p>
            <p className="text-2xl font-bold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>
      {groups.length === 0 ? (
        <EmptyState title="Nenhuma chegada ainda">
          {data.can.edit ? "Quando um contrato é assinado, o fornecedor aparece aqui. Você também pode criar uma chegada." : "Quando a Pré-produção marcar as chegadas da sua área, elas aparecem aqui."}
        </EmptyState>
      ) : (
        groups.map((g) => (
          <Panel
            key={g.key ?? "sem"}
            title={g.key ? `${g.key === data.today ? "Hoje · " : ""}${weekday(g.key)} ${dayText(g.key)} (${g.items.length})` : `Sem horário (${g.items.length})`}
            className={cx(g.key === data.today && "border-brand-cyan/40")}
          >
            <ul className="divide-y divide-border/60">
              {g.items.map((a) => (
                <li key={a.id} className={cx("flex items-start gap-3 py-3", a.late && "rounded-xl bg-red-500/5")}>
                  <div className="w-14 shrink-0 text-right sm:w-16">
                    <p className={cx("text-lg font-bold tabular-nums", a.late ? "text-red-300" : "text-foreground")}>{a.scheduledAt ? hm(a.scheduledAt, tz) : "—"}</p>
                    {a.endsAt && <p className="text-xs text-muted tabular-nums">até {hm(a.endsAt, tz)}</p>}
                  </div>
                  <div className="min-w-0 flex-1 lg:flex lg:items-start lg:gap-4">
                    <div className="min-w-0 lg:flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{a.supplierName}</span>
                        <span className={cx("rounded-full px-2 py-0.5 text-xs font-bold", ARRIVAL_STATUS[a.status].tone)}>{ARRIVAL_STATUS[a.status].label}</span>
                        {a.late && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-300">{a.late}</span>}
                      </p>
                      <p className="text-sm text-muted">{[a.area ?? "Sem área", a.responsible ?? "Sem responsável"].join(" · ")}</p>
                      {(a.vehicle || a.plate || a.dock || a.driver) && (
                        <p className="text-sm">
                          {[a.vehicle, a.plate, a.dock && `Doca: ${a.dock}`].filter(Boolean).join(" · ")}
                          {a.driver && (
                            <span className="text-muted">
                              {(a.vehicle || a.plate || a.dock) && " · "}Motorista {a.driver}
                              {a.driverPhone && <> · <a href={`tel:${a.driverPhone}`} className="text-primary underline">{a.driverPhone}</a></>}
                            </span>
                          )}
                        </p>
                      )}
                      {a.items.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {a.items.map((i) => (
                            <span key={i.id} className="rounded-lg bg-white/5 px-2 py-0.5 text-xs">
                              {i.name}{i.quantity !== null && <span className="text-muted"> · {i.quantity.toLocaleString("pt-BR")} {i.unit ?? "un"}</span>}
                            </span>
                          ))}
                        </p>
                      )}
                      {a.notes && <p className="mt-1 text-sm text-muted">{a.notes}</p>}
                      {a.arrivedAt && (
                        <p className="mt-1 text-xs text-muted">
                          Chegou {g.key === null || a.day !== g.key ? `${dayText(toLocalInput(a.arrivedAt, tz).slice(0, 10))} ` : ""}às {hm(a.arrivedAt, tz)}{a.arrivedBy && ` · marcado por ${a.arrivedBy}`}
                          {a.status !== "CHEGOU" && a.statusAt && <> · {ARRIVAL_STATUS[a.status].label} às {hm(a.statusAt, tz)}</>}
                        </p>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 lg:mt-0 lg:shrink-0 lg:justify-end">
                      <StatusButtons id={a.id} status={a.status} supplier={a.supplierName} />
                      {data.can.edit && (
                        <ArrivalDialog
                            eventId={eventId} areas={data.areas} people={data.people} costItems={data.costItems}
                            initial={{
                              id: a.id, supplierName: a.supplierName,
                              scheduledAt: a.scheduledAt ? toLocalInput(a.scheduledAt, tz) : "", endsAt: a.endsAt ? toLocalInput(a.endsAt, tz) : "",
                              vehicle: a.vehicle ?? "", plate: a.plate ?? "", driver: a.driver ?? "", driverPhone: a.driverPhone ?? "", dock: a.dock ?? "",
                              areaId: a.areaId ?? "", responsibleId: a.responsibleId ?? "", notes: a.notes ?? "",
                              itemIds: a.items.flatMap((i) => (i.costItemId ? [i.costItemId] : [])),
                            }}
                        />
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}

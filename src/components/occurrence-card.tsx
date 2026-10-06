import Link from "next/link";
import type { OccurrenceStatus, Priority } from "../generated/prisma/enums";
import { PriorityText, SlaPill, StatusBadge } from "./ui";

export interface OccurrenceRow {
  id: string;
  number: number;
  title: string;
  status: OccurrenceStatus;
  priority: Priority;
  slaDueAt: Date | string | null;
  team?: { name: string } | null;
  area?: { name: string } | null;
  responsible?: { name: string } | null;
  _count?: { attachments: number };
}

export function OccurrenceCard({ o, eventId }: { o: OccurrenceRow; eventId: string }) {
  const closed = o.status === "CONCLUIDO" || o.status === "CANCELADO";
  return (
    <Link
      href={`/eventos/${eventId}/ocorrencias/${o.id}`}
      className="block rounded-2xl border border-border bg-surface p-4 active:scale-[0.99] transition"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-semibold leading-snug">
          <span className="mr-1.5 font-mono text-sm text-muted">#{o.number}</span>
          {o.title}
        </p>
        <StatusBadge status={o.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {o.area && o.team && <span>{o.area.name} › {o.team.name}</span>}
        {!o.area && o.team && <span>{o.team.name}</span>}
        <PriorityText priority={o.priority} />
        <SlaPill dueAt={o.slaDueAt} closed={closed} />
        {o.responsible && <span>👤 {o.responsible.name}</span>}
        {!!o._count?.attachments && <span>📷 {o._count.attachments}</span>}
      </div>
    </Link>
  );
}

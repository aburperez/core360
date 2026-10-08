import { cx } from "@/components/ui";
import { ITEM_STATUS_LABEL, itemStatusTone, type ItemStatus } from "@/modules/items/item-meta";

const TONE = {
  muted: "bg-white/10 text-muted",
  warn: "bg-amber-400/15 text-amber-300",
  info: "bg-sky-500/15 text-sky-300",
  ok: "bg-emerald-500/15 text-emerald-300",
  done: "bg-brand-cyan/20 text-brand-cyan",
} as const;

/** Selo do status do item, com a cor da fase do fluxo. */
export function ItemStatusPill({ status, className }: { status: ItemStatus; className?: string }) {
  return (
    <span className={cx("inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[itemStatusTone(status)], className)}>
      {ITEM_STATUS_LABEL[status]}
    </span>
  );
}

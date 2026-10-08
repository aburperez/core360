import { Icon } from "./icons";
import { MONTAGEM_PPE } from "@/modules/visits/ppe";

/** Lista básica de EPIs da montagem (Pré-produção › Visitas técnicas e "Meu briefing"). */
export function MontagemPpe({ intro }: { intro?: string }) {
  return (
    <div className="space-y-3">
      {intro && <p className="text-sm text-muted">{intro}</p>}
      <ul className="space-y-2">
        {MONTAGEM_PPE.map((p) => (
          <li key={p.name} className="flex items-start gap-3">
            <Icon name="field" className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <span>
              <span className="font-medium">{p.name}</span>
              {p.when && <span className="block text-sm text-muted">{p.when}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Data e hora "de parede" do evento (o que a pessoa digita num campo
 * datetime-local, sem fuso) ↔ instante real. O fuso é o do evento, nunca o do
 * servidor (na Vercel o servidor roda em UTC).
 */

export const DEFAULT_TZ = "America/Sao_Paulo";

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function wallParts(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/** "2027-04-10T12:00" no fuso dado → Date. Devolve null se o texto não é desse formato. */
export function fromLocalInput(value: string, timeZone = DEFAULT_TZ): Date | null {
  const m = LOCAL.exec(value);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Quanto o fuso está atrás/à frente de UTC nesse instante (duas passadas por causa de horário de verão).
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const w = wallParts(new Date(guess), timeZone);
    const wallAsUtc = Date.UTC(+w.y, +w.m - 1, +w.d, +w.h, +w.min);
    guess = asUtc - (wallAsUtc - guess);
  }
  return new Date(guess);
}

/** Date → "2027-04-10T12:00" no fuso dado (valor inicial de um datetime-local). */
export function toLocalInput(d: Date | string, timeZone = DEFAULT_TZ): string {
  const w = wallParts(new Date(d), timeZone);
  return `${w.y}-${w.m}-${w.d}T${w.h}:${w.min}`;
}

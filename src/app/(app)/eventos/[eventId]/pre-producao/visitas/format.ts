/** "ter., 10/03/2099, 09:30" no fuso do evento. */
export function visitWhen(d: Date, tz: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz,
  }).format(d);
}

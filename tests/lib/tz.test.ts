import { expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "../../src/lib/tz";
it("converte data e hora do evento no fuso dele", () => {
  expect(fromLocalInput("2027-04-10T12:00")!.toISOString()).toBe("2027-04-10T15:00:00.000Z");
  expect(toLocalInput("2027-04-10T15:00:00.000Z")).toBe("2027-04-10T12:00");
  expect(fromLocalInput("2027-07-01T00:30", "Europe/Lisbon")!.toISOString()).toBe("2027-06-30T23:30:00.000Z");
  expect(fromLocalInput("bad")).toBeNull();
});

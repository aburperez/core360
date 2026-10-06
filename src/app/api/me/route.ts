import { authed } from "@/server/http/handler";

/** Quem sou eu e em quais eventos participo (para montar menus). */
export const GET = authed(async ({ actor }) => ({
  id: actor.userId,
  name: actor.name,
  email: actor.email,
  isAdmin: actor.isAdmin,
  memberships: actor.memberships,
}));

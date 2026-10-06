import { requireUser } from "@/server/http/session";

/** Toda tela daqui para dentro exige usuário autenticado e ativo. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return <>{children}</>;
}

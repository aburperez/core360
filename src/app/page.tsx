import { redirect } from "next/navigation";
import { currentActor } from "@/server/http/session";
import { Landing } from "@/components/site";

export const metadata = {
  title: { absolute: "CORE 360 · Gestão de eventos: pré-produção e campo" },
  description: "Pré-produção no computador e gestão de campo no celular, para agências de eventos. Conheça cada ferramenta, passo a passo.",
};

/** Quem já entrou vai direto aos eventos; os outros veem a página que explica o app. */
export default async function Home() {
  if (await currentActor()) redirect("/eventos");
  // Link do botão "Pedir uma demonstração" (WhatsApp ou e-mail). Sem ele, o botão não aparece.
  const contact = process.env.CONTACT_URL?.trim();
  return <Landing contactUrl={contact && /^(https:|mailto:)/.test(contact) ? contact : null} />;
}

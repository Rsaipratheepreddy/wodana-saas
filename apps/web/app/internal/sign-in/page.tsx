import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/internal/auth";
import { consoleT } from "@/lib/internal/server";
import { OperatorSignIn } from "./sign-in-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await consoleT();
  return { title: `${t("Sign in")} · ${t("Wodana Control")}` };
}

export default async function InternalSignInPage() {
  if (await getOperatorSession()) redirect("/internal");
  return <OperatorSignIn />;
}

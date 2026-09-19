import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/internal/auth";
import { OperatorSignIn } from "./sign-in-screen";

export const metadata: Metadata = {
  title: "Sign in · Wodana Control",
  description: "Wodana operator sign-in.",
};

export default async function InternalSignInPage() {
  if (await getOperatorSession()) redirect("/internal");
  return <OperatorSignIn />;
}

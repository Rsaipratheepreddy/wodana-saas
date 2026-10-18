import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LANGUAGE_COOKIE, resolveLanguage } from "@/lib/i18n/languages";
import { translator } from "@/lib/i18n/messages";
import { getOperatorSession } from "./auth";

/** The signed-in Wodana operator for a console page; anyone else goes to the operator sign-in. */
export async function requireOperator() {
  const session = await getOperatorSession();
  if (!session) redirect("/internal/sign-in");
  const { operator } = session;
  return { userId: operator.userId, name: operator.displayName, email: operator.email, role: operator.role, permissions: operator.permissions };
}

/** Labels for console page metadata, in the operator's chosen language. */
export async function consoleT() {
  return translator(resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value));
}

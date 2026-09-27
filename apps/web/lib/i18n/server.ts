import "server-only";

import { cookies } from "next/headers";
import { LANGUAGE_COOKIE, resolveLanguage } from "./languages";
import { translator } from "./messages";

/** `t()` for server components, in the language the person chose. */
export async function serverTranslator() {
  return translator(resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value));
}

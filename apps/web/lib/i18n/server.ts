import "server-only";
import { cookies } from "next/headers";
import { LANGUAGE_COOKIE, chooseLanguage, type AppLanguage, type LanguageFallback } from "./languages";
import { translator } from "./messages";

/** The request's UI language (see `chooseLanguage`). */
export async function getServerLanguage(fallback?: LanguageFallback): Promise<AppLanguage> {
  return chooseLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value, fallback);
}

/** `t()` for server components and route handlers, in the request's language. */
export async function getServerT(fallback?: LanguageFallback) {
  return translator(await getServerLanguage(fallback));
}

/** `t()` for server components, in the language the person chose (same as `getServerT()`). */
export const serverTranslator = () => getServerT();

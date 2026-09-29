/**
 * Where sign-in continues: a workspace or internal page, or an AI app's consent screen (`/oauth/authorize?…`).
 * Anything else, another site included, opens the workspace.
 */
export function safeNextPath(next: string | undefined | null): string {
  if (!next) return "/workspace";
  if (next.startsWith("/workspace") || next.startsWith("/internal")) return next;
  if (next === "/oauth/authorize" || (next.startsWith("/oauth/authorize?") && next.length <= 4_200)) return next;
  return "/workspace";
}

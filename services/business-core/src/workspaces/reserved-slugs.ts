/** Login slugs no organization may take: they are platform host names (admin.<domain>, api.<domain>, …) or routes. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["admin", "api", "app", "auth", "internal", "login", "mail", "status", "support", "www", "workspace"]);

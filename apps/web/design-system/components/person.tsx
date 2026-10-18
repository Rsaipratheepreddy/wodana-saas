import { Avatar } from "./avatar";

export type PersonLike = { name?: string | null; displayName?: string | null; email?: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/**
 * How a person is named in the product: their display name, else the part of their email before
 * the @. Business data is shown exactly as entered: never re-cased, never the full address as a name.
 */
export function personDisplayName(person: PersonLike | string | null | undefined): string {
  if (!person) return "";
  const candidates = typeof person === "string" ? [person] : [person.displayName, person.name, person.email];
  const name = candidates.map((value) => value?.trim() ?? "").find(Boolean) ?? "";
  return EMAIL.test(name) ? name.slice(0, name.indexOf("@")) : name;
}

/** A person's name in running text or a table cell. The full email, when known, is the tooltip. */
export function PersonName({ person, fallback, className }: { person: PersonLike | string | null | undefined; fallback?: string; className?: string }) {
  const name = personDisplayName(person) || fallback || "";
  const email = typeof person === "string" ? (EMAIL.test(person.trim()) ? person.trim() : undefined) : person?.email ?? undefined;
  return <bdi className={["wd-person-name", className].filter(Boolean).join(" ")} title={email && email !== name ? email : undefined}>{name}</bdi>;
}

/** A person with their avatar: owners, assignees and authors on cards and rows. */
export function PersonChip({ person, src, preset, seed, roles, fallback }: { person: PersonLike | string | null | undefined; src?: string | null; preset?: string | null; seed?: string; roles?: ReadonlyArray<string> | null; fallback?: string }) {
  const name = personDisplayName(person) || fallback || "";
  if (!name) return null;
  return <span className="wd-person-chip"><span aria-hidden="true"><Avatar name={name} preset={preset} roles={roles} seed={seed ?? name} size="sm" src={src} /></span><PersonName fallback={fallback} person={person} /></span>;
}

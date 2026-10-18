import type { ReactNode } from "react";
import { PersonChip, personDisplayName, type PersonLike } from "../components/person";

/**
 * The first column of every list (§5c D2): the record's name and one muted line under it
 * (client · area, reference). The muted line never wraps to a second line; its full text is its title.
 */
export function RecordName({ detail, title }: { detail?: string | null; title: ReactNode }) {
  return <span className="wd-record-name">
    <span className="wd-record-name-title">{title}</span>
    {detail ? <span className="wd-record-name-detail" title={detail}>{detail}</span> : null}
  </span>;
}

/** The owner of a row as an avatar with their name; without an owner, the fallback ("Unassigned") in muted text. */
export function OwnerCell({ fallback, person }: { fallback?: string; person: PersonLike | string | null | undefined }) {
  return personDisplayName(person) ? <span className="wd-owner-cell"><PersonChip person={person} /></span>
    : fallback ? <span className="wd-owner-cell" data-empty="">{fallback}</span> : null;
}

/** One of the workspace's roles on the deal (PLM-100), as the Deal File reads it: who holds it, or "not applicable". */
export type DealTeamRole = { role: string; label: string; member: { membershipId: string; name: string; email: string | null } | null; notApplicable: boolean };

export type DealPerson = { id: string; name: string; email: string | null; roles: string[] };

/**
 * The people on the deal, one row each with every role they hold (in the order the roles are set up), and the roles
 * the firm marked not applicable. People are told apart by membership, never by name: two people called Sara keep
 * their own rows, while one person holding three roles is listed once.
 */
export function dealPeople(team: readonly DealTeamRole[] | null | undefined): { people: DealPerson[]; notApplicable: string[] } {
  const people = new Map<string, DealPerson>();
  const notApplicable: string[] = [];
  for (const role of team ?? []) {
    if (role.member) {
      const person = people.get(role.member.membershipId) ?? { id: role.member.membershipId, name: role.member.name, email: role.member.email ?? null, roles: [] };
      if (!person.roles.includes(role.label)) person.roles.push(role.label);
      if (!person.email && role.member.email) person.email = role.member.email;
      people.set(person.id, person);
    } else if (role.notApplicable && !notApplicable.includes(role.label)) notApplicable.push(role.label);
  }
  return { people: [...people.values()], notApplicable };
}

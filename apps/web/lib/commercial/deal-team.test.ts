import { describe, expect, it } from "vitest";
import { dealPeople } from "./deal-team";

const sara = { membershipId: "m-sara", name: "Sara", email: null };
const noor = { membershipId: "m-noor", name: "Noor", email: "noor@example.test" };

describe("dealPeople (PLM-100)", () => {
  it("lists a person once with every role they hold, in the roles' order", () => {
    const { people, notApplicable } = dealPeople([
      { role: "account_manager", label: "Sales", member: sara, notApplicable: false },
      { role: "designer", label: "Designer", member: sara, notApplicable: false },
      { role: "design_manager", label: "Design manager", member: noor, notApplicable: false },
      { role: "site_lead", label: "Site lead", member: sara, notApplicable: false },
    ]);
    expect(people).toEqual([
      { id: "m-sara", name: "Sara", email: null, roles: ["Sales", "Designer", "Site lead"] },
      { id: "m-noor", name: "Noor", email: "noor@example.test", roles: ["Design manager"] },
    ]);
    expect(notApplicable).toEqual([]);
  });

  it("tells two people with the same name apart by membership, and fills in an email a later role knows", () => {
    const { people } = dealPeople([
      { role: "account_manager", label: "Sales", member: sara, notApplicable: false },
      { role: "buyer", label: "Buyer", member: { membershipId: "m-sara-2", name: "Sara", email: "sara.k@example.test" }, notApplicable: false },
      { role: "designer", label: "Designer", member: { ...sara, email: "sara@example.test" }, notApplicable: false },
    ]);
    expect(people.map((person) => [person.id, person.email, person.roles])).toEqual([
      ["m-sara", "sara@example.test", ["Sales", "Designer"]],
      ["m-sara-2", "sara.k@example.test", ["Buyer"]],
    ]);
  });

  it("keeps the roles nobody fills apart as not applicable, and ignores roles nobody settled", () => {
    const { people, notApplicable } = dealPeople([
      { role: "qs", label: "QS", member: null, notApplicable: true },
      { role: "factory_lead", label: "Factory lead", member: null, notApplicable: false },
      { role: "account_manager", label: "Sales", member: sara, notApplicable: false },
    ]);
    expect(people.map((person) => person.name)).toEqual(["Sara"]);
    expect(notApplicable).toEqual(["QS"]);
    expect(dealPeople(undefined)).toEqual({ people: [], notApplicable: [] });
  });
});

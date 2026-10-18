export type SetupProfile = {
  kind: "region" | "firm_kit" | "plan";
  code: string;
  version: number;
  configuration: Record<string, unknown>;
};

export type NewTenantDetails = {
  accountName: string;
  contactName: string;
  contactEmail: string;
  organizationName: string;
  slug: string;
  registeredName: string;
  ownerName: string;
  ownerEmail: string;
  regionCode: string;
  firmKitCode: string;
  planCode: string;
  /** Seats sold when they differ from the plan's default; null keeps the plan's number. */
  seatLimit: number | null;
};

export const emptyTenantDetails: NewTenantDetails = {
  accountName: "", contactName: "", contactEmail: "", organizationName: "", slug: "",
  registeredName: "", ownerName: "", ownerEmail: "", regionCode: "",
  firmKitCode: "", planCode: "", seatLimit: null,
};

/** The first published choice of each kind, so the form starts complete without assuming a country. */
export function defaultSelections(profiles: SetupProfile[]) {
  const first = (kind: SetupProfile["kind"]) => profiles.find((profile) => profile.kind === kind)?.code ?? "";
  return { regionCode: first("region"), firmKitCode: first("firm_kit"), planCode: first("plan") };
}

export function planSeats(profile: SetupProfile | null) {
  const value = profile?.configuration.seatLimit;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function tenantSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function legalCode(value: string) {
  const initials = value.trim().split(/\s+/).map((part) => part[0]).join("").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return (initials.length >= 2 ? initials : `${initials}HQ`).slice(0, 24);
}

export function selectedProfile(profiles: SetupProfile[], kind: SetupProfile["kind"], code: string) {
  return profiles.filter((profile) => profile.kind === kind && profile.code === code)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

export function validateTenantDetails(input: NewTenantDetails, profiles: SetupProfile[]) {
  const errors: string[] = [];
  for (const [label, value] of [
    ["Customer account name", input.accountName], ["Contract contact name", input.contactName],
    ["Organization name", input.organizationName], ["Owner name", input.ownerName],
  ]) if (value.trim().length < 2) errors.push(`${label} needs at least two characters.`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail.trim())) errors.push("Enter a valid contract contact email.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.ownerEmail.trim())) errors.push("Enter a valid owner email.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.slug.length > 80) errors.push("Choose a valid login address.");
  if (input.registeredName.trim() && input.registeredName.trim().length < 2) errors.push("Registered name needs at least two characters.");
  if (input.seatLimit !== null && (!Number.isInteger(input.seatLimit) || input.seatLimit < 1)) errors.push("Seats must be a whole number of at least 1.");
  for (const [kind, code] of [["region", input.regionCode], ["firm_kit", input.firmKitCode], ["plan", input.planCode]] as const) {
    if (!selectedProfile(profiles, kind, code)) errors.push(`Choose an available ${kind.replace("_", " ")}.`);
  }
  return errors;
}

export function tenantDraftPayload(input: NewTenantDetails, profiles: SetupProfile[], draftKey: string) {
  const errors = validateTenantDetails(input, profiles);
  if (errors.length) throw new Error(errors.join(" "));
  const region = selectedProfile(profiles, "region", input.regionCode)!;
  const firmKit = selectedProfile(profiles, "firm_kit", input.firmKitCode)!;
  const plan = selectedProfile(profiles, "plan", input.planCode)!;
  const config = region.configuration;
  for (const key of ["countryCode", "currency", "locale", "timezone", "unitSystem"]) {
    if (typeof config[key] !== "string" || !config[key]) throw new Error("The selected region is incomplete.");
  }
  if (!Number.isInteger(config.weekStartsOn)) throw new Error("The selected region is incomplete.");
  const organizationName = input.organizationName.trim();
  return {
    externalTenantId: `tenant_${draftKey}`,
    account: {
      displayName: input.accountName.trim(), contactName: input.contactName.trim(),
      contactEmail: input.contactEmail.trim().toLowerCase(),
    },
    organization: {
      name: organizationName, slug: input.slug,
      defaultCurrency: config.currency, defaultLocale: config.locale, defaultTimezone: config.timezone,
      unitSystem: config.unitSystem, weekStartsOn: config.weekStartsOn,
      firstLegalEntity: {
        code: legalCode(organizationName), displayName: organizationName,
        registeredName: input.registeredName.trim() || organizationName,
        countryCode: config.countryCode, baseCurrency: config.currency,
        locale: config.locale, timezone: config.timezone,
      },
    },
    owner: { displayName: input.ownerName.trim(), email: input.ownerEmail.trim().toLowerCase() },
    defaults: {
      region: { code: region.code, version: region.version },
      firmKit: { code: firmKit.code, version: firmKit.version },
      plan: { code: plan.code, version: plan.version },
      ...(input.seatLimit !== null && input.seatLimit !== planSeats(plan) ? { seatLimit: input.seatLimit } : {}),
    },
  };
}

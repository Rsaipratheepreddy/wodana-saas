/** A client record's contact point as the CRM API returns it. */
export type ContactPoint = { type?: string; value?: string; rawValue?: string; countryCode?: string; isPrimary?: boolean; status?: string };

/** The contact typed on an enquiry (`details.contact`); it stays there when a known client was chosen on the form. */
export type EnquiryContact = {
  mobile?: string | null; phone?: string | null; email?: string | null; mobileCountryCode?: string | null; phoneCountryCode?: string | null;
};

export type ClientContactFacts = { phone: string; countryCode: string | undefined; email: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * The client's phone and email to show on a deal: the client record's active contact points first (the primary one
 * of each kind), else what was typed on the enquiry the deal came from. A deal converted from an enquiry whose
 * client record holds no contact points (an enquiry made from an email chat, or a known client chosen on the form)
 * still shows how to reach the client.
 */
export function clientContactFacts(contacts: ContactPoint[] | null | undefined, enquiryContact?: EnquiryContact | null): ClientContactFacts {
  const active = (contacts ?? []).filter((contact) => contact.status !== "archived");
  const primary = (type: string) => active.find((contact) => contact.type === type && contact.isPrimary) ?? active.find((contact) => contact.type === type);
  const phone = primary("phone");
  const email = primary("email");
  const recorded = text(phone?.rawValue ?? phone?.value);
  if (recorded) return { phone: recorded, countryCode: phone?.countryCode || undefined, email: text(email?.value) || text(enquiryContact?.email) };
  const mobile = text(enquiryContact?.mobile);
  const landline = text(enquiryContact?.phone);
  const countryCode = mobile ? enquiryContact?.mobileCountryCode : landline ? enquiryContact?.phoneCountryCode : undefined;
  return { phone: mobile || landline, countryCode: countryCode || undefined, email: text(email?.value) || text(enquiryContact?.email) };
}

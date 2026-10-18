"use client";

import { PhoneField } from "@/design-system";

/** CRM forms use the shared phone control. */
export function CrmPhoneField({ required = false, ...props }: {
  label: string; value: string; onChange: (value: string) => void;
  countryCode: string; onCountryChange: (countryCode: string) => void; locale?: string; required?: boolean; kind?: "mobile" | "any";
  isReadOnly?: boolean; description?: string; errorMessage?: string;
}) {
  return <PhoneField {...props} isRequired={required} />;
}

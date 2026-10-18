/** "Asia/Dubai" → "Dubai", "America/Argentina/Buenos_Aires" → "Buenos Aires": a zone as people name it. */
export function timeZoneCity(timeZone: string): string {
  const city = (timeZone.split("/").at(-1) ?? timeZone).replaceAll("_", " ");
  return RENAMED[city] ?? city;
}

/** Browsers still report some zones by their old names (Asia/Calcutta); people know the current ones. */
const RENAMED: Record<string, string> = { Calcutta: "Kolkata", Saigon: "Ho Chi Minh", Katmandu: "Kathmandu", Rangoon: "Yangon", Kiev: "Kyiv", "Ulan Bator": "Ulaanbaatar" };

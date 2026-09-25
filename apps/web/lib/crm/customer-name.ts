/** Legacy imported customer names sometimes include a label before a middle dot. */
export function customerDisplayName(value: string) {
  const parts = value.split(/\s+·\s+/).map(part => part.trim()).filter(Boolean);
  return parts.at(-1) ?? value.trim();
}

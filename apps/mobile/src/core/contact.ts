/**
 * One-tap contact links. Numbers are used as stored (international format, from the workspace's region
 * rules); nothing here assumes a country.
 */
export const dialable = (value: string | null | undefined) => (value ?? '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
export const telLink = (value: string | null | undefined) => (dialable(value) ? `tel:${dialable(value)}` : null);
/** WhatsApp wants the full international number as digits only (no +, no leading 00). */
export const whatsappLink = (value: string | null | undefined, text?: string) => {
  const digits = dialable(value).replace(/^\+/, '').replace(/^00/, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};
export const mailLink = (value: string | null | undefined, subject?: string) => (value && /@/.test(value) ? `mailto:${value.trim()}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}` : null);

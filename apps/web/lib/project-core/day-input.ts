/**
 * A segmented date field reports every keystroke of its year: 0002, 0020, 0202 on the way to 2026. Such a value is
 * still being typed; previewed or saved, it would schedule a plan in year 202 (and the server now refuses it).
 */
export const stillTypingYear = (value: { year: number } | null | undefined) => !!value && value.year < 1000;

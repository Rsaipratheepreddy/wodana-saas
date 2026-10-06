import { tKey } from "@/lib/i18n/keys";

/** How long a screen's read may take before it shows its error and Retry instead of loading on. */
export const READ_TIMEOUT_MS = 20_000;

export class ReadTimeoutError extends Error {}

/** Fails a read that has not answered in time, so no screen waits on an endless skeleton. */
export function readWithin<T>(work: Promise<T>, ms = READ_TIMEOUT_MS, message: string = tKey("This is taking too long. Try again.")): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ReadTimeoutError(message)), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

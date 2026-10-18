import type { QueryKey } from '@tanstack/react-query';
import { ApiError, AuthError } from '../auth/client';
import type { Api, UploadFile } from './api';
import { key } from './i18n';
import { classify, OutboxFileError, type OutboxFile, type OutboxItem } from './outbox-model';

/**
 * One try at sending a queued item, apart from React and storage so node tests can run it: the item's handler
 * gets each photo opened for the duration of its upload, and the outcome says what the queue does next.
 */
export type OpenedFile = { file: UploadFile; cleanup: () => void };
export type OutboxContext = {
  api: Api;
  item: OutboxItem;
  /** A queued photo as a plain file, for the duration of `use`. */
  withFile: <T>(key: string, use: (file: UploadFile) => Promise<T>) => Promise<T>;
  /** Record that a step finished, so a retry doesn't repeat it. */
  step: (done: number) => void;
};
/** Sends one queued item; returns the queries to refresh afterwards. */
export type OutboxHandler = (context: OutboxContext) => Promise<QueryKey[] | void>;

export type SendOutcome =
  | { kind: 'sent'; keys: QueryKey[] }
  /** The server, or the photo, said no: the person fixes or discards it. */
  | { kind: 'blocked'; message: string; issues: string[] }
  /** A connection problem or a server hiccup: later. `offline` stops the rest of the run. */
  | { kind: 'retry'; message: string; offline: boolean }
  /** Signed out or no access: waits for the next sign-in. */
  | { kind: 'signedOut'; message: string };

export const NO_HANDLER = key('This capture can no longer be sent from this version of the app.');
const PHOTO_MISSING = key('The photo saved for this is missing. Take it again.');
const REFUSED = key('The server refused this.');
const NO_CONNECTION = key('No connection');

export async function sendItem(item: OutboxItem, handler: OutboxHandler, deps: {
  api: Api;
  open: (itemId: string, file: OutboxFile) => Promise<OpenedFile>;
  step: (done: number) => void;
}): Promise<SendOutcome> {
  try {
    const keys = await handler({
      api: deps.api, item, step: deps.step,
      withFile: async (fileKey, use) => {
        const file = item.files.find((entry) => entry.key === fileKey);
        if (!file) throw new OutboxFileError(PHOTO_MISSING);
        const opened = await deps.open(item.id, file);
        try { return await use(opened.file); } finally { opened.cleanup(); }
      },
    });
    return { kind: 'sent', keys: keys ?? [] };
  } catch (error) { return outcomeOf(error); }
}

/**
 * What a failed send means. A photo that is gone blocks (a retry can't bring it back). The server's refusals the
 * person can act on block; no connection, timeouts, rate limits and server errors retry; signed out waits.
 */
export function outcomeOf(error: unknown): Exclude<SendOutcome, { kind: 'sent' }> {
  const message = (fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
  if (error instanceof OutboxFileError) return { kind: 'blocked', message: error.message, issues: [] };
  if (error instanceof AuthError) {
    return error.code === 'network' ? { kind: 'retry', message: message(NO_CONNECTION), offline: true } : { kind: 'signedOut', message: message('') };
  }
  if (error instanceof ApiError && classify(error.status) === 'blocked') return { kind: 'blocked', message: message(REFUSED), issues: error.issues };
  return { kind: 'retry', message: message(NO_CONNECTION), offline: false };
}

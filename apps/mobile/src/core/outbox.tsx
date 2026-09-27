import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError, AuthError } from '../auth/client';
import { errorIssues, errorMessage, isOffline, useApi, type Api, type UploadFile } from './api';
import {
  amend as amendItem, classify, createItem, due, enqueue as enqueueItem, markBlocked, markRetry, markSending, markStep, nextWake,
  recover, remove, retryNow, type OutboxFile, type OutboxItem,
} from './outbox-model';
import { openOutboxFile, readProtectedOfflineText, removeOutboxFiles, storeOutboxFile, writeProtectedOfflineText } from './protected-storage';
import { useSession } from './session';

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

const handlers = new Map<string, OutboxHandler>();
/** Features register how their queued captures are sent (at import time). */
export function registerOutboxHandler(kind: string, handler: OutboxHandler) { handlers.set(kind, handler); }

type EnqueueInput = Parameters<typeof createItem<Record<string, unknown>>>[0];
type OutboxApi = {
  items: OutboxItem[];
  /** Save a capture on the phone and send it as soon as possible. Returns once it's safely stored. */
  enqueue: (input: Omit<EnqueueInput, 'workspaceId' | 'files'>, files?: Array<Omit<OutboxFile, 'encrypted'>>) => Promise<void>;
  /** Change what will be sent (e.g. add the reason the server asked for) and send it again. */
  amend: (id: string, patch: Record<string, unknown>) => void;
  retry: (id: string) => void;
  discard: (id: string) => void;
  flush: () => void;
};
const Context = createContext<OutboxApi | null>(null);

const storageKey = (userId: string) => `wodana.outbox.v1.${userId}`;

/**
 * The outbox for the signed-in person: loads what was waiting, sends it when the app opens, comes back
 * to the front, regains a connection, or when a retry is due.
 */
export function OutboxProvider({ children }: PropsWithChildren) {
  const api = useApi();
  const { userId, workspaceId } = useSession();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const itemsRef = useRef<OutboxItem[]>([]);
  const loaded = useRef(false);
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writing = useRef<Promise<unknown>>(Promise.resolve());

  const commit = useCallback((change: (items: OutboxItem[]) => OutboxItem[]) => {
    itemsRef.current = change(itemsRef.current);
    setItems(itemsRef.current);
    const snapshot = JSON.stringify(itemsRef.current);
    writing.current = writing.current.catch(() => undefined).then(() => writeProtectedOfflineText(storageKey(userId), snapshot));
    return writing.current;
  }, [userId]);

  const flush = useCallback(async () => {
    if (!loaded.current) return;
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do {
        again.current = false;
        for (const item of due(itemsRef.current, workspaceId)) {
          const handler = handlers.get(item.kind);
          if (!handler) { await commit((list) => markBlocked(list, item.id, 'This capture can no longer be sent from this version of the app.')); continue; }
          await commit((list) => markSending(list, item.id));
          try {
            const current = itemsRef.current.find((entry) => entry.id === item.id) ?? item;
            const keys = await handler({
              api, item: current,
              step: (done) => { void commit((list) => markStep(list, item.id, done)); },
              withFile: async (key, use) => {
                const file = current.files.find((entry) => entry.key === key);
                if (!file) throw new Error('The saved photo is missing. Take it again.');
                const opened = await openOutboxFile(current.id, file);
                try { return await use(opened.file); } finally { opened.cleanup(); }
              },
            });
            await commit((list) => remove(list, item.id));
            removeOutboxFiles(item.id);
            for (const key of keys ?? []) void queryClient.invalidateQueries({ queryKey: key });
          } catch (error) {
            const offline = isOffline(error) || (error instanceof AuthError && error.code === 'network');
            const status = error instanceof ApiError ? error.status : offline ? 0 : null;
            if (error instanceof AuthError && error.code !== 'network') {
              // Signed out or no access: keep it waiting for the next sign-in.
              await commit((list) => markRetry(list, item.id, errorMessage(error, '')));
              return;
            }
            if (status !== null && classify(status) === 'blocked') {
              await commit((list) => markBlocked(list, item.id, errorMessage(error, 'The server refused this.'), errorIssues(error)));
            } else {
              await commit((list) => markRetry(list, item.id, errorMessage(error, 'No connection')));
              if (offline) break; // No point trying the rest until the connection is back.
            }
          }
        }
      } while (again.current);
    } finally {
      running.current = false;
      if (timer.current) clearTimeout(timer.current);
      const wake = nextWake(itemsRef.current, workspaceId);
      if (wake !== null) timer.current = setTimeout(() => { void flush(); }, Math.max(1000, wake - Date.now()));
    }
  }, [api, commit, queryClient, workspaceId]);

  useEffect(() => {
    let alive = true;
    void readProtectedOfflineText(storageKey(userId)).then((raw) => {
      if (!alive) return;
      let saved: OutboxItem[] = [];
      try { saved = raw ? JSON.parse(raw) : []; } catch { saved = []; }
      itemsRef.current = recover(Array.isArray(saved) ? saved : []);
      setItems(itemsRef.current);
      loaded.current = true;
      void flush();
    }).catch(() => { loaded.current = true; });
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void flush(); });
    let wasConnected = true;
    const network = NetInfo.addEventListener((state) => {
      const connected = !!state.isConnected && state.isInternetReachable !== false;
      if (connected && !wasConnected) {
        // Back online: everything waiting is due now.
        itemsRef.current = itemsRef.current.map((item) => (item.status === 'pending' ? { ...item, nextAttemptAt: Date.now() } : item));
        void flush();
      }
      wasConnected = connected;
    });
    return () => { alive = false; appState.remove(); network(); if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, workspaceId]);

  const value = useMemo<OutboxApi>(() => ({
    items: items.filter((item) => item.workspaceId === workspaceId),
    enqueue: async (input, files = []) => {
      const stored = await Promise.all(files.map((file) => storeOutboxFile(input.id, file)));
      await commit((list) => enqueueItem(list, createItem({ ...input, workspaceId, files: stored })));
      void flush();
    },
    amend: (id, patch) => { void commit((list) => amendItem(list, id, patch)).then(() => flush()); },
    retry: (id) => { void commit((list) => retryNow(list, id)).then(() => flush()); },
    discard: (id) => { void commit((list) => remove(list, id)); removeOutboxFiles(id); },
    flush: () => { void flush(); },
  }), [items, workspaceId, commit, flush]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOutbox() {
  const value = useContext(Context);
  if (!value) throw new Error('useOutbox is only available inside the signed-in app.');
  return value;
}

/** Items waiting for one record (e.g. `project:<id>`), for a "2 waiting to send" line on its screen. */
export function usePending(scope: string | null | undefined) {
  const { items } = useOutbox();
  return useMemo(() => (scope ? items.filter((item) => item.scope === scope) : []), [items, scope]);
}

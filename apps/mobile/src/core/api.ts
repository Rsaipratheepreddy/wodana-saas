import { useMemo } from 'react';
import { Platform } from 'react-native';
import { ApiError, AuthError } from '../auth/client';
import { useAuth } from '../auth/provider';
import { useSession } from './session';

export { ApiError };
export type UploadFile = { uri: string; name: string; type: string };
export type Api = {
  workspaceId: string;
  /** A workspace path such as `hrms/bootstrap` (no leading slash). */
  get: <T>(path: string) => Promise<T>;
  /** A command; `headers` carries its own headers (an Idempotency-Key). */
  send: <T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, headers?: Record<string, string>) => Promise<T>;
  /** A file as multipart form data under `field` (the only part: the server takes no other fields). */
  upload: <T>(path: string, method: 'POST' | 'PUT', field: string, file: UploadFile) => Promise<T>;
  /** The absolute URL of a workspace file, for an image loader that sends the authorization header. */
  url: (path: string) => string;
};

export const workspacePath = (workspaceId: string, path: string) => `/workspaces/${workspaceId}/${path.replace(/^\/+/, '')}`;

/** A local file as a multipart part: a blob in the browser, a file reference on the phone. */
export async function formPart(file: UploadFile): Promise<Blob> {
  if (Platform.OS === 'web') return (await fetch(file.uri)).blob();
  return file as unknown as Blob;
}

/** Requests to the active workspace's API, with the session's token rotation. */
export function useApi(): Api {
  const { client } = useAuth();
  const { workspaceId } = useSession();
  return useMemo(() => {
    const url = (path: string) => workspacePath(workspaceId, path);
    return {
      workspaceId,
      get: <T,>(path: string) => client.api<T>(url(path)),
      send: <T,>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, headers?: Record<string, string>) => client.api<T>(url(path), method, body ?? {}, false, headers),
      upload: async <T,>(path: string, method: 'POST' | 'PUT', field: string, file: UploadFile) => {
        const form = new FormData();
        const part = await formPart(file);
        if (Platform.OS === 'web') form.append(field, part, file.name);
        else form.append(field, part);
        return client.api<T>(url(path), method, form);
      },
      url: (path: string) => `${client.apiBase}${url(path)}`,
    };
  }, [client, workspaceId]);
}

/** Whether a failure is the connection (worth retrying later) rather than the server's answer. */
export const isOffline = (error: unknown) => error instanceof AuthError && error.code === 'network';

/** The message to show for a failed request. */
export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof AuthError || error instanceof Error) return error.message || fallback;
  return fallback;
}
/** The issues the server listed with a refusal (e.g. evidence that needs a reason). */
export const errorIssues = (error: unknown) => (error instanceof ApiError ? error.issues : []);
export const errorStatus = (error: unknown) => (error instanceof ApiError ? error.status : 0);

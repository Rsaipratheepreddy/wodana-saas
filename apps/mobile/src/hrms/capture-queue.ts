import type { AttendanceAction } from "../../../../packages/contracts/src/hrms";
import { ApiError, AuthError } from "../auth/client";
export type PendingCapture = {
  key: string;
  input: AttendanceAction;
  photoUri: string | null;
  photoEncrypted?: boolean;
  createdAt: number;
};
export type CaptureTransport = {
  request: (path: string, method: string, body: unknown) => Promise<unknown>;
  photo: (capture: PendingCapture) => Promise<unknown>;
};
/** Always reuse the exact IDs/body: a lost response must not produce a second check-in. */
export async function syncCapture(
  capture: PendingCapture,
  transport: CaptureTransport,
) {
  await transport.request("captures", "POST", { id: capture.input.captureId });
  if (capture.photoUri) await transport.photo(capture);
  return transport.request("attendance/actions", "POST", capture.input);
}

export function attendanceSyncFailure(error: unknown): {
  state: "pending" | "permission" | "rejected";
  message: string;
  status: number | null;
} {
  const message = error instanceof Error
    ? error.message
    : "Sync stopped. Your saved attendance capture is still available.";
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403)
      return { state: "permission", message, status: error.status };
    if ([400, 404, 409, 413, 422].includes(error.status))
      return { state: "rejected", message, status: error.status };
  }
  if (error instanceof AuthError && ["access", "expired"].includes(error.code))
    return { state: "permission", message, status: 403 };
  return { state: "pending", message, status: null };
}

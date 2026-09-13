import type { AttendanceAction } from "../../../../packages/contracts/src/hrms";
export type PendingCapture = {
  key: string;
  input: AttendanceAction;
  photoUri: string | null;
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

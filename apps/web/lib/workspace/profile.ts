export type MyProfile = { avatarPreset: string | null; photoUrl: string | null; version: number };

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Your profile could not be saved.");
  return payload as T;
}

export const loadMyProfile = (workspaceId: string) => call<MyProfile>(`/api/workspace/profile?workspaceId=${workspaceId}`);
export const saveMyAvatar = (workspaceId: string, avatarPreset: string | null, version: number) =>
  call<MyProfile>("/api/workspace/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, avatarPreset, version }) });
export const uploadMyPhoto = (workspaceId: string, file: File) =>
  call<MyProfile>(`/api/workspace/profile/photo?workspaceId=${workspaceId}`, { method: "POST", headers: { "content-type": file.type }, body: file });
export const removeMyPhoto = (workspaceId: string) => call<MyProfile>(`/api/workspace/profile/photo?workspaceId=${workspaceId}`, { method: "DELETE" });
/** Turns sound and haptics on or off on every device the person uses. */
export const saveMyFeedback = (workspaceId: string, enabled: boolean) =>
  call<{ feedbackEnabled: boolean }>("/api/workspace/profile/feedback", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, enabled }) });

export type AiSettings = { enabled: boolean; version: number; available: boolean };
export async function loadAiSettings(workspaceId: string): Promise<AiSettings | null> {
  try {
    const response = await fetch(`/api/workspace/ai-settings?workspaceId=${workspaceId}`);
    return response.ok ? await response.json() as AiSettings : null;
  } catch { return null; }
}

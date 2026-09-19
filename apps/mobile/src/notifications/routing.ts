export type NotificationReference = { notificationId: string; workspaceId?: string };

export function notificationReference(value: unknown): NotificationReference | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const notificationId = typeof data.notificationId === 'string' ? data.notificationId : '';
  const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId : undefined;
  return /^[0-9a-f-]{36}$/i.test(notificationId) ? { notificationId, workspaceId } : null;
}

export function notificationLinkReference(url: string): NotificationReference | null {
  try {
    const parsed = new URL(url);
    const match = parsed.hostname === 'notification'
      ? /^\/([0-9a-f-]{36})$/i.exec(parsed.pathname)
      : /^\/notification\/([0-9a-f-]{36})$/i.exec(parsed.pathname);
    return match ? { notificationId: match[1], workspaceId: parsed.searchParams.get('workspaceId') ?? undefined } : null;
  } catch { return null; }
}

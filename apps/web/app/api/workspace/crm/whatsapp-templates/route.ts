import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  applyRotatedSession,
  authenticatedBackendFetch,
} from "@/lib/auth/backend-session";
import {
  ACCESS_COOKIE,
  businessApiUrl,
  intelligenceApiUrl,
  safeBackendMessage,
} from "@/lib/auth/server";
import {
  invalidRequest,
  isSameOrigin,
  UUID,
} from "@/lib/workspace/workspace-api";
import {
  inboxTemplateReason,
  matchesMetaTemplate,
  templateBody,
  type MetaTemplate,
  type StoredTemplate,
} from "@/lib/crm/whatsapp-templates";
import { getServerT } from "@/lib/i18n/server";
import { translateKnown } from "@/lib/i18n/keys";

export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("Invalid request origin."));
  const input = await request.json().catch(() => null);
  if (
    !UUID.test(input?.workspaceId ?? "") ||
    !UUID.test(input?.connectionId ?? "")
  )
    return invalidRequest(t("Choose a WhatsApp connection."));
  const { workspaceId, connectionId } = input;
  const path = `/workspaces/${workspaceId}/crm/notification-templates`;
  const initial = await authenticatedBackendFetch(path);
  const respond = (payload: unknown, status = 200) => {
    const response = NextResponse.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
    applyRotatedSession(response, initial.rotatedSession);
    return response;
  };
  if (initial.unauthenticated)
    return respond(
      { message: t("Sign in again to load WhatsApp templates.") },
      401,
    );
  if (!initial.upstream?.ok)
    return respond(
      {
        message:
          t("WhatsApp templates could not be loaded. Check your workspace permissions."),
      },
      initial.upstream?.status ?? 503,
    );
  const token =
    initial.rotatedSession?.accessToken ??
    (await cookies()).get(ACCESS_COOKIE)?.value;
  const call = (url: string, body?: unknown) =>
    fetch(url, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  try {
    const provider = await call(
      intelligenceApiUrl(
        `/integrations/providers/workspaces/${workspaceId}/connections/${connectionId}/records/templates?page=1`,
      ),
    );
    const data = await provider.json();
    if (!provider.ok)
      return respond(
        {
          message: safeBackendMessage(
            data,
            t("Meta templates could not be loaded. Check the WhatsApp connection."),
          ),
        },
        provider.status,
      );
    if (!Array.isArray(data.items))
      return respond(
        {
          message:
            t("Meta returned an invalid template list. Refresh to try again."),
        },
        502,
      );
    const approved = (data.items as MetaTemplate[]).filter(
      (item) => item.status === "APPROVED",
    );
    let stored = (await initial.upstream.json()) as StoredTemplate[];
    const items: StoredTemplate[] = [];
    const unavailable: Array<{ name: string; reason: string }> = [];
    for (const meta of approved) {
      const reason = inboxTemplateReason(meta);
      if (reason) {
        unavailable.push({ name: meta.name, reason: translateKnown(t, reason) });
        continue;
      }
      let match =
        stored.find(
          (item) =>
            matchesMetaTemplate(item, meta) && item.status === "approved",
        ) ??
        stored.find(
          (item) => matchesMetaTemplate(item, meta) && item.status === "draft",
        );
      if (!match) {
        const created = await call(businessApiUrl(path), {
          code: meta.name,
          channel: "whatsapp",
          locale: meta.language,
          bodyTemplate: templateBody(meta),
          variables: [],
          providerTemplateId: meta.id,
        });
        if (created.ok) match = (await created.json()) as StoredTemplate;
        else if (created.status === 409) {
          const latest = await call(businessApiUrl(path));
          if (latest.ok) {
            stored = await latest.json();
            match = stored.find(
              (item) =>
                matchesMetaTemplate(item, meta) &&
                ["draft", "approved"].includes(item.status),
            );
          }
        }
        if (!match) {
          unavailable.push({
            name: meta.name,
            reason:
              created.status === 403
                ? t("A workspace administrator needs to sync this template")
                : t("Could not sync. Refresh to try again"),
          });
          continue;
        }
      }
      if (match.status !== "approved") {
        const approvedLocal = await call(
          businessApiUrl(`${path}/${match.id}/approve`),
          { versionNumber: match.versionNumber },
        );
        if (!approvedLocal.ok) {
          // Another request may have approved the same version while this one was loading.
          const latest = await call(businessApiUrl(path));
          const fresh = latest.ok
            ? ((await latest.json()) as StoredTemplate[])
            : [];
          const existing = fresh.find(
            (item) =>
              matchesMetaTemplate(item, meta) && item.status === "approved",
          );
          if (!existing) {
            unavailable.push({
              name: meta.name,
              reason: t("A workspace administrator needs to sync this template"),
            });
            continue;
          }
          match = existing;
        } else match = { ...match, status: "approved" };
      }
      items.push(match);
    }
    return respond({
      items,
      unavailable,
      approvedCount: approved.length,
      truncated: data.truncated === true,
    });
  } catch {
    return respond(
      {
        message:
          t("WhatsApp templates could not be refreshed. Try again in a moment."),
      },
      503,
    );
  }
}

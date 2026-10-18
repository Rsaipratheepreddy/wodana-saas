"use client";

import { ReviewFiles } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalFile } from "@/lib/client-portal/types";

/** The photos and PDFs someone on the client's side added: photos as small previews, other files by name; each opens the original. */
export function ClientFiles({ files, url }: { files: PortalFile[]; url: (assetId: string, preview?: boolean) => string }) {
  const t = useT();
  if (!files.length) return null;
  return <ReviewFiles label={t("Client files")} files={files.map((file) => ({ id: file.id, name: file.name, href: url(file.id),
    previewHref: file.hasPreview || file.mimeType.startsWith("image/") ? url(file.id, file.hasPreview) : null }))} />;
}

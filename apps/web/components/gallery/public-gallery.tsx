"use client";

import { useDesignSystem } from "@/design-system";
import type { GalleryContent } from "@/lib/gallery/types";
import { GalleryView } from "./gallery-view";

/** The public page: pictures and enquiries go through the gallery's own public routes. */
export function PublicGallery({ content, slug }: { content: GalleryContent; slug: string }) {
  const { locale } = useDesignSystem();
  return <GalleryView content={content} locale={locale} submitTo={`/api/public-gallery/${slug}/enquiries`}
    imageUrl={(id, preview) => `/api/public-gallery/${slug}/images/${id}${preview ? "?preview=1" : ""}`} />;
}

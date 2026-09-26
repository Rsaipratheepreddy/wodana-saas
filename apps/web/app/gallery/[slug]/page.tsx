import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignSystemProvider } from "@/design-system";
import { PublicGallery } from "@/components/gallery/public-gallery";
import { businessApiUrl } from "@/lib/auth/server";
import type { GalleryContent } from "@/lib/gallery/types";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";

const SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/i;

async function load(slug: string): Promise<GalleryContent | null> {
  if (!SLUG.test(slug)) return null;
  const response = await fetch(businessApiUrl(`/public/gallery/${slug}`), { next: { revalidate: 60 }, signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!response || response.status === 404) return null;
  if (!response.ok) throw new Error("The gallery is temporarily unavailable. Please try again.");
  return response.json() as Promise<GalleryContent>;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const content = await load((await params).slug).catch(() => null);
  if (!content) return { title: "Gallery" };
  const title = content.settings.headline || content.brand.name;
  return { title: `${title} · ${content.brand.name}`, description: content.settings.intro.slice(0, 160) || undefined, openGraph: { title, description: content.settings.intro.slice(0, 160) || undefined } };
}

/** A firm's public gallery by its link (no sign-in). */
export default async function GalleryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const content = await load(slug);
  if (!content) notFound();
  return <DesignSystemProvider style={workspacePrimaryColorStyle({ primaryColor: content.brand.primaryColor })} locale={content.form?.defaultLocale ?? undefined}>
    <PublicGallery content={content} slug={slug.toLowerCase()} />
  </DesignSystemProvider>;
}

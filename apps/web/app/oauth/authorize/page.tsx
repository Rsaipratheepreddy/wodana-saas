import type { Metadata } from "next";
import { ConsentScreen } from "@/components/oauth/consent-screen";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Connect an AI app"), robots: { index: false, follow: false } };
}

/**
 * Where an AI app (over MCP) asks the signed-in person for access: which workspace, and whether it may
 * prepare changes. The OAuth query goes to Business Core as it came; nothing is decided here.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(name, item);
  }
  return <ConsentScreen query={params.toString()} />;
}

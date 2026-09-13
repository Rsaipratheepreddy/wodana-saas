import { ClientPortal } from "@/components/commercial/client-portal";
import { businessApiUrl } from "@/lib/auth/server";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug))
    return <main style={{ padding: "2rem" }}>Portal not found.</main>;
  const r = await fetch(businessApiUrl(`/client-portal/${slug}/brand`), {
    cache: "no-store",
  }).catch(() => null);
  if (!r?.ok)
    return (
      <main style={{ padding: "2rem" }}>
        <h1>Portal unavailable</h1>
        <p>Please check your company link or contact your project team.</p>
      </main>
    );
  return <ClientPortal settings={await r.json()} />;
}

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { businessApiUrl } from "@/lib/auth/server";
import type { ClientCase } from "@/lib/commercial/types";
import { QuotationPrint } from "@/components/commercial/quotation-print";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ case?: string; quote?: string }>;
}) {
  const { slug } = await params,
    q = await searchParams;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();
  const token = (await cookies()).get(`wodana_client_${slug}`)?.value;
  if (!token) redirect(`/portal/${slug}`);
  const response = await fetch(businessApiUrl(`/client-portal/${slug}/data`), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) redirect(`/portal/${slug}`);
  const data = (await response.json()) as { cases: ClientCase[] },
    record = data.cases.find((c) => c.id === q.case),
    quote = record?.quotes.find((v) => v.id === q.quote);
  if (!record || !quote) notFound();
  return <QuotationPrint quote={quote} customer={record.customerName} />;
}

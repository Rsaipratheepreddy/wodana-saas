"use client";

import { useMemo } from "react";
import { portalApi } from "@/lib/client-portal/client";
import type { PortalSite } from "@/lib/client-portal/types";
import type { ProgressPrintData } from "@/lib/site/types";
import { ProgressPrint } from "../site/progress-print";
import { usePortalFormat } from "./portal-format";

/** The client's printout of a day or a week: dates in the firm's region, photos through the client's own session. */
export function PortalProgressPrint({ site, kind, data }: { site: PortalSite; kind: "day" | "week"; data: ProgressPrintData }) {
  const format = usePortalFormat(site.region);
  const api = useMemo(() => portalApi(site.slug), [site.slug]);
  return <ProgressPrint kind={kind} data={data} photoUrl={(id) => api.file("photo", id)} formatDay={format.date} />;
}

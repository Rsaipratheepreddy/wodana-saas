export type PricingMethod = "per_space" | "per_area" | "fixed";
export type DesignPackage = {
  id: string; code: string; name: string; pricingMethod: PricingMethod; rate: string; currency: string; areaUnit: "sqft" | "sqm" | null;
  includedRevisions: number; includesSpacePlanning: boolean; includesRenders: boolean; requiredRoleCode: string | null; inclusions: string | null;
  position: number; status: "active" | "archived"; version: number;
};
export type DesignSettings = { minimumDeposit: { amount: string; currency: string } | null; version: number; packages: DesignPackage[] };

async function call<T>(workspaceId: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/workspace/design/${path}?workspaceId=${workspaceId}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Design settings could not be saved.");
  return payload as T;
}

export const loadDesignSettings = (workspaceId: string) => call<DesignSettings>(workspaceId, "settings");
export const saveMinimumDeposit = (workspaceId: string, minimumDeposit: DesignSettings["minimumDeposit"], version: number) =>
  call<DesignSettings>(workspaceId, "settings", { method: "PUT", body: JSON.stringify({ minimumDeposit, version }) });
export const saveDesignPackage = (workspaceId: string, value: Partial<DesignPackage>) =>
  call<DesignPackage>(workspaceId, "packages", { method: "POST", body: JSON.stringify(value) });
export const setDesignPackageStatus = (workspaceId: string, id: string, status: DesignPackage["status"], version: number) =>
  call<DesignPackage>(workspaceId, `packages/${id}/status`, { method: "POST", body: JSON.stringify({ status, version }) });
export const quoteDesignFee = (workspaceId: string, id: string, measure: { spaces?: number; area?: string; areaUnit?: "sqft" | "sqm" }) =>
  call<{ fee: string; currency: string; pricingMethod: PricingMethod; areaUnit: string | null }>(workspaceId, `packages/${id}/quote`, { method: "POST", body: JSON.stringify(measure) });

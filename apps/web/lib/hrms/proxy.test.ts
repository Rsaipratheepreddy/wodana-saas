// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/backend-session", () => ({ authenticatedBackendFetch: vi.fn(), applyRotatedSession: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ safeBackendMessage: (payload: { message?: string } | null, fallback: string) => payload?.message ?? fallback }));

import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { hrmsProxy } from "./proxy";

const W = "d004d45c-7140-4b0c-a68d-e87d012c2390";
const D = "123e4567-e89b-42d3-a456-426614174000";
const upload = (path: string, field: string, file: File) => {
  const body = new FormData();
  body.append(field, file);
  return new Request(`http://localhost/api/workspace/hrms/${path}?workspaceId=${W}`, { method: "PUT", body, headers: { origin: "http://localhost" } });
};

describe("HRMS proxy files", () => {
  beforeEach(() => {
    vi.mocked(authenticatedBackendFetch).mockReset();
    vi.mocked(authenticatedBackendFetch).mockResolvedValue({ upstream: new Response(JSON.stringify({ id: D }), { status: 200, headers: { "content-type": "application/json" } }) } as never);
  });

  it("passes a document's scan on in its own field, and refuses one elsewhere or too large", async () => {
    const scan = new File(["%PDF-1.7"], "permit.pdf", { type: "application/pdf" });
    const sent = await hrmsProxy(upload(`documents/${D}/file`, "file", scan), ["documents", D, "file"], "hrms");
    expect(await sent.clone().json()).toEqual({ id: D });
    const [path, init] = vi.mocked(authenticatedBackendFetch).mock.calls[0];
    expect(path).toBe(`/workspaces/${W}/hrms/documents/${D}/file`);
    expect((init!.body as FormData).get("file")).toBeInstanceOf(File);
    expect((await hrmsProxy(upload(`documents/${D}/file`, "photo", scan), ["documents", D, "file"], "hrms")).status).toBe(400);
    expect((await hrmsProxy(upload(`documents/${D}`, "file", scan), ["documents", D], "hrms")).status).toBe(400);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    expect((await hrmsProxy(upload(`documents/${D}/file`, "file", big), ["documents", D, "file"], "hrms")).status).toBe(400);
    expect(authenticatedBackendFetch).toHaveBeenCalledTimes(1);
  });

  it("streams scans and the payroll CSV back as they are", async () => {
    vi.mocked(authenticatedBackendFetch).mockResolvedValue({ upstream: new Response("name,days\n", { status: 200, headers: { "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="payroll-employees-2026-09.csv"' } }) } as never);
    const csv = await hrmsProxy(new Request(`http://localhost/api/workspace/hrms/payroll/export?month=2026-09&kind=employees&workspaceId=${W}`), ["payroll", "export"], "hrms");
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toContain("payroll-employees-2026-09.csv");
    expect(await csv.text()).toBe("name,days\n");
    expect(vi.mocked(authenticatedBackendFetch).mock.calls[0][0]).toBe(`/workspaces/${W}/hrms/payroll/export?month=2026-09&kind=employees`);
    vi.mocked(authenticatedBackendFetch).mockResolvedValue({ upstream: new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }) } as never);
    const scan = await hrmsProxy(new Request(`http://localhost/api/workspace/hrms/documents/${D}/file?workspaceId=${W}`), ["documents", D, "file"], "hrms");
    expect(scan.headers.get("content-type")).toBe("application/pdf");
    expect(scan.headers.get("cache-control")).toBe("private, no-store");
  });
});

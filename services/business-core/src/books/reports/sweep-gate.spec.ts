import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { BooksReportsService } from "./reports.service";

// A Ledger read sweeps the workspace's pending events first. Someone who is not a member of that workspace must not be
// able to trigger it (it writes postings and runs the labour pass) by naming another tenant's workspace id.
describe("ledger reads sweep only for members of the workspace", () => {
  const actor = { subject: "local:outsider", provider: "local", email: "outsider@example.com", displayName: "Outsider" };

  it("refuses before sweeping when the actor is not a member", async () => {
    const access = {
      asMember: vi.fn(async () => { throw new ForbiddenException("Not a member"); }),
      withPermission: vi.fn(),
    };
    const sweep = { runSweepNow: vi.fn() };
    const service = new BooksReportsService(access as never, sweep as never);
    await expect(service.accounts(actor, "other-tenant-workspace", {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(sweep.runSweepNow).not.toHaveBeenCalled();
    expect(access.withPermission).not.toHaveBeenCalled();
  });

  it("sweeps, then reads with the Ledger permission, for a member", async () => {
    const access = {
      asMember: vi.fn(async (_actor: unknown, _workspace: string, work: () => Promise<unknown>) => work()),
      withPermission: vi.fn(async () => ({ accounts: [] })),
    };
    const sweep = { runSweepNow: vi.fn(async () => ({ busy: false })) };
    const service = new BooksReportsService(access as never, sweep as never);
    await expect(service.accounts(actor, "own-workspace", {})).resolves.toEqual({ accounts: [] });
    expect(sweep.runSweepNow).toHaveBeenCalledWith("own-workspace");
    expect(access.withPermission).toHaveBeenCalledWith(actor, "own-workspace", "books.view", expect.any(Function));
  });
});

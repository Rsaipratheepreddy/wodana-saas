import { SuppliersService } from "../../purchasing/suppliers.service";
import { actorOf, type Actor, type Core } from "./core";
import type { SeedData } from "./data";

type Supplier = { id: string; name: string; approval: string; version: number; status: string };

/**
 * The supplier register from Palm's supplier list: company-level facts only, matched by name so a rerun
 * changes nothing. Approval is recorded by the owner (a separate action from saving the supplier).
 */
export async function ensureSuppliers(core: Core, data: SeedData, workspaceId: string, owner: Actor): Promise<Map<string, Supplier>> {
  const actor = actorOf(owner);
  const suppliers = core.get(SuppliersService);
  const legalEntities = ((await suppliers.list(actor, workspaceId)) as { entities: Array<{ id: string }> }).entities.map((entity) => entity.id);
  let state = (await suppliers.list(actor, workspaceId)) as { suppliers: Supplier[] };
  const byName = () => new Map(state.suppliers.filter((row) => row.status !== "archived").map((row) => [row.name.trim().toLowerCase(), row]));
  let current = byName();
  for (const supplier of data.suppliers.suppliers) {
    const key = supplier.name.trim().toLowerCase();
    const found = current.get(key);
    if (found) core.report.record("supplier", "reused");
    const made = found ?? await core.step("supplier", `supplier ${supplier.name}`, async () => null, async () => {
      const body = {
        id: stableSupplierId(workspaceId, key), version: 0, name: supplier.name, categories: supplier.categories, paymentTerms: supplier.paymentTerms,
        ...(supplier.advancePercent ? { advancePercent: supplier.advancePercent } : {}), ...(supplier.creditDays ? { creditDays: supplier.creditDays } : {}), termsNote: supplier.termsNote, deal: supplier.deal, dealNote: supplier.dealNote,
        notes: supplier.notes, ...(supplier.locality ? { locality: supplier.locality } : {}), ...(supplier.email ? { email: supplier.email } : {}), entityIds: legalEntities,
      };
      state = (await suppliers.save(actor, workspaceId, body)) as { suppliers: Supplier[] };
      current = byName();
      return current.get(key)!;
    }).catch((error) => { if (error?.reason) return null; throw error; });
    if (!made) continue;
    if (supplier.approval === "approved" && made.approval !== "approved") {
      await core.ensure("supplier approval", `approve ${supplier.name}`, async () => false, async () => {
        state = (await suppliers.approve(actor, workspaceId, made.id, { version: made.version, approval: "approved", note: supplier.approvalNote })) as { suppliers: Supplier[] };
        current = byName();
      });
    } else if (found) core.report.record("supplier approval", "reused");
  }
  return byName();
}

import { stableId } from "./ids";
function stableSupplierId(workspaceId: string, key: string) { return stableId(workspaceId, `supplier:${key}`); }

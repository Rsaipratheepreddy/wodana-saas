/** Whether accepted packs cover the project: a whole-project pack, or every one of its areas (a project with no areas needs a whole-project pack). */
export function handedOver(packs: Array<{ status: string; areaIds: string[] }>, areaIds: string[]) {
  const accepted = packs.filter((pack) => pack.status === "accepted");
  if (accepted.some((pack) => !pack.areaIds.length)) return true;
  if (!areaIds.length) return false;
  const covered = new Set(accepted.flatMap((pack) => pack.areaIds));
  return areaIds.every((id) => covered.has(id));
}

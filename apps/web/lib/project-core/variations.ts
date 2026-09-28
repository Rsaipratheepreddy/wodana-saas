/** Starts a draft variation of the accepted quotation through the commercial case; returns its id. */
export async function createVariation(workspaceId: string, caseId: string, baselineQuoteId: string) {
  const url = `/api/commercial/cases/${caseId}?${new URLSearchParams({ workspaceId })}`;
  const read = async (response: Response) => {
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Could not start a variation.");
    return data as { data: { revision: number; quotes: Array<{ id: string; number: number; kind: string }> } };
  };
  const current = await read(await fetch(url, { cache: "no-store" }));
  const next = await read(await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "variation", revision: current.data.revision, quoteId: baselineQuoteId }) }));
  return [...next.data.quotes].filter((quote) => quote.kind === "variation").sort((a, b) => b.number - a.number)[0].id;
}

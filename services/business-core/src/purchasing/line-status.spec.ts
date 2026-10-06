import { describe, expect, it } from "vitest";
import { materialsReady } from "./materials-ready";
import { lineStatus, type LineStatus } from "./orders";

const line = (input: Partial<Parameters<typeof lineStatus>[0]>) =>
  lineStatus({ required: "20", placed: "0", received: "0", fromStock: "0", scopeInstalled: false, siteFinished: false, ...input });

describe("a material line's status (PLM-072)", () => {
  it.each<[string, Partial<Parameters<typeof lineStatus>[0]>, LineStatus]>([
    ["nothing ordered", {}, "required"],
    ["part ordered", { placed: "12" }, "required"],
    ["all on placed orders", { placed: "20" }, "ordered"],
    ["part from stock, the rest ordered", { placed: "15", fromStock: "5" }, "ordered"],
    ["part received", { placed: "20", received: "12" }, "ordered"],
    ["all received", { placed: "20", received: "20" }, "received"],
    ["received and given from stock", { placed: "8", received: "8", fromStock: "12" }, "received"],
    ["the scope it's for is installed", { placed: "20", received: "20", scopeInstalled: true }, "installed"],
    ["used nowhere in particular, all in and site work finished", { placed: "20", received: "20", siteFinished: true }, "installed"],
    ["site work finished but not all in", { placed: "20", received: "10", siteFinished: true }, "ordered"],
    ["quantity to confirm, nothing ordered", { required: null }, "required"],
    ["quantity to confirm, ordered", { required: null, placed: "3" }, "ordered"],
    ["quantity to confirm, something in", { required: null, placed: "3", received: "1" }, "received"],
  ])("%s", (_case, input, status) => {
    expect(line(input)).toBe(status);
  });
});

describe("materials ready (PLM-074)", () => {
  const need = (key: string, status: LineStatus, required: string | null = "1") => ({ key, status, required });

  it("is ready only when every line is in", () => {
    expect(materialsReady([])).toBeNull();
    expect(materialsReady([need("material:a", "received"), need("line:b", "ordered")])).toBeNull();
    expect(materialsReady([need("material:a", "received"), need("line:b", "installed")])).toMatchObject({ lines: 2 });
  });

  it("names the set of lines and quantities, in any order, so the same set is told once and a new one again", () => {
    const first = materialsReady([need("material:a", "received", "20"), need("line:b", "received", "4.5")])!;
    expect(materialsReady([need("line:b", "installed", "4.5"), need("material:a", "received", "20")])!.fingerprint).toBe(first.fingerprint);
    expect(materialsReady([need("material:a", "received", "25"), need("line:b", "received", "4.5")])!.fingerprint).not.toBe(first.fingerprint);
    expect(materialsReady([need("material:a", "received", "20"), need("line:b", "received", "4.5"), need("material:c", "received")])!.fingerprint).not.toBe(first.fingerprint);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

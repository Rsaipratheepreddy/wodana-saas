import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseArgs, USAGE } from "./ops-args";
import { parseBrandSpec, readBrandFile } from "./ops-brand";

const base = ["--workspace", "laespace", "--as", "Owner@Example.test"];
const dir = mkdtempSync(join(tmpdir(), "ops-brand-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("operator CLI brand", () => {
  it("parses brand, a dry run unless --apply", () => {
    expect(parseArgs(["brand", ...base, "--file", "brand.json"])).toEqual({ command: "brand", workspace: "laespace", as: "owner@example.test", file: "brand.json", apply: false, json: false });
    expect(parseArgs(["brand", ...base, "--file", "b/brand.json", "--apply", "--json"])).toMatchObject({ apply: true, json: true });
    expect(() => parseArgs(["brand", ...base])).toThrow("--file is required.");
    expect(() => parseArgs(["brand", ...base, "--file", "logo.png"])).toThrow("--file is a brand.json file.");
    expect(() => parseArgs(["brand", ...base, "--file", "brand.json", "--profile", "p.json"])).toThrow("--profile does not apply to brand.");
    expect(USAGE).toContain("brand --workspace <slug> --as <member email> --file <brand.json> [--apply] [--json]");
  });

  it("reads every field, normalising colours, and keeps null as clear", () => {
    expect(parseBrandSpec({ displayName: " La'espace ", primaryColor: "#0b7f5d", secondaryColor: null, headingFont: "alta", bodyFont: "montserrat",
      logo: "logo.png", loginBackground: "art/sign-in.JPG" })).toEqual({ displayName: "La'espace", primaryColor: "#0B7F5D", secondaryColor: null,
      headingFont: "alta", bodyFont: "montserrat", logo: "logo.png", loginBackground: "art/sign-in.JPG" });
    expect(parseBrandSpec({ logo: null })).toEqual({ logo: null });
  });

  it("lists every problem at once, with the allowed font tokens", () => {
    let message = "";
    try {
      parseBrandSpec({ displayName: "X", primaryColor: "green", headingFont: "Inter", bodyFont: "Roboto", logo: "logo.gif", extra: 1 });
    } catch (error) { message = (error as Error).message; }
    expect(message).toContain("unknown fields: extra");
    expect(message).toContain("displayName is 2 to 160 characters");
    expect(message).toContain("primaryColor is a six-digit hex colour");
    expect(message).toContain('headingFont "Inter" is not an allowed font token (allowed: alta, or null)');
    expect(message).toContain('bodyFont "Roboto" is not an allowed font token (allowed: montserrat, or null)');
    expect(message).toContain("logo is a .png, .jpg or .webp file");
    expect(() => parseBrandSpec({})).toThrow("brand.json sets nothing");
    expect(() => parseBrandSpec([])).toThrow("brand.json is a JSON object.");
  });

  it("reads the images relative to brand.json, with their hash, before anything connects", async () => {
    mkdirSync(join(dir, "art"), { recursive: true });
    const logo = Buffer.from("logo-bytes");
    writeFileSync(join(dir, "art", "logo.png"), logo);
    writeFileSync(join(dir, "brand.json"), JSON.stringify({ primaryColor: "#112233", logo: "art/logo.png" }));
    const brand = await readBrandFile(join(dir, "brand.json"));
    expect(brand).toMatchObject({ primaryColor: "#112233", logo: { path: join(dir, "art", "logo.png"), filename: "logo.png", mimeType: "image/png",
      sha256: createHash("sha256").update(logo).digest("hex") } });
    expect(brand).not.toHaveProperty("loginBackground");

    writeFileSync(join(dir, "missing.json"), JSON.stringify({ loginBackground: "nowhere.jpg" }));
    await expect(readBrandFile(join(dir, "missing.json"))).rejects.toThrow(`loginBackground: no file at ${join(dir, "nowhere.jpg")}.`);
    writeFileSync(join(dir, "big.png"), Buffer.alloc(5 * 1024 * 1024 + 1));
    writeFileSync(join(dir, "big.json"), JSON.stringify({ logo: "big.png" }));
    await expect(readBrandFile(join(dir, "big.json"))).rejects.toThrow("the limit is 5 MB");
    await expect(readBrandFile(join(dir, "none.json"))).rejects.toThrow("No brand file at");
  });
});

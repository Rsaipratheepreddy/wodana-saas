#!/usr/bin/env node
// Launcher for the Palm Living showcase seed (src/seed/palm-showcase): runs the compiled seed from dist when it
// exists, otherwise the TypeScript source through ts-node. All arguments and environment pass through.
//   node scripts/seed-palm-showcase.mjs --dry-run | --commit [--rotate-links]
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = resolve(root, "dist/seed/palm-showcase/main.js");
const argv = existsSync(built) ? [built, ...process.argv.slice(2)] : ["-r", "ts-node/register", resolve(root, "src/seed/palm-showcase/main.ts"), ...process.argv.slice(2)];
const result = spawnSync(process.execPath, argv, { cwd: root, stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);

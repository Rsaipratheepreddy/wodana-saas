// Test driver for ops-cli.integration.spec.ts: boots the business-core application context once (from source, through
// ts-node, which keeps the decorator metadata Nest needs) and runs each argv in turn through the CLI's own runOps.
// Prints one JSON line after "@@RESULT@@": [{ code, output }] per run.
const { resolve } = require("node:path");
const root = resolve(__dirname, "../../..");
process.chdir(root);
require("reflect-metadata");
require("ts-node").register({ project: resolve(root, "tsconfig.json"), transpileOnly: true });
const { bootContext, runOps } = require("../ops-cli.ts");
const { parseArgs } = require("../ops-args.ts");

(async () => {
  const runs = JSON.parse(process.argv[2]);
  const app = await bootContext();
  const results = [];
  try {
    for (const argv of runs) {
      const lines = [];
      const output = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
      const code = await runOps(app, parseArgs(argv), output);
      results.push({ code, output: lines.join("\n") });
    }
  } finally {
    await app.close().catch(() => undefined);
  }
  process.stdout.write(`\n@@RESULT@@${JSON.stringify(results)}\n`);
  process.exit(0);
})().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});

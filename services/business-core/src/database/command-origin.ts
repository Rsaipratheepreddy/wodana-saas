import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Where a command came from when it was not a person pressing a button in Wodana: a proposal the person
 * confirmed through Woddy (W-1), an MCP client (W-5), or the operator CLI run on the server (src/ops). The module
 * command runs exactly as it would from its own screen, as the same person; every tenant transaction opened while
 * it runs sets app.command_via (and, for an AI run, app.ai_run_id), and each audit row written in it records them
 * (migration 0162).
 */
export type CommandOrigin = { via: "woddy" | "mcp"; runId: string } | {
  via: "operator_cli"; runId?: undefined;
  /** A dry run: every transaction is rolled back, so even a read that also writes (a default made on first use) leaves nothing. */
  dryRun?: boolean;
};

const storage = new AsyncLocalStorage<CommandOrigin>();

export function runWithCommandOrigin<T>(origin: CommandOrigin, work: () => Promise<T>): Promise<T> {
  return storage.run(origin, work);
}

export function currentCommandOrigin(): CommandOrigin | undefined {
  return storage.getStore();
}

/** True inside an operator CLI dry run: database work is discarded. */
export function commandDryRun(): boolean {
  const origin = storage.getStore();
  return origin?.via === "operator_cli" && origin.dryRun === true;
}

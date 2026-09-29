import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Where a command came from when it was not a person pressing a button in Wodana: a proposal the person
 * confirmed through Woddy (W-1), or later an MCP client (W-5). The module command runs exactly as it would
 * from its own screen, as the same person; every tenant transaction opened while it runs sets
 * app.command_via and app.ai_run_id, and each audit row written in it records them (migration 0162).
 */
export type CommandOrigin = { via: "woddy" | "mcp"; runId: string };

const storage = new AsyncLocalStorage<CommandOrigin>();

export function runWithCommandOrigin<T>(origin: CommandOrigin, work: () => Promise<T>): Promise<T> {
  return storage.run(origin, work);
}

export function currentCommandOrigin(): CommandOrigin | undefined {
  return storage.getStore();
}

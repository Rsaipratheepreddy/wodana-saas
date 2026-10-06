import type { ToolDeclaration } from "../ai-gateway/ai-provider";
import type { AiTool } from "./ai-tool";
import type { ToolServices } from "./tool-services";
import { crmWriteTools } from "./tools/crm-write-tools";
import { COST_PERMISSIONS, productTools } from "./tools/product-tools";
import { readTools } from "./tools/read-tools";
import { workTools } from "./tools/work-tools";

/**
 * What Woddy never does, whoever asks: approve anything, issue or send a quote, verify or record money,
 * release a project or production, publish to the client portal, change settings or permissions, delete,
 * view as someone else, or export data. No tool may be named for these or need a permission that grants them;
 * the registry refuses to start with one.
 */
export const NEVER_TOOL_NAMES = /approve|issue|send_quote|quote_send|verify|payment|money|receipt|invoice|release|production|publish|portal|setting|permission|role|delete|remove_record|erase|archive|view_as|impersonat|export|merge/i;
export const NEVER_PERMISSIONS = /(\.approve|\.approvals|\.issue|\.release|\.publish|\.export|\.erase|\.merge|\.delete|settings\.manage|members\.manage|roles\.|permissions\.|^accounting\.|^receivables\.|^petty_cash\.|^portal\.|^factory\.|money|payments|view_as)/i;

export class AiToolRegistry {
  private readonly byName = new Map<string, AiTool>();

  constructor(tools: AiTool[]) {
    for (const tool of tools) {
      if (NEVER_TOOL_NAMES.test(tool.name)) throw new Error(`Woddy may never have a tool like ${tool.name}`);
      const forbidden = [...tool.permissions, ...(tool.anyPermissions ?? [])].find((code) => NEVER_PERMISSIONS.test(code));
      if (forbidden) throw new Error(`Woddy's ${tool.name} may not rely on ${forbidden}`);
      if (tool.kind === "read" && !tool.run) throw new Error(`${tool.name} reads but has no run()`);
      if (tool.kind === "write" && (!tool.propose || !tool.execute || tool.confirmation !== "confirm")) throw new Error(`${tool.name} writes, so it proposes, executes and needs confirmation`);
      if (tool.kind === "draft" && (!tool.draft || tool.confirmation !== "composer")) throw new Error(`${tool.name} drafts into the composer only`);
      if (this.byName.has(tool.name)) throw new Error(`Two tools are called ${tool.name}`);
      this.byName.set(tool.name, tool);
    }
  }

  /** The first-release catalogue (W-1), over the module services. */
  static catalogue(services: ToolServices) {
    return new AiToolRegistry([...readTools(services), ...productTools(services), ...crmWriteTools(services), ...workTools(services)]);
  }

  get tools(): AiTool[] { return [...this.byName.values()]; }
  get(name: string) { return this.byName.get(name); }

  /** Every permission the catalogue checks, to read the person's in one query. */
  get permissionCodes(): string[] {
    const codes = new Set(["crm.leads.assign", "crm.leads.view", "crm.opportunities.view", "crm.parties.view", "crm.communications.view", "crm.activities.view", "pre_projects.view", "projects.view", "projects.manage", ...COST_PERMISSIONS]);
    for (const tool of this.tools) for (const code of [...tool.permissions, ...(tool.anyPermissions ?? [])]) codes.add(code);
    return [...codes].sort();
  }

  /** The tools this person may use: those whose permissions they hold (their own, never Woddy's). */
  offered(permissions: ReadonlySet<string>): AiTool[] {
    return this.tools.filter((tool) => tool.permissions.every((code) => permissions.has(code))
      && (!tool.anyPermissions?.length || tool.anyPermissions.some((code) => permissions.has(code))));
  }

  /** The tools as the model sees them. */
  static declarations(tools: AiTool[]): ToolDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: `${tool.description}${tool.kind === "write" ? " Nothing changes until the person confirms the card." : ""}`,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    }));
  }

  /** The catalogue as an MCP server (W-5) would list it: name, schema, kind, what it calls, permissions, confirmation. */
  describe(tools = this.tools) {
    return tools.map((tool) => ({
      name: tool.name, description: tool.description, kind: tool.kind, inputSchema: tool.parameters, calls: tool.calls,
      permissions: tool.permissions, anyPermissions: tool.anyPermissions ?? [], confirmation: tool.confirmation,
    }));
  }
}

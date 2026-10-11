import { Injectable } from "@nestjs/common";
import type { ReminderKind } from "../reminders-contract";
import { createSourceRegistry, type ReminderSource, type ReminderSourceRegistry } from "../engine/engine";
import { BUILTIN_REMINDER_SOURCES } from "./index";

/**
 * The reminder sources the engine sweeps, one per kind (plan §6.24a "Source adapter").
 *
 * The built-in sources are listed in `sources/index.ts`. A module that owns its own reminder (the change-request
 * module's "change waiting on the client", `change_request.client_decision`) keeps its source in its own folder and
 * registers it when its module starts:
 *
 *   // change-requests/change-request-reminder.source.ts
 *   export const changeRequestDecisionSource: ReminderSource = {
 *     kind: "change_request.client_decision", module: "projects", audience: "client", critical: false, notify: "engine",
 *     viewPermission: "projects.view", template: { code: "reminders.change_request.client_decision" },
 *     open: (db, workspaceId, { clock, now, limit }) => ...DueItem[] (key `change:<id>`, dueAt = when it went to the client),
 *     stillOpen: (db, workspaceId, keys) => ...the keys still waiting on the client,
 *     deliverClient: (db, workspaceId, delivery) => deliverClientDefault(db, workspaceId, delivery,
 *       { whatsappEvent: "portal.decision_waiting", section: "decisions", approversOnly: true }),
 *   };
 *
 *   // change-requests.module.ts: imports RemindersSourcesModule, and a provider
 *   @Injectable() class ChangeRequestReminders implements OnModuleInit {
 *     constructor(private readonly reminders: ReminderSourceRegistryService) {}
 *     onModuleInit() { this.reminders.register(changeRequestDecisionSource); }
 *   }
 *
 * The kind, its default cadence (2 and 5 days after it reached the client, a staff copy to the owner after two),
 * its templates and its rule in Settings › Reminders already exist; the source only says what is waiting and when
 * it is decided. `register` checks the source against the contract (module, audience, criticality, sender).
 */
@Injectable()
export class ReminderSourceRegistryService {
  private readonly sources = new Map<ReminderKind, ReminderSource>();
  private cached: ReminderSourceRegistry | null = null;

  constructor() {
    for (const source of BUILTIN_REMINDER_SOURCES) this.register(source);
  }

  /** Adds a module's source; a second source for the same kind is refused. */
  register(source: ReminderSource) {
    createSourceRegistry([...this.sources.values(), source]);
    this.sources.set(source.kind, source);
    this.cached = null;
  }

  /**
   * Gives a registered kind its module commands ("Mark done", "Reassign"), bound to the module's own Nest service by
   * a provider that can inject it (reminders/my-day/module-commands.ts).
   */
  attachCommands(kind: ReminderKind, commands: Pick<ReminderSource, "complete" | "reassign">) {
    const source = this.sources.get(kind);
    if (!source) return;
    this.sources.set(kind, { ...source, ...commands });
    this.cached = null;
  }

  registry(): ReminderSourceRegistry {
    return (this.cached ??= createSourceRegistry([...this.sources.values()]));
  }
}

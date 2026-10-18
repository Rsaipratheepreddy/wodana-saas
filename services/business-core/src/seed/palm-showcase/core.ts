import { HttpException, ValidationPipe, type INestApplicationContext, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { PoolClient } from "pg";
import { AppModule } from "../../app.module";
import type { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { TransactionalEmailService } from "../../email/transactional-email.service";

export type Mode = "dry-run" | "commit";
/** What one step did: a record was created, an existing one was reused, or (dry run / blocked) it is still pending. */
export type Outcome = "created" | "reused" | "pending" | "changed";

/** A person the seed acts as: resolved from the database by email, never from a password or token. */
export type Actor = RequestActor & { userId: string; membershipId: string | null; active: boolean };

/** A file handed to a service exactly as the HTTP layer would after multipart parsing. */
export type Upload = { buffer: Buffer; originalname: string; mimetype: string; size: number };

/** The run's ledger: counts per record type, activation links, and what would notify people. */
export class Report {
  readonly counts = new Map<string, Record<Outcome, number>>();
  readonly pending: string[] = [];
  readonly links: Array<{ role: string; name: string; email: string; link: string }> = [];

  /** An activation link is printed the moment it exists: a run that fails later must not lose it. */
  link(entry: { role: string; name: string; email: string; link: string }) {
    this.links.push(entry);
    process.stdout.write(`activation link  ${entry.role.padEnd(18)} ${entry.name.padEnd(28)} ${entry.email.padEnd(36)} ${entry.link}\n`);
  }
  readonly notices: string[] = [];
  readonly notes: string[] = [];

  record(type: string, outcome: Outcome, detail?: string) {
    const row = this.counts.get(type) ?? { created: 0, reused: 0, pending: 0, changed: 0 };
    row[outcome] += 1;
    this.counts.set(type, row);
    if (outcome === "pending" && detail) this.pending.push(`${type}: ${detail}`);
  }

  summary(mode: Mode) {
    const counts = Object.fromEntries([...this.counts.entries()].map(([type, row]) => [type, row]));
    const changes = [...this.counts.values()].reduce((total, row) => total + row.created + row.changed, 0);
    return { mode, changes, counts, pending: this.pending, links: this.links, wouldNotify: this.notices, notes: this.notes };
  }
}

/** Raised by a step when a required input is missing in this run (dry run, or waiting on a person). */
export class Pending extends Error {
  constructor(readonly reason: string) { super(reason); }
}

/**
 * The seed's hold on the running application: the same Nest application context the API runs, so every
 * command goes through the core's own validation, permissions, audit and forced RLS. Nothing signs in.
 */
export class Core {
  private readonly pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  private restoreMail: (() => void) | null = null;

  private constructor(readonly app: INestApplicationContext, readonly mode: Mode, readonly report: Report) {}

  static async open(mode: Mode) {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
    return new Core(app, mode, new Report());
  }

  get commit() { return this.mode === "commit"; }

  get<T>(type: Type<T>): T { return this.app.get(type, { strict: false }); }

  get db(): DatabaseService { return this.get(DatabaseService); }

  /** Runs a body through the API's validation pipe for its DTO, exactly as the controller would. */
  validated<T>(dto: Type<T>, body: unknown): Promise<T> {
    return this.pipe.transform(body, { type: "body", metatype: dto }) as Promise<T>;
  }

  /**
   * Nothing leaves this process by email unless SEED_DELIVER_EMAIL=1: invitations, portal invites and
   * order emails are recorded as "not_configured", the same state as a workspace without a mail provider.
   */
  suppressEmail() {
    if (process.env.SEED_DELIVER_EMAIL === "1" || this.restoreMail) return;
    const mailer = this.get(TransactionalEmailService) as unknown as { send: (message: unknown) => Promise<unknown> };
    const original = mailer.send;
    const notices = this.report.notices;
    mailer.send = async (message: unknown) => {
      const to = (message as { to?: string }).to ?? "?";
      const subject = (message as { subject?: string }).subject ?? "";
      notices.push(`email to ${to}: ${subject}`);
      return { status: "not_configured", provider: null, messageId: null };
    };
    this.restoreMail = () => { mailer.send = original; };
  }

  /** A read inside the tenant's own RLS context. */
  read<T>(workspaceId: string, actorUserId: string, work: (client: PoolClient) => Promise<T>) {
    return this.db.tenantTransaction(workspaceId, actorUserId, work);
  }

  /** The person with this email, as the API would see them after they signed in, plus their standing in the workspace. */
  async actor(workspaceId: string | null, email: string): Promise<Actor | null> {
    const address = email.trim().toLowerCase();
    const user = (await this.db.query<{ id: string; email: string; displayName: string }>(
      `SELECT id, primary_email AS email, display_name AS "displayName" FROM users WHERE primary_email = $1`, [address])).rows[0];
    if (!user) return null;
    const membership = workspaceId ? (await this.read(workspaceId, user.id, (client) => client.query<{ id: string; status: string }>(
      `SELECT id, status FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, user.id]))).rows[0] : undefined;
    return { provider: "local", subject: `local:${user.id}`, email: user.email, displayName: user.displayName, userId: user.id,
      membershipId: membership?.id ?? null, active: membership?.status === "active" };
  }

  /** An actor who must be an active member; otherwise the step waits for them. */
  async member(workspaceId: string, email: string): Promise<Actor> {
    const actor = await this.actor(workspaceId, email);
    if (!actor?.active) throw new Pending(`waiting for ${email} to accept their invitation and sign in once`);
    return actor;
  }

  /**
   * One idempotent step: `find` reads what exists; `create` writes it. In a dry run a missing record is
   * reported as pending and nothing is written. A step whose inputs are still pending is reported, not run.
   */
  async step<T>(type: string, label: string, find: () => Promise<T | null | undefined>, create: () => Promise<T>): Promise<T> {
    let found: T | null | undefined;
    try { found = await find(); } catch (error) { if (error instanceof Pending) { this.report.record(type, "pending", `${label}: ${error.reason}`); throw error; } throw error; }
    if (found !== null && found !== undefined) { this.report.record(type, "reused"); return found; }
    if (!this.commit) { this.report.record(type, "pending", `${label}: would be created`); throw new Pending(`${label} is not created in a dry run`); }
    try {
      const made = await create();
      this.report.record(type, "created");
      return made;
    } catch (error) {
      if (error instanceof Pending) { this.report.record(type, "pending", `${label}: ${error.reason}`); throw error; }
      throw new Error(`${label}: ${describe(error)}`, { cause: error });
    }
  }

  /** A change to an existing record when it differs from what the data says; reported as changed or reused. */
  async ensure(type: string, label: string, same: () => Promise<boolean>, change: () => Promise<unknown>) {
    if (await same()) { this.report.record(type, "reused"); return false; }
    if (!this.commit) { this.report.record(type, "pending", `${label}: would change`); return false; }
    try { await change(); } catch (error) { throw new Error(`${label}: ${describe(error)}`, { cause: error }); }
    this.report.record(type, "changed");
    return true;
  }

  /** Runs a chain of steps; a pending step ends the chain quietly (its reason is already in the report). */
  async chain(label: string, work: () => Promise<void>) {
    try { await work(); } catch (error) {
      if (error instanceof Pending) { this.report.notes.push(`${label} stopped: ${error.reason}`); return; }
      throw error;
    }
  }

  async close() {
    this.restoreMail?.();
    await this.app.close();
  }
}

/** An error as a person reads it: the API message, not a stack. */
export function describe(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    return typeof response === "string" ? response : (response as { message?: string | string[] }).message?.toString() ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function actorOf(actor: Actor): RequestActor {
  return { provider: actor.provider, subject: actor.subject, email: actor.email, displayName: actor.displayName };
}

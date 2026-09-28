import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { viewAsReadOnly } from "../auth/view-as/view-as.context";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>("DATABASE_URL");
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }

    this.pool = new Pool({
      connectionString,
      max: config.get<number>("DATABASE_POOL_SIZE", 10),
      ssl: config.get<string>("DATABASE_SSL", "false") === "true"
        ? { rejectUnauthorized: true }
        : undefined,
      application_name: "wodana-business-core",
    });

    // pg emits idle-client failures on the pool itself. Without a listener,
    // Node treats the event as uncaught and terminates the API process (for
    // example, when PostgreSQL is restarted by an administrator).
    this.pool.on("error", (error) => {
      this.logger.error(`PostgreSQL pool error: ${error.message}`, error.stack);
    });
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Row>> {
    // While someone views as another person, even a single statement runs in a transaction that is discarded.
    if (viewAsReadOnly()) return this.transaction((client) => client.query<Row>(text, values));
    return this.pool.query<Row>(text, values);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    // View as changes nothing, down to the database: its transactions run and are then rolled back, so a read
    // that also writes (a default row made on first use, a "last seen", an audit of a download) leaves no trace.
    const discard = viewAsReadOnly();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query(discard ? "ROLLBACK" : "COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async tenantTransaction<T>(
    workspaceId: string,
    actorUserId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.transaction(async (client) => {
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
      await client.query("SELECT set_config('app.current_actor_id', $1, true)", [actorUserId]);
      return work(client);
    });
  }

  async actorTransaction<T>(
    actorUserId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.transaction(async (client) => {
      await client.query("SELECT set_config('app.current_actor_id', $1, true)", [actorUserId]);
      return work(client);
    });
  }

  async invitationTransaction<T>(
    actorUserId: string,
    tokenHash: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.transaction(async (client) => {
      await client.query("SELECT set_config('app.current_actor_id', $1, true)", [actorUserId]);
      await client.query("SELECT set_config('app.current_invitation_token_hash', $1, true)", [tokenHash]);
      return work(client);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

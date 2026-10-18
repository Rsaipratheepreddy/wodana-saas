import type { Db } from "./engine";

let savepoints = 0;

/** Runs work in a savepoint: a failure rolls back only this work, never the sweep's other steps. */
export async function inSavepoint<T>(db: Db, work: () => Promise<T>): Promise<T> {
  const name = `reminders_${(savepoints = (savepoints + 1) % 1_000_000)}`;
  await db.query(`SAVEPOINT ${name}`);
  try {
    const value = await work();
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await db.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

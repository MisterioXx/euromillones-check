import pg from "pg";

let pool: pg.Pool | undefined;

export function cloudConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
}

export function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error("El almacenamiento compartido no está configurado.");
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });
  return pool;
}

export async function transaction<T>(run: (client: pg.PoolClient) => Promise<T>, deadline?: number): Promise<T> {
  function remainingTime(): number {
    const remaining = deadline === undefined ? 15_000 : Math.floor(deadline - Date.now());
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Se ha agotado el tiempo de la transacción; se conservan los datos anteriores.");
    return Math.max(1, Math.min(15_000, remaining));
  }
  remainingTime();
  const client = await getPool().connect();
  let releaseError: Error | undefined;
  let started = false;
  try {
    remainingTime();
    await client.query("BEGIN");
    started = true;
    const result = await run(client);
    if (deadline !== undefined) {
      await client.query("SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)", [`${remainingTime()}ms`]);
      remainingTime();
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { if (started) await client.query("ROLLBACK"); }
    catch (rollbackError) {
      // A disconnected or aborted connection must never be returned as reusable.
      releaseError = rollbackError instanceof Error ? rollbackError : new Error("No se pudo revertir la transacción.");
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

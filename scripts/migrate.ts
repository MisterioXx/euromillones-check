import { readFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { getAuth } from "../src/server/auth";
import { getPool, transaction } from "../src/server/database";

// Run deliberately against the selected environment, never during a build.
try {
  const migration = await getMigrations(getAuth().options);
  await migration.runMigrations();
  const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await transaction(async (client) => { await client.query(schema); });
  console.log("Esquema de acceso y peñas preparado. No se han importado datos de usuarios.");
} finally { await getPool().end(); }

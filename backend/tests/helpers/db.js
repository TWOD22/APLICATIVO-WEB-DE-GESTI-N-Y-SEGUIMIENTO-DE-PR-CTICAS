/**
 * Utilidades de base de datos para las pruebas.
 * Reconstruye el esquema aplicando todas las migraciones y limpia/siembra los datos base antes de cada suite.
 * Por seguridad solo opera sobre una base cuyo nombre contenga "test".
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/database");

// Las pruebas de integración solo corren si se define TEST_DATABASE_URL.
export const hayBaseDePruebas = () => Boolean(process.env.TEST_DATABASE_URL);

/** Evita ejecutar TRUNCATE sobre una base que no sea claramente de pruebas. */
function asegurarBaseDePruebas() {
  const url = process.env.TEST_DATABASE_URL ?? "";
  const nombre = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!/test/i.test(nombre)) {
    throw new Error(`Por seguridad TEST_DATABASE_URL debe apuntar a una base cuyo nombre contenga "test" (recibido: "${nombre}")`);
  }
}

// Extrae la parte "Up" de una migración (lo que va entre -- Up Migration y -- Down Migration).
const seccionUp = (sql) => {
  const inicio = sql.indexOf("-- Up Migration");
  const fin = sql.indexOf("-- Down Migration");
  return sql.slice(inicio >= 0 ? inicio + "-- Up Migration".length : 0, fin >= 0 ? fin : undefined);
};

/** Recrea el esquema desde cero aplicando TODAS las migraciones (también valida que funcionan en base vacía). */
export async function reconstruirEsquema(pool) {
  asegurarBaseDePruebas();
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  const archivos = (await readdir(path.join(RAIZ, "migrations"))).filter((f) => f.endsWith(".sql")).sort();
  for (const archivo of archivos) {
    await pool.query(seccionUp(await readFile(path.join(RAIZ, "migrations", archivo), "utf8")));
  }
}

/** Vacía todos los datos y vuelve a sembrar los catálogos base. */
export async function limpiarYSembrar(pool, ejecutarSeedBase, opciones) {
  asegurarBaseDePruebas();
  const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  if (rows.length) {
    await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await ejecutarSeedBase(client, opciones);
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

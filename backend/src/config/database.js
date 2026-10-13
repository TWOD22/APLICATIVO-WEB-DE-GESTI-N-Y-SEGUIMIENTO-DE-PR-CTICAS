/**
 * Conexión a PostgreSQL.
 * Exporta el pool de conexiones y funciones auxiliares para consultar, verificar y cerrar la base de datos.
 */
import pg from "pg";
import { env } from "./env.js";
import { logger } from "./logger.js";

// NUMERIC llega como texto desde pg; las notas se manejan con dos decimales exactos.
// DATE se devuelve como texto "YYYY-MM-DD" para evitar corrimientos de zona horaria.
pg.types.setTypeParser(1082, (valor) => valor);

// Pool de conexiones: reutiliza conexiones abiertas en lugar de crear una por consulta.
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Errores en conexiones inactivas (p. ej. la base se reinició): se registran para no perderlos.
pool.on("error", (error) => {
  logger.error({ err: error }, "Error inesperado en una conexión inactiva de PostgreSQL");
});

/** Ejecuta una consulta parametrizada sobre el pool o sobre un cliente transaccional. */
export function consultar(texto, parametros = [], db = pool) {
  return db.query(texto, parametros);
}

/** Comprueba que la base de datos responde. Lanza error si no hay conexión. */
export async function verificarBaseDeDatos() {
  await pool.query("SELECT 1");
  return true;
}

/** Cierra todas las conexiones del pool (se usa al apagar el servidor y al terminar las pruebas). */
export async function cerrarPool() {
  await pool.end();
}

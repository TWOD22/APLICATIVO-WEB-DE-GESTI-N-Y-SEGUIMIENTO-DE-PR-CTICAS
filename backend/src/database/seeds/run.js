/**
 * Ejecutor del seed (`pnpm seed`). Aplica los catálogos base en una transacción y, si se definen las variables SEED_DIRECTOR_*, crea el Director inicial.
 */
import { z } from "zod";
import { pool, cerrarPool } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { ejecutarSeedBase } from "./base.js";

/**
 * Uso: pnpm seed
 * Variables opcionales para crear el Director inicial (debe existir ya en Firebase Auth):
 *   SEED_DIRECTOR_FIREBASE_UID, SEED_DIRECTOR_DOCUMENTO, SEED_DIRECTOR_NOMBRES,
 *   SEED_DIRECTOR_APELLIDOS, SEED_DIRECTOR_CORREO
 * No incluye datos de demostración: nunca se siembran usuarios ficticios automáticamente.
 */
// Valida los datos del Director leídos del entorno.
const esquemaDirector = z.object({
  firebase_uid: z.string().min(10),
  documento: z.string().min(5),
  nombres: z.string().min(2),
  apellidos: z.string().min(2),
  correo: z.string().email(),
});

// Lee las variables SEED_DIRECTOR_* ; si ninguna está definida, no se crea el Director.
function leerDirectorDelEntorno() {
  const entrada = {
    firebase_uid: process.env.SEED_DIRECTOR_FIREBASE_UID,
    documento: process.env.SEED_DIRECTOR_DOCUMENTO,
    nombres: process.env.SEED_DIRECTOR_NOMBRES,
    apellidos: process.env.SEED_DIRECTOR_APELLIDOS,
    correo: process.env.SEED_DIRECTOR_CORREO,
  };
  if (Object.values(entrada).every((valor) => !valor)) return undefined;
  const resultado = esquemaDirector.safeParse(entrada);
  if (!resultado.success) {
    const campos = resultado.error.issues.map((i) => `SEED_DIRECTOR_${i.path[0].toUpperCase()}`).join(", ");
    throw new Error(`Datos del Director incompletos o inválidos: revisa ${campos}`);
  }
  return resultado.data;
}

// Todo se aplica en una transacción: si algo falla se hace ROLLBACK.
async function main() {
  const director = leerDirectorDelEntorno();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await ejecutarSeedBase(client, { director });
    await client.query("COMMIT");
    logger.info(resultado, "Seed base aplicado");
    if (!director) logger.warn("No se creó el Director inicial: define las variables SEED_DIRECTOR_*");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await cerrarPool();
  }
}

main().catch((error) => {
  logger.error({ err: error }, "Falló el seed");
  process.exit(1);
});

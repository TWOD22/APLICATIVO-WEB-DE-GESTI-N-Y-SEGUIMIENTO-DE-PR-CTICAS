/**
 * Ayuda para transacciones de PostgreSQL.
 * Garantiza que varias escrituras relacionadas se guarden todas o ninguna (COMMIT / ROLLBACK).
 */
import { pool } from "../config/database.js";

/**
 * Ejecuta `trabajo(client)` dentro de una transacción PostgreSQL.
 * Los repositorios reciben `client` como último argumento. Si `trabajo` lanza,
 * se hace ROLLBACK y el error se propaga. No hagas llamadas remotas largas aquí dentro.
 */
export async function withTransaction(trabajo, ejecutor = pool) {
  const client = await ejecutor.connect();
  // Si el ROLLBACK falla, la conexión no se devuelve al pool para no reutilizarla en mal estado.
  let descartarConexion = false;
  try {
    // Todo lo que haga `trabajo` con este cliente forma parte de una única transacción.
    await client.query("BEGIN");
    const resultado = await trabajo(client);
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Si el ROLLBACK falla la conexión queda en estado incierto: se descarta.
      descartarConexion = true;
    }
    throw error;
  } finally {
    client.release(descartarConexion);
  }
}

/**
 * Punto de entrada del servidor.
 * Crea la aplicación, abre el puerto y gestiona el apagado ordenado (SIGTERM/SIGINT):
 * deja de aceptar conexiones, cierra el pool de PostgreSQL y finaliza el proceso.
 */
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { cerrarPool } from "./config/database.js";
import { crearApp } from "./app.js";

const app = crearApp();
const servidor = app.listen(env.PORT, () => {
  logger.info({ puerto: env.PORT, entorno: env.NODE_ENV }, "API de prácticas UDI en ejecución");
});

// Evita ejecutar el apagado dos veces si llegan varias señales seguidas.
let cerrando = false;
/** Apaga el servidor de forma ordenada. @param {string} senal Señal del sistema que provocó el cierre. */
async function apagar(senal) {
  if (cerrando) return;
  cerrando = true;
  logger.info({ senal }, "Cerrando servidor");
  // Si el cierre ordenado tarda demasiado, forzar la salida.
  const forzado = setTimeout(() => process.exit(1), 10_000);
  forzado.unref();
  servidor.close(async () => {
    try {
      await cerrarPool();
    } catch (error) {
      logger.error({ err: error }, "Error al cerrar el pool de PostgreSQL");
    }
    process.exit(0);
  });
}

// Señales que envían los orquestadores (SIGTERM) o el usuario con Ctrl+C (SIGINT).
process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));
// Una promesa rechazada sin manejar se registra en el log en lugar de tumbar el proceso en silencio.
process.on("unhandledRejection", (motivo) => logger.error({ err: motivo }, "Promesa rechazada sin manejar"));

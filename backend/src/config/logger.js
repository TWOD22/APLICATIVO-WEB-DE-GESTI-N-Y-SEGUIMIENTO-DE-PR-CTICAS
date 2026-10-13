/**
 * Configuración del logger (pino).
 * Todos los logs del backend usan este objeto.
 */
import pino from "pino";
import { env } from "./env.js";

/**
 * Logger técnico estructurado (JSON). Redacta secretos para que nunca lleguen a los logs.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { servicio: "api-practicas-udi", entorno: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "headers.authorization",
      "*.password",
      "*.contrasena",
      "*.token",
      "*.idToken",
      "*.private_key",
      "*.privateKey",
      "*.enlace_definir_contrasena",
      "FIREBASE_PRIVATE_KEY",
    ],
    censor: "[REDACTADO]",
  },
});

/**
 * Límite de peticiones por IP (protección básica contra abuso y fuerza bruta).
 * Se desactiva en pruebas automáticas.
 */
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { ApiError } from "../utils/apiError.js";

/** Crea un limitador con ventana (ms) y máximo de peticiones configurables; por defecto usa las variables de entorno. */
export function crearLimitador({ ventana_ms = env.RATE_LIMIT_WINDOW_MS, maximo = env.RATE_LIMIT_MAX } = {}) {
  return rateLimit({
    windowMs: ventana_ms,
    limit: maximo,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => env.esTest,
    handler: (_req, _res, next) => next(ApiError.limiteExcedido()),
  });
}

// Limitador general aplicado a toda la API.
export const limitadorGeneral = crearLimitador();

/**
 * Contexto de cada solicitud.
 * Asigna un identificador único (request_id), lo devuelve en la cabecera X-Request-Id
 * y registra al terminar una línea de log con método, ruta, estado, duración y usuario.
 */
import { randomUUID } from "node:crypto";
import { logger } from "../config/logger.js";

// Un request_id enviado por el cliente solo se acepta si es un UUID válido.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Asigna un request_id, lo devuelve en X-Request-Id y registra una línea JSON por solicitud. */
export function requestContext(req, res, next) {
  const entrante = req.get("x-request-id");
  req.id = entrante && UUID_V4.test(entrante) ? entrante : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  const inicio = process.hrtime.bigint();

  res.on("finish", () => {
    const duracion_ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    const nivel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[nivel](
      {
        request_id: req.id,
        metodo: req.method,
        ruta: req.route ? `${req.baseUrl}${req.route.path}` : req.originalUrl.split("?")[0],
        estado_http: res.statusCode,
        duracion_ms: Math.round(duracion_ms * 100) / 100,
        usuario_id: req.auth?.usuario?.id ?? null,
        rol_activo: req.auth?.rolActivo ?? null,
      },
      "solicitud"
    );
  });
  next();
}

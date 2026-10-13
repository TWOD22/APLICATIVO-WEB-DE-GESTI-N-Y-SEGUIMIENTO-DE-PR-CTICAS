/**
 * Middleware para rutas inexistentes: responde 404 con código ROUTE_NOT_FOUND.
 */
import { ApiError } from "../utils/apiError.js";

export function notFound(req, _res, next) {
  next(ApiError.noEncontrado(`La ruta ${req.method} ${req.path} no existe.`, "ROUTE_NOT_FOUND"));
}

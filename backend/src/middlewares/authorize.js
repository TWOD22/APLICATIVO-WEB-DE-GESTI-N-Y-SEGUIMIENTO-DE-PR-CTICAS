/**
 * Middleware de autorización por rol.
 * Uso en rutas: authorize(ROLES.DIRECTOR_PROGRAMA). Debe ir después de `authenticate`.
 */
import { ApiError } from "../utils/apiError.js";

/**
 * Exige que el rol activo (ya validado contra la base de datos) esté entre los permitidos.
 * Los permisos de distintos roles NO se suman: se evalúa solo el rol activo.
 */
export const authorize =
  (...rolesPermitidos) =>
  (req, _res, next) => {
    if (!req.auth) return next(ApiError.noAutenticado());
    if (!req.auth.rolActivo) {
      return next(
        ApiError.prohibido(
          "Selecciona con qué rol deseas actuar antes de continuar.",
          "ROLE_CONTEXT_REQUIRED",
          [{ roles_disponibles: req.auth.roles.map((rol) => rol.codigo) }]
        )
      );
    }
    if (!rolesPermitidos.includes(req.auth.rolActivo)) return next(ApiError.prohibido());
    return next();
  };

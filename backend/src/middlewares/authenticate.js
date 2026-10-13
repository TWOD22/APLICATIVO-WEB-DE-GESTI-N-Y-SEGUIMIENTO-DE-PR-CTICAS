/**
 * Middleware de autenticación.
 * Verifica el token de Firebase, carga al usuario y sus roles desde PostgreSQL y fija `req.auth`
 * (con el rol activo validado). Se aplica a todas las rutas privadas.
 */
import { verificarToken } from "../adapters/firebaseAuthAdapter.js";
import * as authService from "../services/authService.js";
import { ApiError } from "../utils/apiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/** Extrae el token de la cabecera `Authorization: Bearer <token>`; devuelve null si no viene. */
const extraerToken = (req) => {
  const coincidencia = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "");
  return coincidencia ? coincidencia[1].trim() : null;
};

/**
 * 1. Valida el ID Token con Firebase Admin.
 * 2. Resuelve el usuario y sus roles vigentes en PostgreSQL (fuente de verdad).
 * 3. Determina el rol activo desde X-Active-Role (validado contra la base de datos).
 * El rol enviado por el cliente nunca se acepta sin verificar.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extraerToken(req);
  if (!token) throw ApiError.noAutenticado();

  const decodificado = await verificarToken(token);
  const sesion = await authService.resolverSesion(decodificado.uid, req.get("x-active-role")?.trim() || null);

  req.auth = Object.freeze({
    firebaseUid: decodificado.uid,
    usuario: sesion.usuario,
    roles: sesion.roles,
    rolActivo: sesion.rolActivo,
  });
  next();
});

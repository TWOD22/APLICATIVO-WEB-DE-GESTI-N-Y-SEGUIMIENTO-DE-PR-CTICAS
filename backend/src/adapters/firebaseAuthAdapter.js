/**
 * Adaptador de Firebase Authentication.
 * Único lugar del backend que habla con Firebase Auth: verifica tokens, crea/actualiza/elimina
 * identidades, genera enlaces para definir contraseña y revoca sesiones.
 * Firebase guarda credenciales; los roles y datos académicos viven en PostgreSQL.
 */
import { obtenerAuth } from "../config/firebase.js";
import { ApiError } from "../utils/apiError.js";
import { logger } from "../config/logger.js";

/** Traduce errores del SDK de Firebase a errores de la API sin filtrar detalles internos. */
function traducirError(error, accion) {
  if (error instanceof ApiError) return error;
  const codigo = error?.code ?? error?.errorInfo?.code ?? "";
  if (codigo === "auth/email-already-exists") {
    return ApiError.conflicto("Ya existe una cuenta con ese correo.", "EMAIL_ALREADY_EXISTS");
  }
  if (codigo === "auth/user-not-found") {
    return ApiError.noEncontrado("La cuenta de autenticación no existe.", "AUTH_ACCOUNT_NOT_FOUND");
  }
  if (codigo === "auth/invalid-email" || codigo === "auth/invalid-email-verified") {
    return ApiError.solicitudInvalida("El correo no es válido.", [], "INVALID_EMAIL");
  }
  logger.error({ err: error, accion, codigo }, "Fallo al comunicarse con Firebase Auth");
  return ApiError.servicioExterno("No fue posible completar la operación con el servicio de autenticación.", "FIREBASE_AUTH_ERROR");
}

/** Valida un ID Token. Lanza 401 si es inválido, vencido o revocado. */
export async function verificarToken(idToken) {
  try {
    return await obtenerAuth().verifyIdToken(idToken, true);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const codigo = error?.code ?? "";
    if (codigo.startsWith("auth/") && codigo !== "auth/internal-error") {
      throw ApiError.noAutenticado("Tu sesión no es válida o expiró. Inicia sesión de nuevo.", "INVALID_TOKEN");
    }
    throw traducirError(error, "verificarToken");
  }
}

/** Crea la identidad en Firebase SIN contraseña: la persona la define con un enlace seguro. */
export async function crearUsuario({ correo, nombreCompleto }) {
  try {
    const usuario = await obtenerAuth().createUser({
      email: correo,
      displayName: nombreCompleto,
      emailVerified: false,
      disabled: false,
    });
    return usuario.uid;
  } catch (error) {
    throw traducirError(error, "crearUsuario");
  }
}

/** Genera el enlace seguro con el que la persona define su propia contraseña (el sistema nunca la conoce). */
export async function generarEnlaceDefinirContrasena(correo) {
  try {
    return await obtenerAuth().generatePasswordResetLink(correo);
  } catch (error) {
    throw traducirError(error, "generarEnlaceDefinirContrasena");
  }
}

/** Actualiza campos de la identidad en Firebase (correo, nombre, estado deshabilitado). */
export async function actualizarUsuario(uid, cambios) {
  try {
    await obtenerAuth().updateUser(uid, cambios);
  } catch (error) {
    throw traducirError(error, "actualizarUsuario");
  }
}

// Atajos de actualizarUsuario para los cambios más frecuentes.
export const actualizarCorreo = (uid, correo) => actualizarUsuario(uid, { email: correo });
export const actualizarNombre = (uid, nombreCompleto) => actualizarUsuario(uid, { displayName: nombreCompleto });
export const establecerDeshabilitado = (uid, deshabilitado) => actualizarUsuario(uid, { disabled: deshabilitado });

/** Elimina la identidad de Firebase (se usa para deshacer un alta que falló a medias). */
export async function eliminarUsuario(uid) {
  try {
    await obtenerAuth().deleteUser(uid);
  } catch (error) {
    throw traducirError(error, "eliminarUsuario");
  }
}

/** Los Custom Claims son solo una caché de roles: la fuente de verdad es PostgreSQL. */
export async function establecerClaimsRoles(uid, roles) {
  try {
    await obtenerAuth().setCustomUserClaims(uid, { roles });
  } catch (error) {
    throw traducirError(error, "establecerClaimsRoles");
  }
}

/** Invalida los tokens de actualización del usuario: obliga a iniciar sesión de nuevo. */
export async function revocarSesiones(uid) {
  try {
    await obtenerAuth().revokeRefreshTokens(uid);
  } catch (error) {
    throw traducirError(error, "revocarSesiones");
  }
}

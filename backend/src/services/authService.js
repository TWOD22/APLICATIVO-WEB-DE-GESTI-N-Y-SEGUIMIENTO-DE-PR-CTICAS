/**
 * Servicio de sesión.
 * Resuelve quién es el usuario autenticado (a partir del UID de Firebase), qué roles tiene y con cuál actúa,
 * y permite cerrar todas sus sesiones.
 */
import * as userRepository from "../repositories/userRepository.js";
import * as roleRepository from "../repositories/roleRepository.js";
import * as firebaseAuth from "../adapters/firebaseAuthAdapter.js";
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { ApiError } from "../utils/apiError.js";

/**
 * Resuelve la sesión a partir del UID de Firebase. PostgreSQL es la fuente de verdad:
 * estado del usuario, roles vigentes y rol activo. Los Custom Claims NO se usan para decidir.
 */
export async function resolverSesion(firebaseUid, rolSolicitado) {
    // 1) El usuario debe existir en PostgreSQL y estar ACTIVO.
  const usuario = await userRepository.buscarPorFirebaseUid(firebaseUid);
  if (!usuario) {
    throw ApiError.prohibido("Tu cuenta no está registrada en el sistema. Contacta a la Dirección del Programa.", "USER_NOT_REGISTERED");
  }
  if (usuario.estado !== "ACTIVO") {
    throw ApiError.prohibido("Tu cuenta está deshabilitada. Contacta a la Dirección del Programa.", "USER_INACTIVE");
  }
    // 2) Debe tener al menos un rol vigente.
  const roles = await roleRepository.listarRolesVigentes(usuario.id);
  if (!roles.length) {
    throw ApiError.prohibido("Tu cuenta no tiene un rol vigente asignado.", "NO_ACTIVE_ROLES");
  }

    // 3) Rol activo: el solicitado (si lo tiene asignado) o el único rol; si tiene varios y no eligió, queda en null.
  let rolActivo = null;
  if (rolSolicitado) {
    if (!roles.some((rol) => rol.codigo === rolSolicitado)) {
      throw ApiError.prohibido("No tienes asignado el rol solicitado.", "ROLE_NOT_ASSIGNED");
    }
    rolActivo = rolSolicitado;
  } else if (roles.length === 1) {
    rolActivo = roles[0].codigo;
  }
  return { usuario, roles, rolActivo };
}

/** Da forma a la respuesta de GET /me que consume el frontend. `requiere_seleccion_rol` indica que debe elegir un rol. */
export function describirSesion({ usuario, roles, rolActivo }) {
  return {
    usuario: {
      id: usuario.id,
      documento: usuario.documento,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
      nombre_completo: `${usuario.nombres} ${usuario.apellidos}`,
      correo: usuario.correo,
      telefono: usuario.telefono,
      estado: usuario.estado,
    },
    roles: roles.map(({ codigo, nombre }) => ({ codigo, nombre })),
    rol_activo: rolActivo,
    requiere_seleccion_rol: roles.length > 1 && !rolActivo,
  };
}

/** Valida que el rol pertenece al usuario; el cliente lo enviará después en X-Active-Role. */
export function seleccionarRolActivo({ usuario, roles }, rol) {
  const elegido = roles.find((r) => r.codigo === rol);
  if (!elegido) throw ApiError.prohibido("No tienes asignado el rol solicitado.", "ROLE_NOT_ASSIGNED");
  return { rol_activo: elegido.codigo, nombre: elegido.nombre, usuario_id: usuario.id };
}

/** Revoca los tokens de Firebase del usuario (cierre de sesión global) y deja registro en la auditoría. */
export async function cerrarTodasLasSesiones({ usuario }, contexto) {
  await firebaseAuth.revocarSesiones(usuario.firebase_uid);
  await registrarAuditoria({
    contexto,
    accion: "SESIONES_REVOCADAS",
    entidad: "usuarios",
    entidad_id: usuario.id,
  });
  return { sesiones_revocadas: true };
}

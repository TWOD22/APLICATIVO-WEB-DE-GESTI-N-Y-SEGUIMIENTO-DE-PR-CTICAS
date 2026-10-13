/**
 * Servicio de notificaciones: bandeja del usuario autenticado, almacenada en Firestore.
 */
import { leerNotificaciones, marcarNotificacionLeida, marcarTodasLeidas } from "../adapters/firestoreAdapter.js";
import { ApiError } from "../utils/apiError.js";

/**
 * Bandeja de notificaciones del usuario autenticado. Pertenecen a la persona (no al rol activo): quien tiene
 * varios roles ve todas en una sola bandeja. Nadie puede leer ni marcar las de otro usuario porque la ruta
 * siempre se arma con el firebase_uid de la sesión.
 */
export async function listar({ page, page_size, solo_no_leidas }, sesion) {
  const todas = await leerNotificaciones(sesion.usuario.firebase_uid);
  const noLeidas = todas.filter((n) => !n.leida).length;
  const visibles = solo_no_leidas ? todas.filter((n) => !n.leida) : todas;
  const desde = (page - 1) * page_size;
  return { filas: visibles.slice(desde, desde + page_size), total: visibles.length, no_leidas: noLeidas };
}

/** Marca una notificación como leída. */
export async function marcarLeida(id, sesion) {
  const notificacion = await marcarNotificacionLeida(sesion.usuario.firebase_uid, id);
  if (!notificacion) throw ApiError.noEncontrado("La notificación no existe.", "NOTIFICATION_NOT_FOUND");
  return notificacion;
}

/** Marca todas las notificaciones como leídas. */
export async function marcarTodasComoLeidas(sesion) {
  return { actualizadas: await marcarTodasLeidas(sesion.usuario.firebase_uid) };
}

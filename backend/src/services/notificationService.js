/**
 * Servicio de notificaciones: bandeja del usuario autenticado. Con EVENTS_MODE=direct se lee de Firestore (como antes);
 * con EVENTS_MODE=outbox vive en el servicio de notificaciones y auditoría y se consulta con llamadas firmadas.
 */
import { modoEventos } from "../adapters/eventosAdapter.js";
import { eliminarNotificacion, eliminarTodasNotificaciones, leerNotificaciones, marcarNotificacionLeida, marcarTodasLeidas } from "../adapters/firestoreAdapter.js";
import { eliminarRemota, eliminarTodasRemotas, leerNotificacionesRemotas, marcarLeidaRemota, marcarTodasLeidasRemotas } from "../adapters/notificacionesRemotas.js";
import { ApiError } from "../utils/apiError.js";

const remoto = () => modoEventos() === "outbox";

/**
 * Bandeja de notificaciones del usuario autenticado. Pertenecen a la persona (no al rol activo): quien tiene
 * varios roles ve todas en una sola bandeja. Nadie puede leer ni marcar las de otro usuario porque la ruta
 * siempre se arma con el firebase_uid de la sesión.
 */
export async function listar({ page, page_size, solo_no_leidas }, sesion) {
  const todas = await (remoto() ? leerNotificacionesRemotas : leerNotificaciones)(sesion.usuario.firebase_uid);
  const noLeidas = todas.filter((n) => !n.leida).length;
  const visibles = solo_no_leidas ? todas.filter((n) => !n.leida) : todas;
  const desde = (page - 1) * page_size;
  return { filas: visibles.slice(desde, desde + page_size), total: visibles.length, no_leidas: noLeidas };
}

/** Marca una notificación como leída. */
export async function marcarLeida(id, sesion) {
  const notificacion = await (remoto() ? marcarLeidaRemota : marcarNotificacionLeida)(sesion.usuario.firebase_uid, id);
  if (!notificacion) throw ApiError.noEncontrado("La notificación no existe.", "NOTIFICATION_NOT_FOUND");
  return notificacion;
}

/** Marca todas las notificaciones como leídas. */
export async function marcarTodasComoLeidas(sesion) {
  return { actualizadas: await (remoto() ? marcarTodasLeidasRemotas : marcarTodasLeidas)(sesion.usuario.firebase_uid) };
}

/** Borra una notificación de la bandeja del usuario. */
export async function eliminar(id, sesion) {
  const existia = await (remoto() ? eliminarRemota : eliminarNotificacion)(sesion.usuario.firebase_uid, id);
  if (!existia) throw ApiError.noEncontrado("La notificación no existe.", "NOTIFICATION_NOT_FOUND");
  return { eliminada: true };
}

/** Borra todas las notificaciones del usuario. */
export async function eliminarTodas(sesion) {
  return { eliminadas: await (remoto() ? eliminarTodasRemotas : eliminarTodasNotificaciones)(sesion.usuario.firebase_uid) };
}

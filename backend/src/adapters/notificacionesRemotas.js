/**
 * Cliente de la bandeja de notificaciones que vive en el servicio de notificaciones y auditoría (quanta 2).
 * Cada llamada va firmada con HMAC sobre "<MÉTODO> <ruta>" y el secreto compartido.
 */
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/apiError.js";
import { firmar } from "../utils/firmaEventos.js";

const TIMEOUT_MS = 5000;
let fetchImpl = null; // null = usar el fetch global en cada llamada
let configuracion = { url: env.NOTIFICATIONS_SERVICE_URL, secreto: env.EVENTS_SHARED_SECRET };

/** Solo para pruebas: sustituye fetch y/o la configuración. */
export function configurarClienteParaPruebas({ fetch: f, url, secreto } = {}) {
  if (f) fetchImpl = f;
  if (url !== undefined || secreto !== undefined) configuracion = { url: url ?? configuracion.url, secreto: secreto ?? configuracion.secreto };
}

const errorDeServicio = (mensaje, causa) => {
  logger.error({ err: causa?.message ?? causa }, "Fallo al consultar el servicio de notificaciones");
  return ApiError.servicioExterno(mensaje, "NOTIFICATION_STORE_ERROR");
};

/** Llama al servicio. Devuelve { estado, json }. Lanza NOTIFICATION_STORE_ERROR si no responde o responde 5xx/401. */
async function llamar(metodo, ruta, mensajeDeError) {
  const { url, secreto } = configuracion;
  if (!url || !secreto) throw errorDeServicio(mensajeDeError, "Falta NOTIFICATIONS_SERVICE_URL o EVENTS_SHARED_SECRET");
  const marca = String(Math.floor(Date.now() / 1000));
  let respuesta;
  try {
    respuesta = await (fetchImpl ?? globalThis.fetch)(`${url.replace(/\/$/, "")}${ruta}`, {
      method: metodo,
      headers: { "X-Timestamp": marca, "X-Signature": firmar(`${metodo} ${ruta}`, marca, secreto) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw errorDeServicio(mensajeDeError, error);
  }
  let json = null;
  try {
    json = await respuesta.json();
  } catch {
    /* cuerpo vacío o no JSON */
  }
  if (respuesta.status >= 500 || respuesta.status === 401) throw errorDeServicio(mensajeDeError, `respondió ${respuesta.status}`);
  return { estado: respuesta.status, json };
}

const base = (uid) => `/users/${encodeURIComponent(uid)}/notifications`;

/** Notificaciones del usuario, la más nueva primero. */
export async function leerNotificacionesRemotas(firebaseUid) {
  const { estado, json } = await llamar("GET", base(firebaseUid), "No se pudieron consultar las notificaciones. Intenta de nuevo.");
  if (estado !== 200) throw errorDeServicio("No se pudieron consultar las notificaciones. Intenta de nuevo.", `respondió ${estado}`);
  return json?.data ?? [];
}

/** Marca una como leída; null si no existe. */
export async function marcarLeidaRemota(firebaseUid, notificacionId) {
  const mensaje = "No se pudo marcar la notificación como leída. Intenta de nuevo.";
  const { estado, json } = await llamar("PATCH", `${base(firebaseUid)}/${encodeURIComponent(notificacionId)}/read`, mensaje);
  if (estado === 404) return null;
  if (estado !== 200) throw errorDeServicio(mensaje, `respondió ${estado}`);
  return json?.data ?? null;
}

/** Marca todas como leídas; devuelve cuántas cambió. */
export async function marcarTodasLeidasRemotas(firebaseUid) {
  const mensaje = "No se pudieron marcar las notificaciones como leídas. Intenta de nuevo.";
  const { estado, json } = await llamar("POST", `${base(firebaseUid)}/read-all`, mensaje);
  if (estado !== 200) throw errorDeServicio(mensaje, `respondió ${estado}`);
  return json?.data?.marcadas ?? 0;
}

/** Borra una; false si no existe. */
export async function eliminarRemota(firebaseUid, notificacionId) {
  const mensaje = "No se pudo borrar la notificación. Intenta de nuevo.";
  const { estado } = await llamar("DELETE", `${base(firebaseUid)}/${encodeURIComponent(notificacionId)}`, mensaje);
  if (estado === 404) return false;
  if (estado !== 200) throw errorDeServicio(mensaje, `respondió ${estado}`);
  return true;
}

/** Borra todas; devuelve cuántas. */
export async function eliminarTodasRemotas(firebaseUid) {
  const mensaje = "No se pudieron borrar las notificaciones. Intenta de nuevo.";
  const { estado, json } = await llamar("DELETE", base(firebaseUid), mensaje);
  if (estado !== 200) throw errorDeServicio(mensaje, `respondió ${estado}`);
  return json?.data?.eliminadas ?? 0;
}

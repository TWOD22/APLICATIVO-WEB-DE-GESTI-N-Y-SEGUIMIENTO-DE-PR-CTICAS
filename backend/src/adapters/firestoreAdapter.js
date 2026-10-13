/**
 * Adaptador de Firestore.
 * Guarda lo que necesita tiempo real o escritura rápida y NO es la fuente de verdad:
 *   - /auditoria: eventos inmutables de trazabilidad.
 *   - /notificaciones_usuario: bandeja de notificaciones de cada usuario.
 *   - /borradores_bitacora: autoguardado de la bitácora antes del envío definitivo.
 * Los datos oficiales siempre se confirman en PostgreSQL.
 */
import { randomUUID } from "node:crypto";
import { obtenerFirestore, marcaDeTiempoServidor, firebaseConfigurado } from "../config/firebase.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/apiError.js";

/**
 * Registra un evento inmutable en /auditoria (solo Firebase Admin puede escribir).
 * Es "mejor esfuerzo": si Firestore falla, el error se registra en el log técnico y
 * NO revierte la operación académica ya confirmada en PostgreSQL.
 */
export async function registrarAuditoria({
  contexto,
  accion,
  entidad,
  entidad_id,
  valor_anterior = null,
  valor_nuevo = null,
}) {
  const evento = {
    actor_usuario_id: contexto?.actor?.usuario_id ?? null,
    actor_firebase_uid: contexto?.actor?.firebase_uid ?? null,
    accion,
    entidad,
    entidad_id: String(entidad_id),
    valor_anterior,
    valor_nuevo,
    direccion_ip: contexto?.direccion_ip ?? null,
    agente_usuario: contexto?.agente_usuario ?? null,
    id_solicitud: contexto?.request_id ?? null,
  };
  try {
    if (!firebaseConfigurado()) {
      logger.warn({ accion, entidad, entidad_id }, "Firestore no configurado: evento de auditoría no persistido");
      return false;
    }
    await obtenerFirestore()
      .collection("auditoria")
      .doc(randomUUID())
      .set({ ...evento, fecha_servidor: marcaDeTiempoServidor() });
    return true;
  } catch (error) {
    logger.error({ err: error, accion, entidad, entidad_id }, "No se pudo registrar el evento de auditoría");
    return false;
  }
}

/** Crea una notificación en tiempo real para un usuario (mejor esfuerzo). */
export async function crearNotificacion(firebaseUid, { tipo, titulo, mensaje, ruta_destino = null, prioridad = "normal", entidad = null }) {
  try {
    if (!firebaseConfigurado()) return false;
    await obtenerFirestore()
      .collection("notificaciones_usuario")
      .doc(firebaseUid)
      .collection("elementos")
      .doc(randomUUID())
      .set({
        tipo,
        titulo,
        mensaje,
        ruta_destino,
        prioridad,
        entidad,
        leida: false,
        fecha: marcaDeTiempoServidor(),
      });
    return true;
  } catch (error) {
    logger.error({ err: error, tipo }, "No se pudo crear la notificación");
    return false;
  }
}

// ───────────────────────── Lectura de notificaciones ─────────────────────────
// /notificaciones_usuario/{uid}/elementos/{id}. La interfaz puede escucharlas en tiempo real con las reglas de
// Firestore; estas funciones son la vía REST (listado inicial, marcar como leída) y respetan el mismo documento.

/** Máximo de notificaciones recientes que se leen por consulta (acota el costo de lecturas en Firestore). */
export const NOTIFICACIONES_TOPE_LECTURA = 200;

const elementos = (firebaseUid) => obtenerFirestore().collection("notificaciones_usuario").doc(firebaseUid).collection("elementos");

// Referencia a la subcolección de notificaciones de un usuario.
function errorDeNotificaciones(error, mensaje) {
  if (error instanceof ApiError) return error;
  logger.error({ err: error }, "Fallo en Firestore (notificaciones)");
  return ApiError.servicioExterno(mensaje, "NOTIFICATION_STORE_ERROR");
}

/** Marca de tiempo de Firestore (o fecha) a ISO 8601; null si todavía no tiene valor. */
const aIso = (valor) => {
  const fecha = typeof valor?.toDate === "function" ? valor.toDate() : valor instanceof Date ? valor : null;
  return fecha ? fecha.toISOString() : null;
};

// Convierte un documento de Firestore al formato que consume el frontend.
const aNotificacion = (id, datos) => ({
  id,
  tipo: datos.tipo ?? null,
  titulo: datos.titulo ?? "",
  mensaje: datos.mensaje ?? "",
  ruta_destino: datos.ruta_destino ?? null,
  prioridad: datos.prioridad ?? "normal",
  entidad: datos.entidad ?? null,
  leida: Boolean(datos.leida),
  fecha: aIso(datos.fecha),
  leida_en: aIso(datos.leida_en),
});

/** Las notificaciones más recientes del usuario (la más nueva primero), hasta NOTIFICACIONES_TOPE_LECTURA. */
export async function leerNotificaciones(firebaseUid) {
  try {
    if (!firebaseConfigurado()) throw new Error("Firestore no configurado");
    const instantanea = await elementos(firebaseUid).orderBy("fecha", "desc").limit(NOTIFICACIONES_TOPE_LECTURA).get();
    return instantanea.docs.map((doc) => aNotificacion(doc.id, doc.data()));
  } catch (error) {
    throw errorDeNotificaciones(error, "No se pudieron consultar las notificaciones. Intenta de nuevo.");
  }
}

/** Marca una notificación como leída. Devuelve null si no existe en la bandeja del usuario. Es idempotente. */
export async function marcarNotificacionLeida(firebaseUid, notificacionId) {
  try {
    if (!firebaseConfigurado()) throw new Error("Firestore no configurado");
    const referencia = elementos(firebaseUid).doc(notificacionId);
    const instantanea = await referencia.get();
    if (!instantanea.exists) return null;
    const datos = instantanea.data();
    if (datos.leida) return aNotificacion(notificacionId, datos);
    await referencia.update({ leida: true, leida_en: marcaDeTiempoServidor() });
    const despues = await referencia.get();
    return aNotificacion(notificacionId, despues.data());
  } catch (error) {
    throw errorDeNotificaciones(error, "No se pudo marcar la notificación como leída. Intenta de nuevo.");
  }
}

/** Marca como leídas todas las pendientes del usuario (por lotes de 400). Devuelve cuántas cambió. */
export async function marcarTodasLeidas(firebaseUid) {
  try {
    if (!firebaseConfigurado()) throw new Error("Firestore no configurado");
    const firestore = obtenerFirestore();
    let total = 0;
    for (;;) {
      const pendientes = await elementos(firebaseUid).where("leida", "==", false).limit(400).get();
      if (pendientes.empty) break;
      const lote = firestore.batch();
      for (const doc of pendientes.docs) lote.update(doc.ref, { leida: true, leida_en: marcaDeTiempoServidor() });
      await lote.commit();
      total += pendientes.size;
      if (pendientes.size < 400) break;
    }
    return total;
  } catch (error) {
    throw errorDeNotificaciones(error, "No se pudieron marcar las notificaciones como leídas. Intenta de nuevo.");
  }
}

// ───────────────────────── Borradores de bitácora ─────────────────────────
// /borradores_bitacora/{bitacora_id}: reflexión y respuestas temporales con autoguardado.
// PostgreSQL sigue siendo la fuente de verdad: el borrador solo se copia a las tablas oficiales al enviar.

// Colección de Firestore donde se guarda el borrador de cada bitácora (el id del documento es el de la bitácora).
const COLECCION_BORRADORES = "borradores_bitacora";

function errorDeBorradores(error, mensaje) {
  if (error instanceof ApiError) return error;
  logger.error({ err: error }, "Fallo en Firestore (borradores de bitácora)");
  return ApiError.servicioExterno(mensaje, "DRAFT_STORE_ERROR");
}

// Normaliza los datos del borrador con valores por defecto seguros.
function aBorrador(datos) {
  return {
    reflexion: datos.reflexion ?? "",
    respuestas: Array.isArray(datos.respuestas) ? datos.respuestas : [],
    revision: datos.revision ?? 0,
    guardado_en: datos.guardado_en ?? null,
    bloqueado: Boolean(datos.bloqueado),
  };
}

/** Devuelve el borrador o null si todavía no existe. Lanza DRAFT_STORE_ERROR si Firestore no responde. */
export async function leerBorrador(bitacoraId) {
  try {
    if (!firebaseConfigurado()) throw new Error("Firestore no configurado");
    const instantanea = await obtenerFirestore().collection(COLECCION_BORRADORES).doc(bitacoraId).get();
    return instantanea.exists ? aBorrador(instantanea.data()) : null;
  } catch (error) {
    throw errorDeBorradores(error, "No se pudo leer el borrador de la bitácora. Intenta de nuevo.");
  }
}

/**
 * Guarda el borrador con control optimista de concurrencia: `revisionBase` debe ser la revisión que el
 * cliente vio por última vez; si otra pestaña guardó antes, se rechaza con DRAFT_CONFLICT (409) y se devuelve
 * la revisión vigente para que la interfaz recargue. `desbloquear` solo se usa cuando PostgreSQL ya autorizó
 * volver a editar (bitácora devuelta).
 */
export async function guardarBorrador(bitacoraId, { propietarioUid, reflexion, respuestas, revisionBase, desbloquear = false }) {
  try {
    if (!firebaseConfigurado()) throw new Error("Firestore no configurado");
    const firestore = obtenerFirestore();
    const referencia = firestore.collection(COLECCION_BORRADORES).doc(bitacoraId);
    return await firestore.runTransaction(async (transaccion) => {
      const instantanea = await transaccion.get(referencia);
      const actual = instantanea.exists ? aBorrador(instantanea.data()) : null;
      const revisionActual = actual?.revision ?? 0;
      if (revisionActual !== revisionBase) {
        throw ApiError.conflicto(
          "El borrador cambió en otra pestaña o dispositivo. Recarga para continuar con la última versión.",
          "DRAFT_CONFLICT",
          [{ revision_actual: revisionActual }]
        );
      }
      if (actual?.bloqueado && !desbloquear) {
        throw ApiError.conflicto("El borrador está bloqueado porque la bitácora ya fue enviada.", "DRAFT_LOCKED");
      }
      const nuevo = {
        bitacora_id: bitacoraId,
        propietario_uid: propietarioUid,
        reflexion,
        respuestas,
        revision: revisionActual + 1,
        bloqueado: false,
        guardado_en: new Date().toISOString(),
        actualizado_en: marcaDeTiempoServidor(),
      };
      transaccion.set(referencia, nuevo);
      return aBorrador(nuevo);
    });
  } catch (error) {
    throw errorDeBorradores(error, "No se pudo guardar el borrador. Tu texto sigue en pantalla: intenta de nuevo.");
  }
}

/** Crea/reemplaza el borrador con contenido oficial (al devolver una bitácora). Mejor esfuerzo. */
export async function sembrarBorrador(bitacoraId, { propietarioUid, reflexion, respuestas, revision }) {
  try {
    if (!firebaseConfigurado()) return false;
    await obtenerFirestore().collection(COLECCION_BORRADORES).doc(bitacoraId).set({
      bitacora_id: bitacoraId,
      propietario_uid: propietarioUid,
      reflexion,
      respuestas,
      revision,
      bloqueado: false,
      guardado_en: new Date().toISOString(),
      actualizado_en: marcaDeTiempoServidor(),
    });
    return true;
  } catch (error) {
    logger.error({ err: error, bitacora_id: bitacoraId }, "No se pudo sembrar el borrador de la bitácora devuelta");
    return false;
  }
}

/** Bloquea el borrador tras el envío definitivo. Mejor esfuerzo: PostgreSQL ya impide editar. */
export async function bloquearBorrador(bitacoraId) {
  try {
    if (!firebaseConfigurado()) return false;
    await obtenerFirestore()
      .collection(COLECCION_BORRADORES)
      .doc(bitacoraId)
      .set({ bloqueado: true, enviado_en: new Date().toISOString() }, { merge: true });
    return true;
  } catch (error) {
    logger.error({ err: error, bitacora_id: bitacoraId }, "No se pudo bloquear el borrador tras el envío");
    return false;
  }
}

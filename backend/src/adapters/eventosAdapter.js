/**
 * Puente entre los avisos/auditoría del negocio y el servicio de notificaciones y auditoría (quanta 2).
 *
 * Con EVENTS_MODE=direct (por defecto) nada de esto se usa: el adaptador de Firestore escribe como siempre.
 * Con EVENTS_MODE=outbox, `registrarAuditoria` y `crearNotificacion` dejan un evento en el outbox (PostgreSQL) y el
 * publicador lo envía por HTTP firmado. Los puntos de llamada del negocio no cambian.
 *
 * Igual que antes, es "mejor esfuerzo": si no se puede guardar el evento se registra en el log y la operación académica
 * ya confirmada no se revierte.
 */
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { emitirEvento } from "../services/eventService.js";

let modo = env.EVENTS_MODE;

/** "direct" o "outbox". */
export const modoEventos = () => modo;

/** Solo para pruebas: cambia el modo sin reiniciar el proceso. */
export function usarModoEventosParaPruebas(nuevoModo) {
  if (!["direct", "outbox"].includes(nuevoModo)) throw new Error(`Modo de eventos inválido: ${nuevoModo}`);
  modo = nuevoModo;
}

/** Encola un evento de auditoría. Devuelve true si quedó guardado. */
export async function emitirAuditoria({ contexto, accion, entidad, entidad_id, valor_anterior = null, valor_nuevo = null }) {
  try {
    await emitirEvento({
      tipo: `auditoria.${accion}`,
      contexto,
      entidadTipo: entidad,
      entidadId: entidad_id,
      carga: { valor_anterior, valor_nuevo },
    });
    return true;
  } catch (error) {
    logger.error({ err: error, accion, entidad, entidad_id }, "No se pudo encolar el evento de auditoría");
    return false;
  }
}

/** Encola un aviso para una persona. Devuelve true si quedó guardado. */
export async function emitirNotificacion(firebaseUid, { tipo, titulo, mensaje, ruta_destino = null, prioridad = "normal", entidad = null }) {
  try {
    await emitirEvento({
      tipo: `notificacion.${tipo}`,
      entidadTipo: entidad?.tipo ?? "aviso",
      entidadId: entidad?.id ?? randomUUID(),
      destinatarios: [{ firebase_uid: firebaseUid }],
      carga: { titulo, mensaje, ruta_destino, prioridad, entidad },
    });
    return true;
  } catch (error) {
    logger.error({ err: error, tipo }, "No se pudo encolar la notificación");
    return false;
  }
}

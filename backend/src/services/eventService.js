/**
 * Emisión de eventos del servicio principal hacia el servicio de notificaciones y auditoría.
 *
 * Formato del evento (versión 1):
 *   { id, tipo, version, ocurrido_en, actor: { usuario_id, firebase_uid, rol }, entidad: { tipo, id },
 *     destinatarios: [{ firebase_uid, usuario_id? }], carga: {...}, contexto: { ip, agente, request_id } }
 * `tipo` empieza por "auditoria." (huella inmutable) o "notificacion." (aviso a destinatarios).
 */
import { randomUUID } from "node:crypto";
import * as outboxRepository from "../repositories/outboxRepository.js";

export const VERSION_EVENTO = 1;
const TIPO_VALIDO = /^(auditoria|notificacion)\.[A-Za-z0-9_.-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guarda el evento en el outbox. Con `db` (client de una transacción) queda atado al cambio de negocio;
 * sin él se guarda de inmediato. Devuelve el id del evento.
 */
export async function emitirEvento({ tipo, contexto = null, entidadTipo, entidadId, destinatarios = [], carga = {} }, db) {
  if (!TIPO_VALIDO.test(tipo)) throw new Error(`Tipo de evento inválido: ${tipo}`);
  if (!UUID.test(String(entidadId))) throw new Error(`El evento ${tipo} necesita el id (uuid) de la entidad`);
  const id = randomUUID();
  await outboxRepository.insertar(
    {
      id, tipo, version: VERSION_EVENTO, actorId: contexto?.actor?.usuario_id ?? null,
      entidadTipo, entidadId, destinatarios,
      carga: {
        ...carga,
        _actor: contexto?.actor ?? null,
        _contexto: contexto ? { ip: contexto.direccion_ip ?? null, agente: contexto.agente_usuario ?? null, request_id: contexto.request_id ?? null } : null,
      },
    },
    db
  );
  return id;
}

/** Arma el sobre que se envía por HTTP a partir de la fila del outbox. */
export function armarSobre(fila) {
  const { _actor, _contexto, ...carga } = fila.carga ?? {};
  return {
    id: fila.id,
    tipo: fila.tipo,
    version: fila.version,
    ocurrido_en: new Date(fila.creado_en).toISOString(),
    actor: _actor ?? null,
    entidad: { tipo: fila.entidad_tipo, id: fila.entidad_id },
    destinatarios: fila.destinatarios,
    carga,
    contexto: _contexto ?? null,
  };
}

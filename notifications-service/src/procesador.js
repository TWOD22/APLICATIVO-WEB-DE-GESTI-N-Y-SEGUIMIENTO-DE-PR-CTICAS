/**
 * Procesa un evento ya validado: lo convierte en un documento de auditoría o en notificaciones y lo guarda de forma
 * idempotente. Devuelve { duplicado, auditorias, notificaciones }.
 */
import { aDocumentoAuditoria, aNotificaciones } from "./sobre.js";

export async function procesarEvento(sobre, almacen) {
  const esAuditoria = sobre.tipo.startsWith("auditoria.");
  const auditoria = esAuditoria ? aDocumentoAuditoria(sobre) : null;
  const notificaciones = esAuditoria ? [] : aNotificaciones(sobre);
  const nuevo = await almacen.guardarEvento({ eventoId: sobre.id, auditoria, notificaciones });
  return { duplicado: !nuevo, auditorias: auditoria ? 1 : 0, notificaciones: notificaciones.length };
}

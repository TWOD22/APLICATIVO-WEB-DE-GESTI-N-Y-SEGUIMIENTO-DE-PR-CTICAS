/**
 * Contrato del evento que llega del servicio principal (versión 1) y su conversión a documentos de auditoría y notificación.
 */
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "uuid inválido");

export const esquemaSobre = z.object({
  id: uuid,
  tipo: z.string().regex(/^(auditoria|notificacion)\.[A-Za-z0-9_.-]{1,80}$/, "tipo inválido"),
  version: z.literal(1),
  ocurrido_en: z.string().datetime({ offset: true }),
  actor: z.object({ usuario_id: z.string().nullable().optional(), firebase_uid: z.string().nullable().optional(), rol_activo: z.string().nullable().optional() }).nullable(),
  entidad: z.object({ tipo: z.string().min(1).max(60), id: z.string().min(1).max(80) }),
  destinatarios: z.array(z.object({ firebase_uid: z.string().min(1).max(128) })).max(500),
  carga: z.record(z.unknown()),
  contexto: z.object({ ip: z.string().nullable(), agente: z.string().nullable(), request_id: z.string().nullable() }).nullable(),
});

/** Documento de auditoría (mismos campos que escribía el backend en /auditoria). */
export function aDocumentoAuditoria(s) {
  const { valor_anterior = null, valor_nuevo = null } = s.carga;
  return {
    evento_id: s.id,
    actor_usuario_id: s.actor?.usuario_id ?? null,
    actor_firebase_uid: s.actor?.firebase_uid ?? null,
    accion: s.tipo.slice("auditoria.".length),
    entidad: s.entidad.tipo,
    entidad_id: s.entidad.id,
    valor_anterior,
    valor_nuevo,
    direccion_ip: s.contexto?.ip ?? null,
    agente_usuario: s.contexto?.agente ?? null,
    id_solicitud: s.contexto?.request_id ?? null,
    fecha_evento: new Date(s.ocurrido_en),
  };
}

/** Una notificación por destinatario, con id determinista (evento + posición) para que reprocesar no duplique. */
export function aNotificaciones(s) {
  const { titulo = "", mensaje = "", ruta_destino = null, prioridad = "normal", entidad = null } = s.carga;
  const tipo = s.tipo.slice("notificacion.".length);
  return s.destinatarios.map((d, i) => ({
    id: `${s.id}_${i}`,
    firebase_uid: d.firebase_uid,
    datos: { tipo, titulo: String(titulo), mensaje: String(mensaje), ruta_destino, prioridad, entidad, leida: false, fecha: new Date(s.ocurrido_en), evento_id: s.id },
  }));
}

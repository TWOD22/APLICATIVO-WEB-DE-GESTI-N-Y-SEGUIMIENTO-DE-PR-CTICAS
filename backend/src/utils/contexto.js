/**
 * Construye el contexto (usuario, rol activo, IP, request_id) que los controladores pasan a los servicios.
 */
/** Contexto de la solicitud que viaja a los servicios (actor, trazabilidad y auditoría). */
export function construirContexto(req) {
  return Object.freeze({
    actor: req.auth
      ? {
          usuario_id: req.auth.usuario.id,
          firebase_uid: req.auth.usuario.firebase_uid,
          rol_activo: req.auth.rolActivo,
        }
      : null,
    direccion_ip: req.ip,
    agente_usuario: req.get("user-agent") ?? null,
    request_id: req.id,
  });
}

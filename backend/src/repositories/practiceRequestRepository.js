/**
 * Repositorio de solicitudes de práctica (flujo v2).
 * Una solicitud es una fila de `asignaciones_practica` que todavía no tiene plaza ni docente definidos.
 * Aquí viven las consultas de la trayectoria del estudiante y los cambios de estado de la solicitud.
 */
import { pool } from "../config/database.js";
import { OBLIGATORIO_PARA_ASIGNACION as OBL } from "./sqlRequisitos.js";

/**
 * Trayectoria del estudiante en su programa: cada nivel con el estado de su práctica más relevante
 * (finalizada primero; si no, la abierta más reciente). Las canceladas y rechazadas no cuentan.
 */
export async function trayectoria({ estudianteId, programaId }, db = pool) {
  const { rows } = await db.query(
    `SELECT n.id AS nivel_id, n.codigo AS nivel_codigo, n.nombre AS nivel_nombre,
            n.numero_semestre AS semestre, n.orden_visual AS orden,
            x.asignacion_id, x.estado AS asignacion_estado, x.periodo_codigo
       FROM niveles_practica n
       LEFT JOIN LATERAL (
         SELECT a.id AS asignacion_id, a.estado, pe.codigo AS periodo_codigo
           FROM asignaciones_practica a
           JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
           JOIN periodos_academicos pe ON pe.id = m.periodo_academico_id
          WHERE m.estudiante_id = $1 AND a.nivel_practica_id = n.id AND a.eliminado_en IS NULL
            AND a.estado NOT IN ('CANCELADA', 'RECHAZADA')
          ORDER BY (a.estado = 'FINALIZADA') DESC, pe.fecha_inicio DESC
          LIMIT 1
       ) x ON true
      WHERE n.programa_academico_id = $2 AND n.activo AND n.eliminado_en IS NULL
      ORDER BY n.orden_visual`,
    [estudianteId, programaId]
  );
  return rows;
}

/** Crea la solicitud en BORRADOR: sin institución, sin docente y sin quien asigna (los define el Director después). */
export async function crearBorrador({ matriculaId, nivelId, solicitadaPorId }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, solicitada_por_id, estado)
     VALUES ($1, $2, $3, 'BORRADOR') RETURNING id`,
    [matriculaId, nivelId, solicitadaPorId]
  );
  return rows[0];
}

/** Bloquea la fila de la solicitud para cambiar su estado sin carreras. */
export async function bloquear(id, db = pool) {
  const { rows } = await db.query(
    `SELECT id, estado, nivel_practica_id, institucion_solicitada_id FROM asignaciones_practica
      WHERE id = $1 AND eliminado_en IS NULL FOR UPDATE`,
    [id]
  );
  return rows[0] ?? null;
}

/** Marca la solicitud como ENVIADA y guarda la fecha de envío. */
export async function marcarEnviada(id, db = pool) {
  await db.query(
    `UPDATE asignaciones_practica SET estado = 'ENVIADA', enviada_en = now() WHERE id = $1`,
    [id]
  );
}

/** Descarta un borrador (borrado lógico). */
export async function descartar(id, db = pool) {
  await db.query(`UPDATE asignaciones_practica SET eliminado_en = now() WHERE id = $1 AND estado = 'BORRADOR'`, [id]);
}

/**
 * Documentos obligatorios del nivel: total, cuántos están listos para revisar (EN_REVISION o APROBADO)
 * y cuáles faltan. Sirve para exigir el expediente completo antes de enviar la solicitud.
 */
export async function estadoDocumentosObligatorios(asignacionId, db = pool) {
  const { rows } = await db.query(
    `SELECT t.id AS tipo_id, t.nombre, d.estado
       FROM asignaciones_practica a
       JOIN requisitos_documentales r ON r.nivel_practica_id = a.nivel_practica_id
                                     AND r.eliminado_en IS NULL AND ${OBL}
       JOIN tipos_documento_legal t ON t.id = r.tipo_documento_legal_id AND t.eliminado_en IS NULL AND t.activo
       LEFT JOIN documentos_legales_estudiantes d ON d.asignacion_practica_id = a.id
              AND d.tipo_documento_legal_id = t.id AND d.es_version_actual AND d.eliminado_en IS NULL
      WHERE a.id = $1
      ORDER BY t.nombre`,
    [asignacionId]
  );
  const faltantes = rows.filter((f) => !["EN_REVISION", "APROBADO"].includes(f.estado ?? ""));
  return { total: rows.length, listos: rows.length - faltantes.length, faltantes };
}

/** Instituciones donde el estudiante puede pedir plaza: activas y con convenio vigente. */
export async function listarPlazasDisponibles(db = pool) {
  const { rows } = await db.query(
    `SELECT id, nombre, ciudad, direccion
       FROM instituciones
      WHERE eliminado_en IS NULL AND activa AND estado_convenio = 'VIGENTE'
      ORDER BY ciudad, nombre`
  );
  return rows;
}

/** El estudiante elige su plaza: guarda la institución solicitada (el estado no cambia; viaja con el envío). */
export async function guardarPlazaElegida(id, institucionId, db = pool) {
  await db.query(
    `UPDATE asignaciones_practica SET institucion_solicitada_id = $2 WHERE id = $1`,
    [id, institucionId]
  );
}

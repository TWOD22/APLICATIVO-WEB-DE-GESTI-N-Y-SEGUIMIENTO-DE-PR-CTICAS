/**
 * Repositorio de docentes por nivel de práctica y periodo (tabla docentes_niveles).
 * Regla: un solo docente por nivel y periodo; un docente puede tener varios niveles.
 */
import { pool } from "../config/database.js";

/**
 * Niveles del programa con su docente en el periodo (o null) y cuántos estudiantes tienen una práctica abierta en él.
 * Una solicitud en BORRADOR, rechazada o cancelada no cuenta como estudiante del nivel.
 */
export async function listarPorPeriodo({ periodoId, programaId = null }, db = pool) {
  const { rows } = await db.query(
    `SELECT n.id AS nivel_id, n.codigo AS nivel_codigo, n.nombre AS nivel_nombre, n.orden_visual AS orden,
            n.programa_academico_id AS programa_id,
            dn.id AS docente_nivel_id, d.id AS docente_id, d.nombres AS docente_nombres,
            d.apellidos AS docente_apellidos, d.correo_institucional AS docente_correo,
            (SELECT count(*)::int
               FROM asignaciones_practica a
               JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
              WHERE a.nivel_practica_id = n.id AND m.periodo_academico_id = $1
                AND a.eliminado_en IS NULL
                AND a.estado NOT IN ('BORRADOR', 'RECHAZADA', 'CANCELADA')) AS estudiantes
       FROM niveles_practica n
       LEFT JOIN docentes_niveles dn
              ON dn.nivel_practica_id = n.id AND dn.periodo_academico_id = $1 AND dn.eliminado_en IS NULL
       LEFT JOIN usuarios d ON d.id = dn.docente_id
      WHERE n.eliminado_en IS NULL AND n.activo
        AND ($2::uuid IS NULL OR n.programa_academico_id = $2)
      ORDER BY n.programa_academico_id, n.orden_visual`,
    [periodoId, programaId]
  );
  return rows;
}

/** Nivel de práctica por id (o null). */
export async function buscarNivel(nivelId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre, programa_academico_id AS programa_id
       FROM niveles_practica WHERE id = $1 AND eliminado_en IS NULL`,
    [nivelId]
  );
  return rows[0] ?? null;
}

/** Docente vigente del nivel en el periodo (o null). */
export async function buscarVigente(nivelId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, docente_id FROM docentes_niveles
      WHERE nivel_practica_id = $1 AND periodo_academico_id = $2 AND eliminado_en IS NULL`,
    [nivelId, periodoId]
  );
  return rows[0] ?? null;
}

/** ¿El usuario existe, está activo y tiene el rol DOCENTE_SUPERVISOR? */
export async function esDocenteActivo(usuarioId, db = pool) {
  const { rows } = await db.query(
    `SELECT 1
       FROM usuarios u
       JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.eliminado_en IS NULL
       JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'DOCENTE_SUPERVISOR'
      WHERE u.id = $1 AND u.estado = 'ACTIVO' AND u.eliminado_en IS NULL`,
    [usuarioId]
  );
  return rows.length > 0;
}

/** Quita (borrado lógico) al docente actual del nivel en el periodo. */
export async function quitar(nivelId, periodoId, db = pool) {
  await db.query(
    `UPDATE docentes_niveles SET eliminado_en = now()
      WHERE nivel_practica_id = $1 AND periodo_academico_id = $2 AND eliminado_en IS NULL`,
    [nivelId, periodoId]
  );
}

/** Asigna un docente al nivel en el periodo. Debe haberse quitado el anterior antes. */
export async function asignar({ nivelId, periodoId, docenteId, asignadoPorId }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO docentes_niveles (docente_id, nivel_practica_id, periodo_academico_id, asignado_por_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [docenteId, nivelId, periodoId, asignadoPorId]
  );
  return rows[0];
}

/** Niveles (ids) que el docente tiene asignados en el periodo ACTIVO. Define qué cuestionarios puede configurar. */
export async function nivelesDelDocenteActivo(docenteId, db = pool) {
  const { rows } = await db.query(
    `SELECT dn.nivel_practica_id AS id
       FROM docentes_niveles dn
       JOIN periodos_academicos p ON p.id = dn.periodo_academico_id AND p.estado = 'ACTIVO' AND p.eliminado_en IS NULL
      WHERE dn.docente_id = $1 AND dn.eliminado_en IS NULL`,
    [docenteId]
  );
  return rows.map((r) => r.id);
}

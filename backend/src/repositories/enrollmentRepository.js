/**
 * Repositorio de matrículas y vínculos de usuario con programas académicos.
 */
import { pool } from "../config/database.js";

/** Crea la matrícula del estudiante en un periodo. */
export async function crearMatricula({ estudianteId, programaId, periodoId, semestre }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO matriculas_estudiantes (estudiante_id, programa_academico_id, periodo_academico_id, numero_semestre)
     VALUES ($1, $2, $3, $4)
     RETURNING id, estudiante_id, programa_academico_id AS programa_id, periodo_academico_id AS periodo_id,
               numero_semestre AS semestre, estado_academico AS estado`,
    [estudianteId, programaId, periodoId, semestre]
  );
  return rows[0];
}

/** Programas de la persona: los de sus matrículas (solo los estudiantes tienen; el personal no se vincula a un programa). */
export async function listarProgramasDeUsuario(usuarioId, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT p.id, p.codigo, p.nombre
       FROM matriculas_estudiantes m
       JOIN programas_academicos p ON p.id = m.programa_academico_id AND p.eliminado_en IS NULL
      WHERE m.estudiante_id = $1 AND m.eliminado_en IS NULL
      ORDER BY p.nombre`,
    [usuarioId]
  );
  return rows;
}

/** Matrícula activa más reciente del estudiante. */
export async function buscarMatriculaActual(estudianteId, db = pool) {
  const { rows } = await db.query(
    `SELECT m.id, m.numero_semestre AS semestre, m.estado_academico AS estado, m.programa_academico_id AS programa_id, pr.nombre AS programa_nombre,
            pe.id AS periodo_id, pe.codigo AS periodo_codigo
       FROM matriculas_estudiantes m
       JOIN periodos_academicos pe ON pe.id = m.periodo_academico_id
       JOIN programas_academicos pr ON pr.id = m.programa_academico_id
      WHERE m.estudiante_id = $1 AND m.eliminado_en IS NULL
      ORDER BY pe.fecha_inicio DESC
      LIMIT 1`,
    [estudianteId]
  );
  return rows[0] ?? null;
}

/**
 * Repositorio de la guía de criterios (PDF) por nivel y periodo. Una sola guía vigente; las anteriores quedan como versiones.
 */
import { pool } from "../config/database.js";

/** Bloquea la fila del docente del nivel (evita dos cargas simultáneas con la misma versión). */
export async function bloquearDocenteNivel(nivelId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, docente_id FROM docentes_niveles
      WHERE nivel_practica_id = $1 AND periodo_academico_id = $2 AND eliminado_en IS NULL FOR UPDATE`,
    [nivelId, periodoId]
  );
  return rows[0] ?? null;
}

export async function ultimaVersion(nivelId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(version), 0)::int AS ultima FROM guias_criterios
      WHERE nivel_practica_id = $1 AND periodo_academico_id = $2`,
    [nivelId, periodoId]
  );
  return rows[0].ultima;
}

export async function desmarcarVigente(nivelId, periodoId, db = pool) {
  await db.query(
    `UPDATE guias_criterios SET vigente = false
      WHERE nivel_practica_id = $1 AND periodo_academico_id = $2 AND vigente AND eliminado_en IS NULL`,
    [nivelId, periodoId]
  );
}

export async function crear({ nivelId, periodoId, docenteId, archivoId, version }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO guias_criterios (nivel_practica_id, periodo_academico_id, docente_id, archivo_id, version, vigente)
     VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
    [nivelId, periodoId, docenteId, archivoId, version]
  );
  return rows[0];
}

/** Versiones de la guía (la más reciente primero) con los datos del archivo. */
export async function listarVersiones(nivelId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT g.id, g.version, g.vigente, g.creado_en, a.nombre_original AS archivo_nombre, a.tamano_bytes,
            a.ruta_almacenamiento AS ruta, u.nombres || ' ' || u.apellidos AS docente_nombre
       FROM guias_criterios g
       JOIN archivos a ON a.id = g.archivo_id
       JOIN usuarios u ON u.id = g.docente_id
      WHERE g.nivel_practica_id = $1 AND g.periodo_academico_id = $2 AND g.eliminado_en IS NULL
      ORDER BY g.version DESC`,
    [nivelId, periodoId]
  );
  return rows;
}

/** ¿El estudiante tiene una práctica (incluido el borrador de su solicitud, no rechazada ni cancelada) en ese nivel y periodo? */
export async function estudianteTieneNivel(usuarioId, nivelId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT 1 FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE m.estudiante_id = $1 AND a.nivel_practica_id = $2 AND m.periodo_academico_id = $3
        AND a.eliminado_en IS NULL AND a.estado NOT IN ('RECHAZADA', 'CANCELADA') LIMIT 1`,
    [usuarioId, nivelId, periodoId]
  );
  return rows.length > 0;
}

/** ¿El asesor tiene un practicante en ese nivel y periodo? */
export async function asesorTieneNivel(usuarioId, nivelId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT 1 FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE a.asesor_sitio_id = $1 AND a.nivel_practica_id = $2 AND m.periodo_academico_id = $3
        AND a.eliminado_en IS NULL AND a.estado NOT IN ('BORRADOR', 'RECHAZADA', 'CANCELADA') LIMIT 1`,
    [usuarioId, nivelId, periodoId]
  );
  return rows.length > 0;
}

/** Copia al periodo nuevo la guía vigente de cada nivel (misma versión del archivo) si el nivel aún no tiene una. */
export async function copiarVigentes({ origenId, destinoId }, db = pool) {
  const { rowCount } = await db.query(
    `INSERT INTO guias_criterios (nivel_practica_id, periodo_academico_id, docente_id, archivo_id, version, vigente)
     SELECT g.nivel_practica_id, $2, g.docente_id, g.archivo_id, 1, true
       FROM guias_criterios g
      WHERE g.periodo_academico_id = $1 AND g.vigente AND g.eliminado_en IS NULL
        AND NOT EXISTS (SELECT 1 FROM guias_criterios x
                         WHERE x.nivel_practica_id = g.nivel_practica_id AND x.periodo_academico_id = $2 AND x.eliminado_en IS NULL)`,
    [origenId, destinoId]
  );
  return rowCount;
}

/** Una versión de la guía (no eliminada) de ese nivel y periodo. */
export async function buscarVersion(guiaId, nivelId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, version, vigente FROM guias_criterios
      WHERE id = $1 AND nivel_practica_id = $2 AND periodo_academico_id = $3 AND eliminado_en IS NULL`,
    [guiaId, nivelId, periodoId]
  );
  return rows[0] ?? null;
}

export async function marcarVigente(guiaId, db = pool) {
  await db.query(`UPDATE guias_criterios SET vigente = true WHERE id = $1`, [guiaId]);
}

/** Borrado lógico de una versión (el archivo se conserva en el almacenamiento). */
export async function eliminarVersion(guiaId, db = pool) {
  await db.query(`UPDATE guias_criterios SET eliminado_en = now(), vigente = false WHERE id = $1`, [guiaId]);
}

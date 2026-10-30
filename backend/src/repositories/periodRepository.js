/**
 * Repositorio de periodos académicos.
 */
import { pool } from "../config/database.js";

/** Todos los periodos. */
export async function listar(db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre, fecha_inicio, fecha_fin, estado, (estado = 'ACTIVO') AS es_activo
       FROM periodos_academicos
      WHERE eliminado_en IS NULL
      ORDER BY fecha_inicio DESC`
  );
  return rows;
}

/** Periodo por id. */
export async function buscarPorId(id, db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre, fecha_inicio, fecha_fin, estado
       FROM periodos_academicos WHERE id = $1 AND eliminado_en IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

/** Periodo activo actual. */
export async function buscarActivo(db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre, fecha_inicio, fecha_fin, estado
       FROM periodos_academicos WHERE estado = 'ACTIVO' AND eliminado_en IS NULL`
  );
  return rows[0] ?? null;
}

/** Crea un periodo en estado PLANIFICADO. */
export async function crear({ codigo, nombre, fecha_inicio, fecha_fin }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO periodos_academicos (codigo, nombre, fecha_inicio, fecha_fin)
     VALUES ($1, $2, $3, $4)
     RETURNING id, codigo, nombre, fecha_inicio, fecha_fin, estado, (estado = 'ACTIVO') AS es_activo`,
    [codigo, nombre, fecha_inicio, fecha_fin]
  );
  return rows[0];
}

/** Cambia el estado del periodo (PLANIFICADO → ACTIVO → CERRADO). */
export async function cambiarEstado(id, estado, db = pool) {
  await db.query(`UPDATE periodos_academicos SET estado = $2, actualizado_en = now() WHERE id = $1`, [id, estado]);
}

/** ¿Hay un periodo con ese código? */
export async function existeCodigo(codigo, db = pool) {
  const { rows } = await db.query(`SELECT 1 FROM periodos_academicos WHERE codigo = $1 AND eliminado_en IS NULL`, [codigo]);
  return rows.length > 0;
}

/** Último periodo cerrado (del que se arrastran las matrículas al activar el siguiente). */
export async function buscarUltimoCerrado(db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre FROM periodos_academicos
      WHERE estado = 'CERRADO' AND eliminado_en IS NULL ORDER BY fecha_inicio DESC LIMIT 1`
  );
  return rows[0] ?? null;
}

/** Estados de práctica que están en marcha (no se puede cerrar el periodo con ellas). */
const EN_MARCHA = ["ACTIVA", "PENDIENTE_EVALUACION"];
/** Solicitudes todavía abiertas: al cerrar el periodo se cancelan. */
const SOLICITUDES_ABIERTAS = ["BORRADOR", "ENVIADA", "DEVUELTA", "DOCUMENTOS_APROBADOS", "PLAZA_SELECCIONADA", "PENDIENTE_DOCUMENTOS"];

/** Conteos que explican qué pasaría al cerrar el periodo. */
export async function resumenDeCierre(periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE a.estado = ANY($2))::int AS en_marcha,
            count(*) FILTER (WHERE a.estado = ANY($3))::int AS solicitudes_abiertas,
            count(*) FILTER (WHERE a.estado = 'FINALIZADA')::int AS finalizadas,
            (SELECT count(*)::int FROM matriculas_estudiantes m
              WHERE m.periodo_academico_id = $1 AND m.eliminado_en IS NULL AND m.estado_academico = 'ACTIVA') AS matriculas
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE m.periodo_academico_id = $1 AND a.eliminado_en IS NULL`,
    [periodoId, EN_MARCHA, SOLICITUDES_ABIERTAS]
  );
  return rows[0];
}

/** Cancela las solicitudes que siguen abiertas al cerrar el periodo. Devuelve cuántas fueron. */
export async function cancelarSolicitudesAbiertas(periodoId, motivo, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE asignaciones_practica a SET estado = 'CANCELADA', motivo_cancelacion = $3
       FROM matriculas_estudiantes m
      WHERE m.id = a.matricula_estudiante_id AND m.periodo_academico_id = $1
        AND a.eliminado_en IS NULL AND a.estado = ANY($2)`,
    [periodoId, SOLICITUDES_ABIERTAS, motivo]
  );
  return rowCount;
}

/** Marca como FINALIZADAS las matrículas activas del periodo que se cierra. */
export async function finalizarMatriculas(periodoId, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE matriculas_estudiantes SET estado_academico = 'FINALIZADA', actualizado_en = now()
      WHERE periodo_academico_id = $1 AND eliminado_en IS NULL AND estado_academico = 'ACTIVA'`,
    [periodoId]
  );
  return rowCount;
}

/**
 * Matricula en `destinoId` a los estudiantes de `origenId` que siguen en el programa.
 * Paso de semestre: quien finalizó la práctica de su semestre sube al siguiente; quien no, repite el mismo.
 * Quien finalizó el último semestre del programa termina su ciclo y no se matricula de nuevo.
 * Los estudiantes que ya tienen matrícula en el destino no se tocan.
 */
export async function arrastrarMatriculas({ origenId, destinoId }, db = pool) {
  const previa = `WITH previa AS (
       SELECT m.estudiante_id, m.programa_academico_id, m.numero_semestre,
              EXISTS (SELECT 1 FROM asignaciones_practica a
                        JOIN niveles_practica n ON n.id = a.nivel_practica_id
                       WHERE a.matricula_estudiante_id = m.id AND a.eliminado_en IS NULL
                         AND a.estado = 'FINALIZADA' AND n.numero_semestre = m.numero_semestre) AS aprobo,
              (SELECT max(n2.numero_semestre) FROM niveles_practica n2
                WHERE n2.programa_academico_id = m.programa_academico_id AND n2.eliminado_en IS NULL AND n2.activo) AS ultimo
         FROM matriculas_estudiantes m
         JOIN usuarios u ON u.id = m.estudiante_id AND u.eliminado_en IS NULL AND u.estado = 'ACTIVO'
        WHERE m.periodo_academico_id = $1 AND m.eliminado_en IS NULL
          AND m.estado_academico IN ('ACTIVA', 'FINALIZADA')
     )`;
  const { rows: egresados } = await db.query(
    `${previa} SELECT count(*)::int AS n FROM previa p WHERE p.aprobo AND p.numero_semestre >= COALESCE(p.ultimo, 8)`,
    [origenId]
  );
  const { rowCount } = await db.query(
    `${previa}
     INSERT INTO matriculas_estudiantes (estudiante_id, programa_academico_id, periodo_academico_id, numero_semestre)
     SELECT p.estudiante_id, p.programa_academico_id, $2,
            CASE WHEN p.aprobo THEN p.numero_semestre + 1 ELSE p.numero_semestre END
       FROM previa p
      WHERE NOT (p.aprobo AND p.numero_semestre >= COALESCE(p.ultimo, 8))
        AND NOT EXISTS (SELECT 1 FROM matriculas_estudiantes x
                         WHERE x.estudiante_id = p.estudiante_id AND x.periodo_academico_id = $2 AND x.eliminado_en IS NULL)`,
    [origenId, destinoId]
  );
  return { matriculados: rowCount, egresados: egresados[0].n };
}

/** Copia al periodo nuevo los docentes de nivel del anterior. Devuelve cuántos copió. */
export async function copiarDocentesDeNivel({ origenId, destinoId, asignadoPorId }, db = pool) {
  const { rowCount } = await db.query(
    `INSERT INTO docentes_niveles (nivel_practica_id, periodo_academico_id, docente_id, asignado_por_id)
     SELECT dn.nivel_practica_id, $2, dn.docente_id, $3
       FROM docentes_niveles dn
       JOIN usuarios d ON d.id = dn.docente_id AND d.eliminado_en IS NULL AND d.estado = 'ACTIVO'
      WHERE dn.periodo_academico_id = $1 AND dn.eliminado_en IS NULL
        AND NOT EXISTS (SELECT 1 FROM docentes_niveles x
                         WHERE x.nivel_practica_id = dn.nivel_practica_id AND x.periodo_academico_id = $2 AND x.eliminado_en IS NULL)`,
    [origenId, destinoId, asignadoPorId]
  );
  return rowCount;
}

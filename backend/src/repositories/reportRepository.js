/**
 * Consultas de los reportes de gestión (MEN/CNA) del Director. Solo lectura, por periodo.
 * "Práctica" = asignación que ya inició (en curso, pendiente de evaluación o finalizada).
 * Las solicitudes que aún no inician se cuentan aparte como "en trámite".
 * Las notas son SOLO las publicadas y nunca se combinan entre docente y asesor.
 */
import { pool } from "../config/database.js";

const PRACTICA = `a.eliminado_en IS NULL AND a.estado IN ('ACTIVA', 'PENDIENTE_EVALUACION', 'FINALIZADA')`;
const EN_TRAMITE = `a.eliminado_en IS NULL AND a.estado IN ('ENVIADA', 'DEVUELTA', 'DOCUMENTOS_APROBADOS', 'PLAZA_SELECCIONADA', 'PENDIENTE_DOCUMENTOS')`;

/** Matriculados, quiénes tienen práctica y cuántas solicitudes quedaron sin avanzar. */
export async function cobertura(periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM matriculas_estudiantes m WHERE m.periodo_academico_id = $1 AND m.eliminado_en IS NULL AND m.estado_academico <> 'RETIRADA') AS matriculados,
            count(DISTINCT m.estudiante_id) FILTER (WHERE ${PRACTICA})::int AS con_practica,
            count(*) FILTER (WHERE ${EN_TRAMITE})::int AS en_tramite,
            count(*) FILTER (WHERE a.eliminado_en IS NULL AND a.estado IN ('RECHAZADA', 'CANCELADA'))::int AS rechazadas_o_canceladas
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE m.periodo_academico_id = $1`,
    [periodoId]
  );
  return rows[0];
}

/** Prácticas por estado. */
export async function porEstado(periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT a.estado, count(*)::int AS total
       FROM asignaciones_practica a JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE m.periodo_academico_id = $1 AND a.eliminado_en IS NULL AND a.estado NOT IN ('BORRADOR')
      GROUP BY a.estado ORDER BY total DESC`,
    [periodoId]
  );
  return rows;
}

/** Por nivel: estudiantes, finalizadas, en marcha, y bitácoras enviadas. */
export async function porNivel(periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT n.id, n.nombre, n.numero_semestre AS semestre,
            count(a.id)::int AS estudiantes,
            count(a.id) FILTER (WHERE a.estado = 'FINALIZADA')::int AS finalizadas,
            count(a.id) FILTER (WHERE a.estado IN ('ACTIVA', 'PENDIENTE_EVALUACION'))::int AS en_marcha,
            count(b.id) FILTER (WHERE b.estado IN ('ENVIADA', 'EN_EVALUACION', 'EVALUADA'))::int AS bitacoras_enviadas
       FROM niveles_practica n
       LEFT JOIN asignaciones_practica a ON a.nivel_practica_id = n.id AND ${PRACTICA}
            AND EXISTS (SELECT 1 FROM matriculas_estudiantes m WHERE m.id = a.matricula_estudiante_id AND m.periodo_academico_id = $1)
       LEFT JOIN bitacoras b ON b.asignacion_practica_id = a.id AND b.eliminado_en IS NULL
      WHERE n.eliminado_en IS NULL AND n.activo
      GROUP BY n.id ORDER BY n.orden_visual`,
    [periodoId]
  );
  return rows;
}

/** Notas publicadas por tipo de evaluador (cada una por separado). */
export async function notasPorTipo(periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT e.tipo_evaluador AS tipo, count(*)::int AS publicadas,
            round(avg(e.nota), 2)::float AS promedio, min(e.nota)::float AS minima, max(e.nota)::float AS maxima,
            count(*) FILTER (WHERE e.nota < 3)::int AS por_debajo_de_3
       FROM evaluaciones e
       JOIN asignaciones_practica a ON a.id = e.asignacion_practica_id
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE m.periodo_academico_id = $1 AND e.eliminado_en IS NULL AND a.eliminado_en IS NULL AND e.estado = 'PUBLICADA'
      GROUP BY e.tipo_evaluador`,
    [periodoId]
  );
  return rows;
}

/** Evaluadores (docentes y asesores) con su carga y el promedio de lo que ya publicaron. */
export async function porEvaluador(periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT u.id, u.nombres || ' ' || u.apellidos AS nombre, e.tipo_evaluador AS tipo,
            count(DISTINCT a.id)::int AS estudiantes,
            count(*) FILTER (WHERE e.estado = 'PUBLICADA')::int AS publicadas,
            round(avg(e.nota) FILTER (WHERE e.estado = 'PUBLICADA'), 2)::float AS promedio
       FROM evaluaciones e
       JOIN usuarios u ON u.id = e.evaluador_id
       JOIN asignaciones_practica a ON a.id = e.asignacion_practica_id
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE m.periodo_academico_id = $1 AND e.eliminado_en IS NULL AND ${PRACTICA}
      GROUP BY u.id, e.tipo_evaluador ORDER BY e.tipo_evaluador, nombre`,
    [periodoId]
  );
  return rows;
}

/** Instituciones con prácticas en el periodo, su convenio y cuántos estudiantes y asesores tienen. */
export async function instituciones(periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT i.id, i.nombre, i.ciudad, i.estado_convenio AS convenio, i.fecha_fin_convenio AS fin_convenio,
            count(a.id)::int AS estudiantes, count(DISTINCT a.asesor_sitio_id)::int AS asesores
       FROM asignaciones_practica a
       JOIN instituciones i ON i.id = a.institucion_id
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE m.periodo_academico_id = $1 AND ${PRACTICA}
      GROUP BY i.id ORDER BY estudiantes DESC, i.nombre`,
    [periodoId]
  );
  return rows;
}

/** Convenios del catálogo por estado (instituciones activas). */
export async function conveniosPorEstado(db = pool) {
  const { rows } = await db.query(
    `SELECT estado_convenio AS estado, count(*)::int AS total FROM instituciones
      WHERE eliminado_en IS NULL AND activa GROUP BY estado_convenio ORDER BY total DESC`
  );
  return rows;
}

/** Expedientes: documentos legales vigentes por estado. */
export async function documentos(periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT d.estado, count(*)::int AS total
       FROM documentos_legales_estudiantes d
       JOIN asignaciones_practica a ON a.id = d.asignacion_practica_id
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE m.periodo_academico_id = $1 AND d.es_version_actual AND d.eliminado_en IS NULL AND a.eliminado_en IS NULL
      GROUP BY d.estado ORDER BY total DESC`,
    [periodoId]
  );
  return rows;
}

/** Detalle por práctica (una fila por estudiante) para exportar. */
export async function detalle(periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT eu.numero_documento AS documento, eu.nombres || ' ' || eu.apellidos AS estudiante, m.numero_semestre AS semestre,
            n.nombre AS nivel, i.nombre AS institucion, i.ciudad,
            du.nombres || ' ' || du.apellidos AS docente, au.nombres || ' ' || au.apellidos AS asesor,
            a.estado, b.estado AS bitacora, b.enviada_en AS bitacora_enviada_en,
            ed.nota::float AS nota_docente, ea.nota::float AS nota_asesor
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
       JOIN usuarios eu ON eu.id = m.estudiante_id
       JOIN niveles_practica n ON n.id = a.nivel_practica_id
       LEFT JOIN instituciones i ON i.id = a.institucion_id
       LEFT JOIN usuarios du ON du.id = a.docente_supervisor_id
       LEFT JOIN usuarios au ON au.id = a.asesor_sitio_id
       LEFT JOIN bitacoras b ON b.asignacion_practica_id = a.id AND b.eliminado_en IS NULL
       LEFT JOIN evaluaciones ed ON ed.asignacion_practica_id = a.id AND ed.tipo_evaluador = 'DOCENTE_SUPERVISOR' AND ed.estado = 'PUBLICADA' AND ed.eliminado_en IS NULL
       LEFT JOIN evaluaciones ea ON ea.asignacion_practica_id = a.id AND ea.tipo_evaluador = 'ASESOR_SITIO' AND ea.estado = 'PUBLICADA' AND ea.eliminado_en IS NULL
      WHERE m.periodo_academico_id = $1 AND ${PRACTICA}
      ORDER BY n.orden_visual, eu.apellidos, eu.nombres`,
    [periodoId]
  );
  return rows;
}

/**
 * Repositorio del dashboard: conteos e indicadores agregados y tabla de seguimiento según el alcance del rol.
 */
import { pool } from "../config/database.js";
import { condicionesDeAlcance, DESDE, SELECCION } from "./assignmentRepository.js";
import { escaparLike } from "../utils/pagination.js";

/** Estados en los que la práctica sigue en curso (no finalizada ni cancelada). */
const EN_CURSO = "('PENDIENTE_DOCUMENTOS', 'ACTIVA', 'PENDIENTE_EVALUACION')";
const PERIODO = "($1::uuid IS NULL OR m.periodo_academico_id = $1::uuid)";

/** Conteos de prácticas del periodo (o de todos si no hay periodo). Las canceladas no cuentan. */
export async function contarPracticas({ periodoId }, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE a.estado IN ${EN_CURSO})::int AS activas,
            count(*) FILTER (WHERE a.estado = 'FINALIZADA')::int AS finalizadas,
            count(*) FILTER (WHERE a.estado IN ${EN_CURSO} AND a.docente_supervisor_id IS NULL)::int AS sin_docente,
            count(*) FILTER (WHERE a.estado IN ${EN_CURSO} AND a.docente_supervisor_id IS NOT NULL
                               AND a.asesor_sitio_id IS NULL)::int AS sin_asesor
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE a.eliminado_en IS NULL AND a.estado <> 'CANCELADA' AND ${PERIODO}`,
    [periodoId ?? null]
  );
  return rows[0];
}

/** Evaluaciones de las prácticas vigentes del periodo: sin terminar (pendientes o en borrador) y publicadas. */
export async function contarEvaluaciones({ periodoId }, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE ev.estado IN ('PENDIENTE', 'BORRADOR'))::int AS sin_publicar,
            count(*) FILTER (WHERE ev.estado = 'PUBLICADA')::int AS publicadas
       FROM evaluaciones ev
       JOIN asignaciones_practica a ON a.id = ev.asignacion_practica_id AND a.eliminado_en IS NULL AND a.estado <> 'CANCELADA'
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE ev.eliminado_en IS NULL AND ${PERIODO}`,
    [periodoId ?? null]
  );
  return rows[0];
}

/** Instituciones activas y convenios en trámite (no dependen del periodo). */
export async function contarInstituciones(db = pool) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE activa)::int AS activas,
            count(*) FILTER (WHERE activa AND estado_convenio = 'EN_TRAMITE')::int AS convenios_en_tramite
       FROM instituciones WHERE eliminado_en IS NULL`
  );
  return rows[0];
}

/**
 * Indicadores de un evaluador sobre sus propios estudiantes (el alcance excluye canceladas y, para el asesor,
 * vinculaciones vencidas) y su propio tipo de evaluación. "en_desarrollo" son los estudiantes cuya bitácora todavía
 * no generó evaluación (aún no la envían).
 */
export async function contarDeEvaluador({ periodoId, tipo }, alcance, db = pool) {
  const parametros = [tipo];
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = ["a.eliminado_en IS NULL", ...condicionesDeAlcance(alcance, p)];
  if (periodoId) condiciones.push(`m.periodo_academico_id = ${p(periodoId)}`);
  const { rows } = await db.query(
    `SELECT count(*)::int AS estudiantes,
            count(*) FILTER (WHERE ev.id IS NULL)::int AS en_desarrollo,
            count(*) FILTER (WHERE ev.estado = 'PENDIENTE')::int AS pendientes,
            count(*) FILTER (WHERE ev.estado = 'BORRADOR')::int AS en_borrador,
            count(*) FILTER (WHERE ev.estado = 'PUBLICADA')::int AS publicadas
       ${DESDE}
       LEFT JOIN evaluaciones ev ON ev.asignacion_practica_id = a.id AND ev.eliminado_en IS NULL
            AND ev.tipo_evaluador = $1::tipo_evaluador
      WHERE ${condiciones.join(" AND ")}`,
    parametros
  );
  return rows[0];
}

/**
 * Tabla de seguimiento: una fila por práctica con su bitácora, el estado de las dos evaluaciones y el resumen
 * documental. El alcance se aplica en SQL; qué se muestra de cada columna lo decide el servicio según el rol.
 */
export async function listarPracticas({ q, periodo_id, estado }, alcance, { limit, offset }, db = pool) {
  const parametros = [];
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = ["a.eliminado_en IS NULL", ...condicionesDeAlcance(alcance, p)];
  if (periodo_id) condiciones.push(`m.periodo_academico_id = ${p(periodo_id)}`);
  if (estado) condiciones.push(`a.estado = ${p(estado)}::estado_asignacion`);
  if (q) {
    const patron = p(`%${escaparLike(q)}%`);
    condiciones.push(
      `((e.nombres || ' ' || e.apellidos) ILIKE ${patron} OR e.numero_documento ILIKE ${patron} OR i.nombre ILIKE ${patron})`
    );
  }
  const limite = p(limit);
  const desplazamiento = p(offset);
  const { rows } = await db.query(
    `SELECT ${SELECCION},
            b.id AS bitacora_id, b.estado AS bitacora_estado, b.enviada_en,
            ed.estado AS docente_eval_estado, ed.nota::float8 AS docente_eval_nota, ed.publicada_en AS docente_eval_publicada_en,
            ea.estado AS asesor_eval_estado, ea.nota::float8 AS asesor_eval_nota, ea.publicada_en AS asesor_eval_publicada_en,
            c.total_obligatorios, c.aprobados_obligatorios,
            CASE WHEN c.por_corregir > 0 THEN 'POR_CORREGIR'
                 WHEN c.en_revision > 0 THEN 'EN_REVISION'
                 WHEN c.aprobados_obligatorios < c.total_obligatorios THEN 'INCOMPLETO'
                 ELSE 'COMPLETO' END AS expediente_estado,
            count(*) OVER() AS total
       ${DESDE}
       LEFT JOIN bitacoras b ON b.asignacion_practica_id = a.id AND b.eliminado_en IS NULL
       LEFT JOIN evaluaciones ed ON ed.asignacion_practica_id = a.id AND ed.eliminado_en IS NULL AND ed.tipo_evaluador = 'DOCENTE_SUPERVISOR'
       LEFT JOIN evaluaciones ea ON ea.asignacion_practica_id = a.id AND ea.eliminado_en IS NULL AND ea.tipo_evaluador = 'ASESOR_SITIO'
       CROSS JOIN LATERAL (
         SELECT count(*) FILTER (WHERE r.obligatorio)::int AS total_obligatorios,
                count(*) FILTER (WHERE r.obligatorio AND d.estado = 'APROBADO')::int AS aprobados_obligatorios,
                count(*) FILTER (WHERE d.estado = 'EN_REVISION')::int AS en_revision,
                count(*) FILTER (WHERE d.estado = 'POR_CORREGIR')::int AS por_corregir
           FROM requisitos_documentales r
           JOIN tipos_documento_legal t ON t.id = r.tipo_documento_legal_id AND t.eliminado_en IS NULL AND t.activo
           LEFT JOIN documentos_legales_estudiantes d ON d.asignacion_practica_id = a.id
                  AND d.tipo_documento_legal_id = t.id AND d.es_version_actual AND d.eliminado_en IS NULL
          WHERE r.nivel_practica_id = a.nivel_practica_id AND r.eliminado_en IS NULL
       ) c
      WHERE ${condiciones.join(" AND ")}
      ORDER BY e.apellidos, e.nombres, pe.codigo DESC, a.id
      LIMIT ${limite} OFFSET ${desplazamiento}`,
    parametros
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { filas: rows.map(({ total: _total, ...fila }) => fila), total };
}

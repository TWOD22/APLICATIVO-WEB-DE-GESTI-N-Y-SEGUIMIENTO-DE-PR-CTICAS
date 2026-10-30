/**
 * Repositorio del dashboard: conteos e indicadores agregados y tabla de seguimiento según el alcance del rol.
 */
import { pool } from "../config/database.js";
import { OBLIGATORIO_PARA_ASIGNACION as OBL } from "./sqlRequisitos.js";
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
            count(*) FILTER (WHERE a.estado = 'PENDIENTE_EVALUACION')::int AS en_evaluacion,
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
const GRUPOS_DE_PRACTICA = {
  EN_MARCHA: ["ACTIVA", "PENDIENTE_EVALUACION", "FINALIZADA"],
  VIGENTES: ["PENDIENTE_DOCUMENTOS", "ACTIVA", "PENDIENTE_EVALUACION"], // las mismas que cuenta «Prácticas activas»
  EN_CURSO: ["ACTIVA"],
  EN_EVALUACION: ["PENDIENTE_EVALUACION"],
  FINALIZADA: ["FINALIZADA"],
};

export async function listarPracticas({ q, periodo_id, estado, grupo, nivel_practica_id }, alcance, { limit, offset }, db = pool) {
  const parametros = [];
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = ["a.eliminado_en IS NULL", ...condicionesDeAlcance(alcance, p)];
  if (periodo_id) condiciones.push(`m.periodo_academico_id = ${p(periodo_id)}`);
  if (estado) condiciones.push(`a.estado = ${p(estado)}::estado_asignacion`);
  if (grupo) condiciones.push(`a.estado::text = ANY(${p(GRUPOS_DE_PRACTICA[grupo])}::text[])`);
  if (nivel_practica_id) condiciones.push(`a.nivel_practica_id = ${p(nivel_practica_id)}`);
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
         SELECT count(*) FILTER (WHERE ${OBL})::int AS total_obligatorios,
                count(*) FILTER (WHERE ${OBL} AND d.estado = 'APROBADO')::int AS aprobados_obligatorios,
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

// ───────────────────────── Acciones inmediatas (flujo v2) ─────────────────────────

/** Solicitudes del periodo por etapa del flujo y prácticas listas para cerrar (ambas evaluaciones publicadas). */
export async function contarPendientesDeDireccion({ periodoId }, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE a.estado IN ('ENVIADA', 'DOCUMENTOS_APROBADOS', 'PLAZA_SELECCIONADA') AND NOT x.completo)::int AS documentos_por_revisar,
            count(*) FILTER (WHERE a.estado = 'DEVUELTA')::int AS devueltas_al_estudiante,
            count(*) FILTER (WHERE a.estado IN ('ENVIADA', 'DOCUMENTOS_APROBADOS', 'PLAZA_SELECCIONADA') AND x.completo)::int AS listas_para_asignar,
            count(*) FILTER (WHERE a.estado = 'PENDIENTE_EVALUACION' AND (
              SELECT count(*) FROM evaluaciones ev
               WHERE ev.asignacion_practica_id = a.id AND ev.eliminado_en IS NULL AND ev.estado = 'PUBLICADA') = 2)::int AS listas_para_cerrar
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
       CROSS JOIN LATERAL (
         SELECT count(*) FILTER (WHERE ${OBL} AND COALESCE(d.estado::text, '') <> 'APROBADO') = 0 AS completo
           FROM requisitos_documentales r
           JOIN tipos_documento_legal t ON t.id = r.tipo_documento_legal_id AND t.eliminado_en IS NULL AND t.activo
           LEFT JOIN documentos_legales_estudiantes d ON d.asignacion_practica_id = a.id
                  AND d.tipo_documento_legal_id = t.id AND d.es_version_actual AND d.eliminado_en IS NULL
          WHERE r.nivel_practica_id = a.nivel_practica_id AND r.eliminado_en IS NULL
       ) x
      WHERE a.eliminado_en IS NULL AND ${PERIODO}`,
    [periodoId ?? null]
  );
  return rows[0];
}

/**
 * Estado de configuración de cada nivel en el periodo: docente, guía de criterios vigente y cuestionario
 * (habilitado o en borrador). Sirve para las alertas de Dirección y para la bandeja del docente.
 */
export async function configuracionDeNiveles({ periodoId, docenteId = null }, db = pool) {
  const { rows } = await db.query(
    `SELECT n.id AS nivel_id, n.nombre AS nivel_nombre, n.orden_visual AS orden,
            dn.docente_id,
            (SELECT count(*) FROM matriculas_estudiantes m
              WHERE m.periodo_academico_id = $1 AND m.numero_semestre = n.numero_semestre
                AND m.estado_academico = 'ACTIVA' AND m.eliminado_en IS NULL)::int AS estudiantes,
            EXISTS (SELECT 1 FROM guias_criterios g
                     WHERE g.nivel_practica_id = n.id AND g.periodo_academico_id = $1 AND g.vigente AND g.eliminado_en IS NULL) AS tiene_guia,
            EXISTS (SELECT 1 FROM cuestionarios c
                     WHERE c.nivel_practica_id = n.id AND c.habilitado AND c.eliminado_en IS NULL) AS tiene_cuestionario,
            EXISTS (SELECT 1 FROM cuestionarios c
                     WHERE c.nivel_practica_id = n.id AND NOT c.publicado AND c.eliminado_en IS NULL) AS tiene_borrador
       FROM niveles_practica n
       LEFT JOIN docentes_niveles dn
              ON dn.nivel_practica_id = n.id AND dn.periodo_academico_id = $1 AND dn.eliminado_en IS NULL
      WHERE n.eliminado_en IS NULL AND n.activo AND ($2::uuid IS NULL OR dn.docente_id = $2::uuid)
      ORDER BY n.orden_visual`,
    [periodoId, docenteId]
  );
  return rows;
}

/** Evaluaciones del docente por calificar (PENDIENTE) o en borrador, con la práctica en evaluación. */
export async function contarEvaluacionesDelDocente({ periodoId, docenteId }, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE ev.estado = 'PENDIENTE')::int AS por_calificar,
            count(*) FILTER (WHERE ev.estado = 'BORRADOR')::int AS en_borrador
       FROM evaluaciones ev
       JOIN asignaciones_practica a ON a.id = ev.asignacion_practica_id AND a.eliminado_en IS NULL
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE ev.eliminado_en IS NULL AND ev.tipo_evaluador = 'DOCENTE_SUPERVISOR'
        AND a.docente_supervisor_id = $2 AND a.estado = 'PENDIENTE_EVALUACION' AND ${PERIODO}`,
    [periodoId ?? null, docenteId]
  );
  return rows[0];
}

// ───────────────────────── Casos concretos de las tarjetas de Dirección ─────────────────────────
// Cada función devuelve { total, casos } con los `limite` casos más antiguos o más urgentes, para que el Director
// pueda ir directo a ellos desde la tarjeta. `dias` se calcula en la base de datos.

const ESTADOS_SOLICITUD_ABIERTA = "('ENVIADA', 'DOCUMENTOS_APROBADOS', 'PLAZA_SELECCIONADA')";
const DESDE_ASIGNACION = `
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
       JOIN usuarios e ON e.id = m.estudiante_id
       JOIN niveles_practica n ON n.id = a.nivel_practica_id`;
const diasDesde = (columna) => `GREATEST(0, floor(extract(epoch FROM (now() - ${columna})) / 86400))::int`;
const paraCasos = (rows) => ({
  total: rows.length ? Number(rows[0].total) : 0,
  casos: rows.map(({ total: _total, ...caso }) => caso),
});

/** Solicitudes devueltas al estudiante que llevan más de `dias` días sin que él responda. */
export async function devueltasSinRespuesta({ periodoId, dias, limite }, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id, e.nombres, e.apellidos, n.nombre AS nivel, ${diasDesde("a.actualizado_en")} AS dias, count(*) OVER()::int AS total
       ${DESDE_ASIGNACION}
      WHERE a.eliminado_en IS NULL AND ${PERIODO} AND a.estado = 'DEVUELTA'
        AND a.actualizado_en < now() - make_interval(days => $2::int)
      ORDER BY a.actualizado_en, a.id LIMIT $3`,
    [periodoId ?? null, dias, limite]
  );
  return paraCasos(rows);
}

/** Solicitudes abiertas cuya institución pedida no tiene ningún asesor de sitio vinculado en el periodo. */
export async function solicitudesSinAsesorEnPlaza({ periodoId, limite }, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id, e.nombres, e.apellidos, n.nombre AS nivel, isol.nombre AS institucion, count(*) OVER()::int AS total
       ${DESDE_ASIGNACION}
       JOIN instituciones isol ON isol.id = a.institucion_solicitada_id
      WHERE a.eliminado_en IS NULL AND ${PERIODO} AND a.estado IN ${ESTADOS_SOLICITUD_ABIERTA}
        AND NOT EXISTS (
          SELECT 1 FROM vinculaciones_asesores v
           WHERE v.institucion_id = a.institucion_solicitada_id AND v.periodo_academico_id = m.periodo_academico_id
             AND v.activa AND v.eliminado_en IS NULL)
      ORDER BY a.enviada_en, a.id LIMIT $2`,
    [periodoId ?? null, limite]
  );
  return paraCasos(rows);
}

/** Estudiantes con matrícula activa en el periodo que todavía no han enviado su solicitud (sin solicitud o en borrador). */
export async function estudiantesSinSolicitud({ periodoId, limite }, db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, e.nombres, e.apellidos, m.numero_semestre AS semestre, count(*) OVER()::int AS total
       FROM matriculas_estudiantes m
       JOIN usuarios e ON e.id = m.estudiante_id AND e.eliminado_en IS NULL
      WHERE m.eliminado_en IS NULL AND m.estado_academico = 'ACTIVA' AND ${PERIODO}
        AND NOT EXISTS (
          SELECT 1 FROM asignaciones_practica a
           WHERE a.matricula_estudiante_id = m.id AND a.eliminado_en IS NULL AND a.estado NOT IN ('CANCELADA', 'BORRADOR'))
      ORDER BY e.apellidos, e.nombres, e.id LIMIT $2`,
    [periodoId ?? null, limite]
  );
  return paraCasos(rows);
}

/** Las solicitudes que esperan a Dirección, separadas en «documentos por revisar» y «listas para asignar», más antiguas primero. */
export async function solicitudesPorEtapa({ periodoId, completo, limite }, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id, e.nombres, e.apellidos, n.nombre AS nivel, ${diasDesde("a.enviada_en")} AS dias, count(*) OVER()::int AS total
       ${DESDE_ASIGNACION}
       CROSS JOIN LATERAL (
         SELECT count(*) FILTER (WHERE ${OBL} AND COALESCE(d.estado::text, '') <> 'APROBADO') = 0 AS completo
           FROM requisitos_documentales r
           JOIN tipos_documento_legal t ON t.id = r.tipo_documento_legal_id AND t.eliminado_en IS NULL AND t.activo
           LEFT JOIN documentos_legales_estudiantes d ON d.asignacion_practica_id = a.id
                  AND d.tipo_documento_legal_id = t.id AND d.es_version_actual AND d.eliminado_en IS NULL
          WHERE r.nivel_practica_id = a.nivel_practica_id AND r.eliminado_en IS NULL
       ) x
      WHERE a.eliminado_en IS NULL AND ${PERIODO} AND a.estado IN ${ESTADOS_SOLICITUD_ABIERTA} AND x.completo = $2::boolean
      ORDER BY a.enviada_en, a.id LIMIT $3`,
    [periodoId ?? null, completo, limite]
  );
  return paraCasos(rows);
}

/** Prácticas con las dos evaluaciones publicadas que Dirección aún no finaliza, las que llevan más tiempo esperando primero. */
export async function practicasListasParaCerrar({ periodoId, limite }, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id, e.nombres, e.apellidos, n.nombre AS nivel, ${diasDesde("p.ultima")} AS dias, count(*) OVER()::int AS total
       ${DESDE_ASIGNACION}
       CROSS JOIN LATERAL (
         SELECT count(*) AS publicadas, max(ev.publicada_en) AS ultima
           FROM evaluaciones ev
          WHERE ev.asignacion_practica_id = a.id AND ev.eliminado_en IS NULL AND ev.estado = 'PUBLICADA'
       ) p
      WHERE a.eliminado_en IS NULL AND ${PERIODO} AND a.estado = 'PENDIENTE_EVALUACION' AND p.publicadas = 2
      ORDER BY p.ultima, a.id LIMIT $2`,
    [periodoId ?? null, limite]
  );
  return paraCasos(rows);
}

/**
 * Prácticas activas cuyo estudiante todavía no abrió su bitácora (la fila se crea la primera vez que la abre). El borrador
 * en edición vive en Firestore, así que no se puede saber desde PostgreSQL si hay texto escrito: por eso solo se cuenta
 * a quien nunca la abrió. Cuentan las que ya llevan al menos `dias` días desde su inicio (fecha de inicio o, si no hay, último cambio).
 */
export async function practicasSinAvanceDeBitacora({ periodoId, dias, limite }, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id, e.nombres, e.apellidos, n.nombre AS nivel,
            GREATEST(0, current_date - COALESCE(a.fecha_inicio, a.actualizado_en::date))::int AS dias, count(*) OVER()::int AS total
       ${DESDE_ASIGNACION}
       LEFT JOIN bitacoras b ON b.asignacion_practica_id = a.id AND b.eliminado_en IS NULL
      WHERE a.eliminado_en IS NULL AND ${PERIODO} AND a.estado = 'ACTIVA'
        AND b.id IS NULL
        AND COALESCE(a.fecha_inicio, a.actualizado_en::date) <= current_date - $2::int
      ORDER BY COALESCE(a.fecha_inicio, a.actualizado_en::date), a.id LIMIT $3`,
    [periodoId ?? null, dias, limite]
  );
  return paraCasos(rows);
}

/** Prácticas activas cuya bitácora todavía no fue enviada (para el aviso de cierre del periodo). */
export async function bitacorasSinEnviar({ periodoId, limite }, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id, e.nombres, e.apellidos, n.nombre AS nivel, count(*) OVER()::int AS total
       ${DESDE_ASIGNACION}
       LEFT JOIN bitacoras b ON b.asignacion_practica_id = a.id AND b.eliminado_en IS NULL
      WHERE a.eliminado_en IS NULL AND ${PERIODO} AND a.estado = 'ACTIVA' AND (b.id IS NULL OR b.estado IN ('BLOQUEADA', 'BORRADOR'))
      ORDER BY e.apellidos, e.nombres, a.id LIMIT $2`,
    [periodoId ?? null, limite]
  );
  return paraCasos(rows);
}

/** Asesores de sitio con más de `maximo` practicantes en curso en el periodo (los más cargados primero). */
export async function asesoresSobrecargados({ periodoId, maximo, limite }, db = pool) {
  const { rows } = await db.query(
    `SELECT s.id, s.nombres, s.apellidos, string_agg(DISTINCT i.nombre, ', ') AS institucion,
            count(*)::int AS practicantes, count(*) OVER()::int AS total
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
       JOIN usuarios s ON s.id = a.asesor_sitio_id
       JOIN instituciones i ON i.id = a.institucion_id
      WHERE a.eliminado_en IS NULL AND ${PERIODO} AND a.estado IN ${EN_CURSO}
      GROUP BY s.id, s.nombres, s.apellidos
     HAVING count(*) > $2::int
      ORDER BY count(*) DESC, s.apellidos, s.id LIMIT $3`,
    [periodoId ?? null, maximo, limite]
  );
  return paraCasos(rows);
}

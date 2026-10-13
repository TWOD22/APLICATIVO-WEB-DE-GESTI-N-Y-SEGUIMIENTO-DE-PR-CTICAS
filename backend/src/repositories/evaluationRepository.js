/**
 * Repositorio de evaluaciones. Cada bitácora tiene una evaluación del Docente Supervisor y otra del Asesor de Sitio, independientes.
 */
import { pool } from "../config/database.js";
import { condicionesDeAlcance, DESDE, SELECCION } from "./assignmentRepository.js";
import { escaparLike } from "../utils/pagination.js";

const COLUMNAS = `
  ev.id, ev.asignacion_practica_id AS asignacion_id, ev.bitacora_id, ev.evaluador_id, ev.tipo_evaluador,
  ev.nota::float8 AS nota, ev.retroalimentacion, ev.estado, ev.publicada_en, ev.reabierta_en, ev.motivo_reapertura,
  ev.creado_en, ev.actualizado_en,
  ue.nombres AS evaluador_nombres, ue.apellidos AS evaluador_apellidos, ue.firebase_uid AS evaluador_firebase_uid`;

/** Evaluación por id (con bloqueo de fila opcional para evitar cambios simultáneos). */
export async function buscarPorId(id, db = pool, { bloquear = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS}
       FROM evaluaciones ev
       LEFT JOIN usuarios ue ON ue.id = ev.evaluador_id
      WHERE ev.id = $1 AND ev.eliminado_en IS NULL ${bloquear ? "FOR UPDATE OF ev" : ""}`,
    [id]
  );
  return rows[0] ?? null;
}

/** Las dos evaluaciones vigentes de una asignación (docente y asesor), sin datos de personas. */
export async function listarDeAsignacion(asignacionId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, tipo_evaluador, estado, nota::float8 AS nota, publicada_en
       FROM evaluaciones
      WHERE asignacion_practica_id = $1 AND eliminado_en IS NULL
      ORDER BY tipo_evaluador`,
    [asignacionId]
  );
  return rows;
}

/** Guarda (o actualiza) el borrador: puede estar incompleto. Una evaluación publicada no se toca. */
export async function guardarBorrador({ id, nota, retroalimentacion }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE evaluaciones
        SET nota = $2, retroalimentacion = $3, estado = 'BORRADOR'
      WHERE id = $1 AND estado <> 'PUBLICADA' AND eliminado_en IS NULL`,
    [id, nota, retroalimentacion]
  );
  return rowCount === 1;
}

/** Publica la nota. Queda registrada la persona que publicó (el evaluador vigente en ese momento). */
export async function publicar({ id, nota, retroalimentacion, evaluadorId }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE evaluaciones
        SET nota = $2, retroalimentacion = $3, evaluador_id = $4, estado = 'PUBLICADA', publicada_en = now()
      WHERE id = $1 AND estado <> 'PUBLICADA' AND eliminado_en IS NULL`,
    [id, nota, retroalimentacion, evaluadorId]
  );
  return rowCount === 1;
}

/** Reabre una evaluación publicada: vuelve a BORRADOR conservando nota y retroalimentación para corregirlas. */
export async function reabrir({ id, motivo }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE evaluaciones
        SET estado = 'BORRADOR', publicada_en = NULL, reabierta_en = now(), motivo_reapertura = $2
      WHERE id = $1 AND estado = 'PUBLICADA' AND eliminado_en IS NULL`,
    [id, motivo]
  );
  return rowCount === 1;
}

/**
 * Cuando Dirección cambia al docente o al asesor, la evaluación SIN publicar pasa al nuevo evaluador y vuelve a
 * PENDIENTE: el borrador del anterior no se hereda. Si el cargo queda vacío se conserva el último evaluador
 * (la columna es obligatoria), pero nadie con acceso puede evaluar hasta que se asigne a alguien.
 * Una evaluación publicada nunca se modifica.
 */
export async function reasignarPendiente({ asignacionId, tipo, evaluadorId }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE evaluaciones
        SET evaluador_id = COALESCE($3, evaluador_id), estado = 'PENDIENTE', nota = NULL, retroalimentacion = NULL
      WHERE asignacion_practica_id = $1 AND tipo_evaluador = $2::tipo_evaluador
        AND estado <> 'PUBLICADA' AND eliminado_en IS NULL`,
    [asignacionId, tipo, evaluadorId ?? null]
  );
  return rowCount;
}

// ───────────────────────── Colas y consultas ─────────────────────────

const UNIONES = `
  JOIN evaluaciones ev ON ev.asignacion_practica_id = a.id AND ev.eliminado_en IS NULL
  JOIN bitacoras b ON b.id = ev.bitacora_id AND b.eliminado_en IS NULL
  LEFT JOIN usuarios ue ON ue.id = ev.evaluador_id`;

/**
 * Arma los filtros. `forzarTipo` y `soloPublicadas` los fija el rol (docente/asesor ven solo lo suyo, el estudiante
 * solo lo publicado); el alcance de asignaciones se aplica siempre en SQL. El resumen por estado ignora el filtro de
 * estado para poder mostrar los contadores de todas las pestañas.
 */
function construirFiltros({ q, periodo_id, estado, tipo, asignacion_id, forzarTipo, soloPublicadas }, alcance) {
  const parametros = [];
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = ["a.eliminado_en IS NULL", ...condicionesDeAlcance(alcance, p)];
  if (forzarTipo) condiciones.push(`ev.tipo_evaluador = ${p(forzarTipo)}::tipo_evaluador`);
  if (soloPublicadas) condiciones.push("ev.estado = 'PUBLICADA'");
  if (tipo) condiciones.push(`ev.tipo_evaluador = ${p(tipo)}::tipo_evaluador`);
  if (periodo_id) condiciones.push(`m.periodo_academico_id = ${p(periodo_id)}`);
  if (asignacion_id) condiciones.push(`a.id = ${p(asignacion_id)}`);
  if (q) {
    const patron = p(`%${escaparLike(q)}%`);
    condiciones.push(
      `((e.nombres || ' ' || e.apellidos) ILIKE ${patron} OR e.numero_documento ILIKE ${patron} OR i.nombre ILIKE ${patron})`
    );
  }
  const parametrosBase = [...parametros];
  const condicionesBase = [...condiciones];
  if (estado) condiciones.push(`ev.estado = ${p(estado)}::estado_evaluacion`);
  return { parametros, condiciones, parametrosBase, condicionesBase, p };
}

/** Lista evaluaciones con filtros y alcance por rol. */
export async function listar(filtros, alcance, { limit, offset }, db = pool) {
  const { parametros, condiciones, parametrosBase, condicionesBase, p } = construirFiltros(filtros, alcance);
  const limite = p(limit);
  const desplazamiento = p(offset);
  const { rows } = await db.query(
    `SELECT ${SELECCION},
            ev.id AS evaluacion_id, ev.tipo_evaluador, ev.estado AS evaluacion_estado, ev.nota::float8 AS nota,
            ev.retroalimentacion, ev.publicada_en, ev.reabierta_en, ev.bitacora_id, ev.evaluador_id,
            b.estado AS bitacora_estado, b.enviada_en,
            ue.nombres AS evaluador_nombres, ue.apellidos AS evaluador_apellidos,
            count(*) OVER() AS total
       ${DESDE} ${UNIONES}
      WHERE ${condiciones.join(" AND ")}
      ORDER BY CASE ev.estado WHEN 'PENDIENTE' THEN 0 WHEN 'BORRADOR' THEN 1 ELSE 2 END,
               b.enviada_en, e.apellidos, e.nombres, a.id, ev.tipo_evaluador, ev.id
      LIMIT ${limite} OFFSET ${desplazamiento}`,
    parametros
  );
  const total = rows.length ? Number(rows[0].total) : 0;

  const { rows: conteos } = await db.query(
    `SELECT ev.estado, count(*)::int AS total
       ${DESDE} ${UNIONES}
      WHERE ${condicionesBase.join(" AND ")}
      GROUP BY ev.estado`,
    parametrosBase
  );
  const resumen = { PENDIENTE: 0, BORRADOR: 0, PUBLICADA: 0 };
  for (const fila of conteos) resumen[fila.estado] = fila.total;

  return { filas: rows.map(({ total: _total, ...fila }) => fila), total, resumen };
}

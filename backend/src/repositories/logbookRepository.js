/**
 * Repositorio de bitácoras: bitácora, respuestas, evidencias y evaluaciones pendientes asociadas.
 */
import { pool } from "../config/database.js";

// ───────────────────────── Bitácora ─────────────────────────

// Columnas que se devuelven de la bitácora (se renombran para el contrato de la API).
const COLUMNAS = `
  b.id, b.asignacion_practica_id AS asignacion_id, b.cuestionario_id, b.reflexion, b.estado,
  b.numero_revision_borrador, b.llave_idempotencia, b.enviada_en, b.devuelta_en, b.evaluada_en, b.motivo_devolucion,
  b.creado_en, b.actualizado_en`;

/** Bitácora por id (con bloqueo de fila opcional). */
export async function buscarPorId(id, db = pool, { bloquear = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS} FROM bitacoras b WHERE b.id = $1 AND b.eliminado_en IS NULL ${bloquear ? "FOR UPDATE OF b" : ""}`,
    [id]
  );
  return rows[0] ?? null;
}

/** Bitácora de una asignación. */
export async function buscarPorAsignacion(asignacionId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS} FROM bitacoras b WHERE b.asignacion_practica_id = $1 AND b.eliminado_en IS NULL`,
    [asignacionId]
  );
  return rows[0] ?? null;
}

/** Crea la bitácora de la asignación si no existe (la restricción única evita duplicados bajo concurrencia). */
export async function crear({ asignacionId, estado, cuestionarioId }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO bitacoras (asignacion_practica_id, estado, cuestionario_id)
     VALUES ($1, $2::estado_bitacora, $3)
     ON CONFLICT (asignacion_practica_id) WHERE eliminado_en IS NULL DO NOTHING
     RETURNING id`,
    [asignacionId, estado, cuestionarioId ?? null]
  );
  return rows[0] ?? null;
}

/** Asocia el cuestionario vigente a la bitácora. */
export async function asignarCuestionario(id, cuestionarioId, db = pool) {
  await db.query(`UPDATE bitacoras SET cuestionario_id = $2 WHERE id = $1`, [id, cuestionarioId]);
}

/** Marca la bitácora como ENVIADA y guarda reflexión, revisión del borrador y llave de idempotencia (evita doble envío). */
export async function marcarEnviada({ id, reflexion, revision, llave }, db = pool) {
  await db.query(
    `UPDATE bitacoras
        SET reflexion = $2, numero_revision_borrador = $3, llave_idempotencia = $4,
            estado = 'ENVIADA', enviada_en = now(), devuelta_en = NULL, motivo_devolucion = NULL
      WHERE id = $1`,
    [id, reflexion, revision, llave]
  );
}

/**
 * Cambia el estado de la bitácora durante la evaluación (ENVIADA → EN_EVALUACION → EVALUADA y de vuelta).
 * `evaluada_en` solo existe mientras la bitácora está EVALUADA.
 */
export async function cambiarEstado({ id, estado }, db = pool) {
  await db.query(
    `UPDATE bitacoras
        SET estado = $2::estado_bitacora,
            evaluada_en = CASE WHEN $3::boolean THEN COALESCE(evaluada_en, now()) ELSE NULL END
      WHERE id = $1`,
    [id, estado, estado === "EVALUADA"]
  );
}

/** Devuelve la bitácora al estudiante con el motivo. */
export async function marcarDevuelta({ id, motivo }, db = pool) {
  await db.query(
    `UPDATE bitacoras
        SET estado = 'DEVUELTA', devuelta_en = now(), motivo_devolucion = $2
      WHERE id = $1`,
    [id, motivo]
  );
}

// ───────────────────────── Respuestas oficiales ─────────────────────────

/** Respuestas oficiales (las copiadas desde el borrador al enviar) con las opciones elegidas. */
export async function listarRespuestas(bitacoraId, db = pool) {
  const { rows } = await db.query(
    `SELECT r.pregunta_id, r.respuesta_texto AS texto,
            COALESCE(array_agg(ro.opcion_pregunta_id ORDER BY o.orden_visual)
                     FILTER (WHERE ro.id IS NOT NULL), ARRAY[]::uuid[]) AS opciones_ids
       FROM respuestas_bitacora r
       LEFT JOIN respuestas_opciones ro ON ro.respuesta_bitacora_id = r.id AND ro.eliminado_en IS NULL
       LEFT JOIN opciones_pregunta o ON o.id = ro.opcion_pregunta_id
      WHERE r.bitacora_id = $1 AND r.eliminado_en IS NULL
      GROUP BY r.id
      ORDER BY r.creado_en`,
    [bitacoraId]
  );
  return rows;
}

/** Reemplaza las respuestas oficiales: las anteriores se retiran lógicamente y se insertan las nuevas. */
export async function reemplazarRespuestas(bitacoraId, respuestas, db = pool) {
  await db.query(
    `UPDATE respuestas_opciones SET eliminado_en = now()
      WHERE eliminado_en IS NULL
        AND respuesta_bitacora_id IN (SELECT id FROM respuestas_bitacora WHERE bitacora_id = $1 AND eliminado_en IS NULL)`,
    [bitacoraId]
  );
  await db.query(`UPDATE respuestas_bitacora SET eliminado_en = now() WHERE bitacora_id = $1 AND eliminado_en IS NULL`, [bitacoraId]);
  for (const respuesta of respuestas) {
    const { rows } = await db.query(
      `INSERT INTO respuestas_bitacora (bitacora_id, pregunta_id, respuesta_texto, respondida_en)
       VALUES ($1, $2, $3, now()) RETURNING id`,
      [bitacoraId, respuesta.pregunta_id, respuesta.texto ?? null]
    );
    for (const opcionId of respuesta.opciones_ids) {
      await db.query(
        `INSERT INTO respuestas_opciones (respuesta_bitacora_id, opcion_pregunta_id) VALUES ($1, $2)`,
        [rows[0].id, opcionId]
      );
    }
  }
}

// ───────────────────────── Evidencias ─────────────────────────

/** Evidencias de la bitácora. */
export async function listarEvidencias(bitacoraId, db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, e.descripcion, e.orden_visual AS orden, e.creado_en,
            a.nombre_original AS nombre, a.tipo_mime, a.tamano_bytes::bigint AS tamano_bytes
       FROM evidencias_bitacora e
       JOIN archivos a ON a.id = e.archivo_id
      WHERE e.bitacora_id = $1 AND e.eliminado_en IS NULL
      ORDER BY e.orden_visual, e.creado_en`,
    [bitacoraId]
  );
  return rows.map((fila) => ({ ...fila, tamano_bytes: Number(fila.tamano_bytes) }));
}

/** Cuenta evidencias. */
export async function contarEvidencias(bitacoraId, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS total, COALESCE(max(orden_visual), 0)::int AS ultimo_orden
       FROM evidencias_bitacora WHERE bitacora_id = $1 AND eliminado_en IS NULL`,
    [bitacoraId]
  );
  return rows[0];
}

/** Una evidencia de la bitácora. */
export async function buscarEvidencia(id, bitacoraId, db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, e.descripcion, e.orden_visual AS orden,
            a.bucket, a.ruta_almacenamiento AS ruta, a.nombre_original AS nombre, a.tipo_mime, a.tamano_bytes::bigint AS tamano_bytes
       FROM evidencias_bitacora e
       JOIN archivos a ON a.id = e.archivo_id
      WHERE e.id = $1 AND e.bitacora_id = $2 AND e.eliminado_en IS NULL`,
    [id, bitacoraId]
  );
  return rows[0] ? { ...rows[0], tamano_bytes: Number(rows[0].tamano_bytes) } : null;
}

/** Inserta una evidencia. */
export async function crearEvidencia({ bitacoraId, archivoId, creadoPorId, descripcion, orden }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO evidencias_bitacora (bitacora_id, archivo_id, creado_por_id, descripcion, orden_visual)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [bitacoraId, archivoId, creadoPorId, descripcion ?? null, orden]
  );
  return rows[0];
}

/** Cambia la descripción de una evidencia. */
export async function actualizarDescripcionEvidencia(id, descripcion, db = pool) {
  await db.query(`UPDATE evidencias_bitacora SET descripcion = $2 WHERE id = $1`, [id, descripcion]);
}

/** Retiro lógico: el registro y el archivo se conservan como trazabilidad. */
export async function retirarEvidencia(id, db = pool) {
  await db.query(`UPDATE evidencias_bitacora SET eliminado_en = now() WHERE id = $1`, [id]);
}

// ───────────────────────── Evaluaciones asociadas al envío ─────────────────────────

/** Una evaluación pendiente por evaluador (docente y asesor), independientes entre sí. */
export async function crearEvaluacionesPendientes({ asignacionId, bitacoraId, docenteId, asesorId }, db = pool) {
  await db.query(
    `INSERT INTO evaluaciones (asignacion_practica_id, bitacora_id, evaluador_id, tipo_evaluador, estado)
     VALUES ($1, $2, $3, 'DOCENTE_SUPERVISOR', 'PENDIENTE'), ($1, $2, $4, 'ASESOR_SITIO', 'PENDIENTE')`,
    [asignacionId, bitacoraId, docenteId, asesorId]
  );
}

/** Cuántas evaluaciones están publicadas. */
export async function contarEvaluacionesPublicadas(bitacoraId, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS total FROM evaluaciones
      WHERE bitacora_id = $1 AND estado = 'PUBLICADA' AND eliminado_en IS NULL`,
    [bitacoraId]
  );
  return rows[0].total;
}

/** Al devolver la bitácora, las evaluaciones sin publicar se retiran (se recrean en el siguiente envío). */
export async function retirarEvaluacionesDeBitacora(bitacoraId, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE evaluaciones SET eliminado_en = now() WHERE bitacora_id = $1 AND eliminado_en IS NULL`,
    [bitacoraId]
  );
  return rowCount;
}

/** Evaluaciones de la bitácora. */
export async function listarEvaluaciones(bitacoraId, db = pool) {
  const { rows } = await db.query(
    `SELECT tipo_evaluador, estado FROM evaluaciones
      WHERE bitacora_id = $1 AND eliminado_en IS NULL ORDER BY tipo_evaluador`,
    [bitacoraId]
  );
  return rows;
}

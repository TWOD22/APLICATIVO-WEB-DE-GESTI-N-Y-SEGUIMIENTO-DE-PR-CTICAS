/**
 * Repositorio de cuestionarios versionados, preguntas y opciones.
 * Un cuestionario publicado queda congelado; los cambios generan una nueva versión.
 */
import { pool } from "../config/database.js";

// ───────────────────────── Niveles y versiones ─────────────────────────

/** Nivel de práctica por id. */
export async function buscarNivel(nivelId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre, numero_semestre FROM niveles_practica WHERE id = $1 AND eliminado_en IS NULL`,
    [nivelId]
  );
  return rows[0] ?? null;
}

/** Bloquea todas las versiones del nivel: serializa publicar/habilitar y evita dos habilitados a la vez. */
export async function bloquearNivel(nivelId, db = pool) {
  await db.query(`SELECT id FROM cuestionarios WHERE nivel_practica_id = $1 AND eliminado_en IS NULL FOR UPDATE`, [nivelId]);
}

const SELECCION_CUESTIONARIO = `
  c.id, c.nivel_practica_id, c.numero_version, c.titulo, c.habilitado, c.publicado, c.publicado_en,
  c.creado_en, c.actualizado_en,
  n.codigo AS nivel_codigo, n.nombre AS nivel_nombre, n.numero_semestre AS nivel_semestre`;

/** Cuestionarios con filtros. */
export async function listar({ nivelId, semestre }, db = pool) {
  const parametros = [];
  const condiciones = ["c.eliminado_en IS NULL"];
  if (nivelId) {
    parametros.push(nivelId);
    condiciones.push(`c.nivel_practica_id = $${parametros.length}`);
  }
  if (semestre) {
    parametros.push(semestre);
    condiciones.push(`n.numero_semestre = $${parametros.length}`);
  }
  const { rows } = await db.query(
    `SELECT ${SELECCION_CUESTIONARIO},
            (SELECT count(*)::int FROM preguntas p WHERE p.cuestionario_id = c.id AND p.eliminado_en IS NULL) AS total_preguntas,
            (SELECT count(*)::int FROM bitacoras b WHERE b.cuestionario_id = c.id AND b.eliminado_en IS NULL) AS total_bitacoras
       FROM cuestionarios c
       JOIN niveles_practica n ON n.id = c.nivel_practica_id
      WHERE ${condiciones.join(" AND ")}
      ORDER BY n.numero_semestre, c.numero_version DESC`,
    parametros
  );
  return rows;
}

/** Cuestionario por id. */
export async function buscarPorId(id, db = pool, { bloquear = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${SELECCION_CUESTIONARIO},
            (SELECT count(*)::int FROM bitacoras b WHERE b.cuestionario_id = c.id AND b.eliminado_en IS NULL) AS total_bitacoras
       FROM cuestionarios c
       JOIN niveles_practica n ON n.id = c.nivel_practica_id
      WHERE c.id = $1 AND c.eliminado_en IS NULL
      ${bloquear ? "FOR UPDATE OF c" : ""}`,
    [id]
  );
  return rows[0] ?? null;
}

/** Borrador vigente del nivel. */
export async function buscarBorradorDeNivel(nivelId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, numero_version FROM cuestionarios
      WHERE nivel_practica_id = $1 AND NOT publicado AND eliminado_en IS NULL`,
    [nivelId]
  );
  return rows[0] ?? null;
}

/** Cuestionario habilitado del nivel. */
export async function buscarHabilitadoDeNivel(nivelId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, numero_version FROM cuestionarios
      WHERE nivel_practica_id = $1 AND habilitado AND eliminado_en IS NULL`,
    [nivelId]
  );
  return rows[0] ?? null;
}

/** Versión publicada más reciente (base por defecto para crear la siguiente versión). */
export async function buscarUltimaPublicada(nivelId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, numero_version FROM cuestionarios
      WHERE nivel_practica_id = $1 AND publicado AND eliminado_en IS NULL
      ORDER BY numero_version DESC LIMIT 1`,
    [nivelId]
  );
  return rows[0] ?? null;
}

/** Última versión creada. */
export async function ultimaVersion(nivelId, db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(max(numero_version), 0)::int AS ultima FROM cuestionarios WHERE nivel_practica_id = $1`,
    [nivelId]
  );
  return rows[0].ultima;
}

/** Crea un cuestionario (borrador). */
export async function crear({ nivelId, titulo, creadoPorId, numeroVersion }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO cuestionarios (nivel_practica_id, creado_por_id, numero_version, titulo)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [nivelId, creadoPorId, numeroVersion, titulo]
  );
  return rows[0];
}

/** Cambia el título. */
export async function actualizarTitulo(id, titulo, db = pool) {
  await db.query(`UPDATE cuestionarios SET titulo = $2 WHERE id = $1`, [id, titulo]);
}

/** Publica y habilita en un solo UPDATE (la restricción exige publicado para estar habilitado). */
export async function publicarYHabilitar(id, usuarioId, db = pool) {
  await db.query(
    `UPDATE cuestionarios
        SET publicado = true, publicado_en = now(), publicado_por_id = $2, habilitado = true
      WHERE id = $1`,
    [id, usuarioId]
  );
}

/** Deshabilita los demás cuestionarios del nivel. */
export async function deshabilitarOtrosDelNivel(nivelId, excepto, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE cuestionarios SET habilitado = false
      WHERE nivel_practica_id = $1 AND id <> $2 AND habilitado AND eliminado_en IS NULL`,
    [nivelId, excepto]
  );
  return rowCount;
}

/** Habilita o deshabilita. */
export async function cambiarHabilitado(id, habilitado, db = pool) {
  await db.query(`UPDATE cuestionarios SET habilitado = $2 WHERE id = $1`, [id, habilitado]);
}

// ───────────────────────── Preguntas y opciones ─────────────────────────

/** Preguntas vigentes del cuestionario con sus opciones, en orden visual. */
export async function cargarPreguntas(cuestionarioId, db = pool) {
  const { rows } = await db.query(
    `SELECT p.id, p.tipo, p.enunciado, p.obligatoria, p.orden_visual,
            COALESCE(
              json_agg(json_build_object('id', o.id, 'etiqueta', o.etiqueta, 'valor', o.valor, 'orden', o.orden_visual)
                       ORDER BY o.orden_visual) FILTER (WHERE o.id IS NOT NULL),
              '[]'::json
            ) AS opciones
       FROM preguntas p
       LEFT JOIN opciones_pregunta o ON o.pregunta_id = p.id AND o.eliminado_en IS NULL
      WHERE p.cuestionario_id = $1 AND p.eliminado_en IS NULL
      GROUP BY p.id
      ORDER BY p.orden_visual, p.creado_en`,
    [cuestionarioId]
  );
  return rows.map((fila) => ({ ...fila, orden: fila.orden_visual }));
}

/** Pregunta por id. */
export async function buscarPregunta(id, db = pool, { bloquear = false } = {}) {
  const { rows } = await db.query(
    `SELECT p.id, p.cuestionario_id, p.tipo, p.enunciado, p.obligatoria, p.orden_visual, c.publicado
       FROM preguntas p
       JOIN cuestionarios c ON c.id = p.cuestionario_id
      WHERE p.id = $1 AND p.eliminado_en IS NULL AND c.eliminado_en IS NULL
      ${bloquear ? "FOR UPDATE OF p" : ""}`,
    [id]
  );
  return rows[0] ?? null;
}

/** Siguiente posición para una pregunta nueva. */
export async function siguienteOrden(cuestionarioId, db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(max(orden_visual), 0)::int + 1 AS siguiente
       FROM preguntas WHERE cuestionario_id = $1 AND eliminado_en IS NULL`,
    [cuestionarioId]
  );
  return rows[0].siguiente;
}

/** Inserta una pregunta. */
export async function insertarPregunta({ cuestionarioId, tipo, enunciado, obligatoria, orden }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO preguntas (cuestionario_id, tipo, enunciado, obligatoria, orden_visual)
     VALUES ($1, $2::tipo_pregunta, $3, $4, $5) RETURNING id`,
    [cuestionarioId, tipo, enunciado, obligatoria, orden]
  );
  return rows[0];
}

/** Inserta las opciones de una pregunta cerrada. */
export async function insertarOpciones(preguntaId, etiquetas, db = pool) {
  for (const [indice, etiqueta] of etiquetas.entries()) {
    await db.query(
      `INSERT INTO opciones_pregunta (pregunta_id, etiqueta, valor, orden_visual) VALUES ($1, $2, $3, $4)`,
      [preguntaId, etiqueta, `opcion_${indice + 1}`, indice + 1]
    );
  }
}

/** Actualiza una pregunta. */
export async function actualizarPregunta(id, { tipo, enunciado, obligatoria }, db = pool) {
  await db.query(
    `UPDATE preguntas SET tipo = $2::tipo_pregunta, enunciado = $3, obligatoria = $4 WHERE id = $1`,
    [id, tipo, enunciado, obligatoria]
  );
}

/** Retira lógicamente las opciones actuales (nunca se borran físicamente). */
export async function retirarOpciones(preguntaId, db = pool) {
  await db.query(`UPDATE opciones_pregunta SET eliminado_en = now() WHERE pregunta_id = $1 AND eliminado_en IS NULL`, [preguntaId]);
}

/** Retira (borrado lógico) una pregunta. */
export async function retirarPregunta(id, db = pool) {
  await retirarOpciones(id, db);
  await db.query(`UPDATE preguntas SET eliminado_en = now() WHERE id = $1`, [id]);
}

/** Fija la posición de una pregunta. */
export async function fijarOrden(preguntaId, orden, db = pool) {
  await db.query(`UPDATE preguntas SET orden_visual = $2 WHERE id = $1`, [preguntaId, orden]);
}

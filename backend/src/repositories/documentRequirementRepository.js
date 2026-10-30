/**
 * Repositorio de la configuración de documentos legales: catálogo de tipos y requisitos por nivel de práctica.
 */
import { pool } from "../config/database.js";

/** Estados de una práctica que todavía no terminó (los que sufren un cambio de requisitos). */

/** Todos los tipos de documento con en cuántos niveles se piden. */
export async function listarTipos(db = pool) {
  const { rows } = await db.query(
    `SELECT t.id, t.codigo, t.nombre, t.descripcion, t.tipos_mime_permitidos AS mime, t.tamano_maximo_bytes::bigint AS tamano_maximo_bytes, t.activo,
            (SELECT count(*)::int FROM requisitos_documentales r WHERE r.tipo_documento_legal_id = t.id AND r.eliminado_en IS NULL) AS niveles
       FROM tipos_documento_legal t WHERE t.eliminado_en IS NULL ORDER BY t.activo DESC, t.nombre`
  );
  return rows.map((t) => ({ ...t, tamano_maximo_bytes: Number(t.tamano_maximo_bytes) }));
}

export async function buscarTipo(id, db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre, descripcion, activo FROM tipos_documento_legal WHERE id = $1 AND eliminado_en IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

export async function existeCodigo(codigo, db = pool) {
  const { rows } = await db.query(`SELECT 1 FROM tipos_documento_legal WHERE codigo = $1 AND eliminado_en IS NULL`, [codigo]);
  return rows.length > 0;
}

export async function existeNombre(nombre, exceptoId = null, db = pool) {
  const { rows } = await db.query(
    `SELECT 1 FROM tipos_documento_legal WHERE lower(nombre) = lower($1) AND eliminado_en IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
    [nombre, exceptoId]
  );
  return rows.length > 0;
}

export async function crearTipo({ codigo, nombre, descripcion, tamanoMaximoBytes }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO tipos_documento_legal (codigo, nombre, descripcion, tamano_maximo_bytes) VALUES ($1, $2, $3, $4) RETURNING id`,
    [codigo, nombre, descripcion ?? null, tamanoMaximoBytes]
  );
  return rows[0];
}

export async function actualizarTipo(id, { nombre, descripcion, activo, tamanoMaximoBytes }, db = pool) {
  await db.query(
    `UPDATE tipos_documento_legal SET nombre = COALESCE($2, nombre), descripcion = CASE WHEN $3::boolean THEN $4 ELSE descripcion END,
            activo = COALESCE($5, activo), tamano_maximo_bytes = COALESCE($6, tamano_maximo_bytes), actualizado_en = now()
      WHERE id = $1`,
    [id, nombre ?? null, descripcion !== undefined, descripcion ?? null, activo ?? null, tamanoMaximoBytes ?? null]
  );
}

/** Niveles activos con los requisitos que tienen hoy. */
export async function listarRequisitosPorNivel(db = pool) {
  const { rows } = await db.query(
    `SELECT n.id AS nivel_id, n.nombre AS nivel_nombre, n.orden_visual, r.tipo_documento_legal_id AS tipo_id, r.obligatorio, r.orden_visual AS orden
       FROM niveles_practica n
       LEFT JOIN requisitos_documentales r ON r.nivel_practica_id = n.id AND r.eliminado_en IS NULL
      WHERE n.eliminado_en IS NULL AND n.activo ORDER BY n.orden_visual, r.orden_visual`
  );
  return rows;
}

/** Niveles activos (ids). */
export async function nivelesActivos(db = pool) {
  const { rows } = await db.query(`SELECT id, nombre FROM niveles_practica WHERE eliminado_en IS NULL AND activo ORDER BY orden_visual`);
  return rows;
}

/** Requisito vigente de un tipo en un nivel. */
export async function requisitosDeTipo(tipoId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, nivel_practica_id AS nivel_id, obligatorio FROM requisitos_documentales WHERE tipo_documento_legal_id = $1 AND eliminado_en IS NULL`,
    [tipoId]
  );
  return rows;
}

/** Crea o actualiza el requisito (si ya existía lo cambia; si no, lo agrega al final de la lista del nivel). */
export async function fijarRequisito({ nivelId, tipoId, obligatorio }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE requisitos_documentales SET obligatorio = $3, actualizado_en = now()
      WHERE nivel_practica_id = $1 AND tipo_documento_legal_id = $2 AND eliminado_en IS NULL`,
    [nivelId, tipoId, obligatorio]
  );
  if (rowCount) return;
  await db.query(
    `INSERT INTO requisitos_documentales (nivel_practica_id, tipo_documento_legal_id, obligatorio, orden_visual)
     VALUES ($1, $2, $3, COALESCE((SELECT max(orden_visual) FROM requisitos_documentales WHERE nivel_practica_id = $1 AND eliminado_en IS NULL), 0) + 1)`,
    [nivelId, tipoId, obligatorio]
  );
}

/** Quita el requisito de un nivel (borrado lógico; los archivos ya subidos se conservan). */
export async function quitarRequisito({ nivelId, tipoId }, db = pool) {
  await db.query(
    `UPDATE requisitos_documentales SET eliminado_en = now() WHERE nivel_practica_id = $1 AND tipo_documento_legal_id = $2 AND eliminado_en IS NULL`,
    [nivelId, tipoId]
  );
}

/** Prácticas que aún no tienen su expediente aprobado: un documento obligatorio nuevo les corresponde de lleno. */
const SIN_EXPEDIENTE_APROBADO = ["BORRADOR", "ENVIADA", "DEVUELTA", "PENDIENTE_DOCUMENTOS"];
/** Prácticas que ya pasaron la aprobación de documentos y siguen abiertas. */
const EN_CURSO = ["DOCUMENTOS_APROBADOS", "PLAZA_SELECCIONADA", "ACTIVA", "PENDIENTE_EVALUACION"];

/** Cuenta las prácticas de esos niveles, separadas en "sin expediente aprobado" y "en curso". */
export async function contarAfectados(nivelIds, db = pool) {
  if (!nivelIds.length) return { pendientes: 0, en_curso: 0 };
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE a.estado = ANY($2))::int AS pendientes,
            count(*) FILTER (WHERE a.estado = ANY($3))::int AS en_curso
       FROM asignaciones_practica a
      WHERE a.eliminado_en IS NULL AND a.nivel_practica_id = ANY($1::uuid[])`,
    [nivelIds, SIN_EXPEDIENTE_APROBADO, EN_CURSO]
  );
  return rows[0];
}

/** Exenta del requisito (de este tipo, en esos niveles) a las prácticas en curso. */
export async function exentarEnCurso({ tipoId, nivelIds }, db = pool) {
  if (!nivelIds.length) return;
  await db.query(
    `INSERT INTO requisitos_exentos (requisito_id, asignacion_practica_id)
     SELECT r.id, a.id
       FROM requisitos_documentales r
       JOIN asignaciones_practica a ON a.nivel_practica_id = r.nivel_practica_id AND a.eliminado_en IS NULL AND a.estado = ANY($3)
      WHERE r.tipo_documento_legal_id = $1 AND r.eliminado_en IS NULL AND r.nivel_practica_id = ANY($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [tipoId, nivelIds, EN_CURSO]
  );
}

/** Quita las exenciones de este tipo en esos niveles (el requisito vuelve a exigirse a todos). */
export async function quitarExenciones({ tipoId, nivelIds }, db = pool) {
  if (!nivelIds.length) return;
  await db.query(
    `DELETE FROM requisitos_exentos ex USING requisitos_documentales r
      WHERE ex.requisito_id = r.id AND r.tipo_documento_legal_id = $1 AND r.nivel_practica_id = ANY($2::uuid[])`,
    [tipoId, nivelIds]
  );
}

/** Niveles donde este tipo ya es obligatorio pero hay prácticas en curso exentas, con cuántas son. */
export async function exencionesVigentes(tipoId, db = pool) {
  const { rows } = await db.query(
    `SELECT r.nivel_practica_id AS nivel_id, count(*)::int AS total
       FROM requisitos_exentos ex
       JOIN requisitos_documentales r ON r.id = ex.requisito_id AND r.eliminado_en IS NULL AND r.obligatorio
       JOIN asignaciones_practica a ON a.id = ex.asignacion_practica_id AND a.eliminado_en IS NULL AND a.estado = ANY($2)
      WHERE r.tipo_documento_legal_id = $1
      GROUP BY r.nivel_practica_id`,
    [tipoId, EN_CURSO]
  );
  return rows;
}

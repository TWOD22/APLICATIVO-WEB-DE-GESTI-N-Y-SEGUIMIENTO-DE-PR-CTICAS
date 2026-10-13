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

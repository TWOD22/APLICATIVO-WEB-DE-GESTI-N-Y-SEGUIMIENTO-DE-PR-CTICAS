/**
 * Repositorio de programas académicos y niveles de práctica.
 */
import { pool } from "../config/database.js";

/** Programas. */
export async function listar(db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre, cantidad_semestres, activo
       FROM programas_academicos WHERE eliminado_en IS NULL ORDER BY nombre`
  );
  return rows;
}

/** Programa por id. */
export async function buscarPorId(id, db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre, cantidad_semestres, activo
       FROM programas_academicos WHERE id = $1 AND eliminado_en IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

/** Niveles de práctica (opcionalmente de un programa). */
export async function listarNivelesPractica({ programaId } = {}, db = pool) {
  const { rows } = await db.query(
    `SELECT n.id, n.programa_academico_id AS programa_id, n.codigo, n.nombre,
            n.numero_semestre AS semestre, n.orden_visual AS orden, n.activo
       FROM niveles_practica n
      WHERE n.eliminado_en IS NULL
        AND ($1::uuid IS NULL OR n.programa_academico_id = $1)
      ORDER BY n.programa_academico_id, n.orden_visual`,
    [programaId ?? null]
  );
  return rows;
}

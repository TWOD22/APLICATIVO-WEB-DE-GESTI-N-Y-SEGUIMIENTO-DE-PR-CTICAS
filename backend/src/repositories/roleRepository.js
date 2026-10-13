/**
 * Repositorio de roles de usuario.
 */
import { pool } from "../config/database.js";

/** Roles vigentes hoy de un usuario (vigente_desde <= hoy <= vigente_hasta). */
export async function listarRolesVigentes(usuarioId, db = pool) {
  const { rows } = await db.query(
    `SELECT r.id, r.codigo, r.nombre
       FROM usuarios_roles ur
       JOIN roles r ON r.id = ur.rol_id AND r.eliminado_en IS NULL
      WHERE ur.usuario_id = $1
        AND ur.eliminado_en IS NULL
        AND ur.vigente_desde <= current_date
        AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= current_date)
      ORDER BY r.codigo`,
    [usuarioId]
  );
  return rows;
}

/** Rol por código. */
export async function buscarPorCodigo(codigo, db = pool) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre FROM roles WHERE codigo = $1 AND eliminado_en IS NULL`,
    [codigo]
  );
  return rows[0] ?? null;
}

/** Asigna un rol al usuario. */
export async function asignarRol(usuarioId, rolId, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES ($1, $2) RETURNING id`,
    [usuarioId, rolId]
  );
  return rows[0];
}

/**
 * Repositorio del outbox (tabla eventos_salientes): eventos del servicio principal pendientes de enviar al
 * servicio de notificaciones y auditoría. Se escriben en la misma conexión que el cambio de negocio cuando se puede.
 */
import { pool } from "../config/database.js";

/** Guarda un evento PENDIENTE. Pásale el `client` de la transacción para que se confirme o revierta junto al cambio. */
export async function insertar({ id, tipo, version = 1, actorId = null, entidadTipo, entidadId, destinatarios = [], carga = {} }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO eventos_salientes (id, tipo, version, actor_id, entidad_tipo, entidad_id, destinatarios, carga)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     RETURNING id, creado_en`,
    [id ?? null, tipo, version, actorId, entidadTipo, entidadId, JSON.stringify(destinatarios), JSON.stringify(carga)]
  );
  return rows[0];
}

/**
 * Toma (y bloquea) los eventos vencidos para enviarlos. SKIP LOCKED permite varios publicadores a la vez sin que dos
 * tomen el mismo evento. Debe llamarse dentro de una transacción.
 */
export async function reclamarLote(limite, db) {
  const { rows } = await db.query(
    `SELECT id, tipo, version, actor_id, entidad_tipo, entidad_id, destinatarios, carga, intentos, creado_en
       FROM eventos_salientes
      WHERE estado = 'PENDIENTE' AND proximo_intento_en <= now()
      ORDER BY creado_en, id
      LIMIT $1
        FOR UPDATE SKIP LOCKED`,
    [limite]
  );
  return rows;
}

export async function marcarPublicado(id, db = pool) {
  await db.query(
    `UPDATE eventos_salientes SET estado = 'PUBLICADO', publicado_en = now(), intentos = intentos + 1, ultimo_error = NULL WHERE id = $1`,
    [id]
  );
}

/** Registra un intento fallido: reprograma con espera o, al agotar los intentos, lo deja FALLIDO. */
export async function marcarFallo(id, { error, esperaSegundos, definitivo }, db = pool) {
  await db.query(
    `UPDATE eventos_salientes
        SET intentos = intentos + 1,
            ultimo_error = left($2, 1000),
            estado = CASE WHEN $4 THEN 'FALLIDO' ELSE 'PENDIENTE' END,
            proximo_intento_en = now() + make_interval(secs => $3)
      WHERE id = $1`,
    [id, error, esperaSegundos, definitivo]
  );
}

/** Eventos fallidos que un administrador decide volver a intentar. */
export async function reencolarFallidos(db = pool) {
  const { rowCount } = await db.query(
    `UPDATE eventos_salientes SET estado = 'PENDIENTE', intentos = 0, proximo_intento_en = now() WHERE estado = 'FALLIDO'`
  );
  return rowCount;
}

export async function contarPorEstado(db = pool) {
  const { rows } = await db.query(`SELECT estado, count(*)::int AS total FROM eventos_salientes GROUP BY estado`);
  return Object.fromEntries(["PENDIENTE", "PUBLICADO", "FALLIDO"].map((e) => [e, rows.find((r) => r.estado === e)?.total ?? 0]));
}

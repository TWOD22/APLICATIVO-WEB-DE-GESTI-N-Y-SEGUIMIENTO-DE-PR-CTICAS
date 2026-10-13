/**
 * Seed base: carga los catálogos iniciales (roles, programa, niveles, documentos y periodo) y, opcionalmente, crea el Director inicial.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Ruta del archivo SQL con los catálogos base.
const RUTA_CATALOGOS = path.join(path.dirname(fileURLToPath(import.meta.url)), "001_catalogos_base.sql");

/**
 * Seed base idempotente: roles, programa, niveles, tipos y requisitos documentales y periodo activo.
 * Si se entregan los datos del Director (con su UID de Firebase) también lo crea/enlaza.
 * `client` es un cliente de pg (idealmente dentro de una transacción).
 */
export async function ejecutarSeedBase(client, { director } = {}) {
    // Catálogos base (idempotente).
  await client.query(await readFile(RUTA_CATALOGOS, "utf8"));

    // Sin datos del Director, solo se cargan los catálogos.
  if (!director) return { director: "omitido" };

    // El Director debe existir antes en Firebase Auth; aquí se crea/enlaza su fila en PostgreSQL con su rol y programa.
  const { rows: usuarios } = await client.query(
    `INSERT INTO usuarios (firebase_uid, numero_documento, nombres, apellidos, correo_institucional)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (firebase_uid) WHERE eliminado_en IS NULL
       DO UPDATE SET nombres = EXCLUDED.nombres, apellidos = EXCLUDED.apellidos
     RETURNING id`,
    [director.firebase_uid, director.documento, director.nombres, director.apellidos, director.correo]
  );
  const usuarioId = usuarios[0].id;

  await client.query(
    `INSERT INTO usuarios_roles (usuario_id, rol_id)
     SELECT $1, r.id FROM roles r WHERE r.codigo = 'DIRECTOR_PROGRAMA' AND r.eliminado_en IS NULL
     ON CONFLICT (usuario_id, rol_id) WHERE eliminado_en IS NULL DO NOTHING`,
    [usuarioId]
  );
  await client.query(
    `INSERT INTO usuarios_programas (usuario_id, programa_academico_id)
     SELECT $1, p.id FROM programas_academicos p WHERE p.codigo = 'LEI' AND p.eliminado_en IS NULL
     ON CONFLICT (usuario_id, programa_academico_id) WHERE eliminado_en IS NULL DO NOTHING`,
    [usuarioId]
  );
  return { director: "ok", usuario_id: usuarioId };
}

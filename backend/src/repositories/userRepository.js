/**
 * Repositorio de usuarios.
 * Los nombres de campos de la API se traducen a las columnas reales de PostgreSQL.
 */
import { pool } from "../config/database.js";
import { escaparLike } from "../utils/pagination.js";
import { ESTADOS_ASIGNACION_EN_CURSO } from "../utils/constants.js";

const COLUMNAS_USUARIO = `u.id, u.firebase_uid, u.tipo_documento, u.numero_documento AS documento, u.nombres, u.apellidos,
  u.correo_institucional AS correo, u.telefono, u.estado, u.ultimo_acceso_en, u.creado_en, u.actualizado_en`;

// Nombre en la API -> columna en PostgreSQL (el contrato de la API no cambia).
const COLUMNAS_ACTUALIZABLES = {
  documento: "numero_documento",
  nombres: "nombres",
  apellidos: "apellidos",
  correo: "correo_institucional",
  telefono: "telefono",
};
const RETORNO_USUARIO = `id, firebase_uid, tipo_documento, numero_documento AS documento, nombres, apellidos,
  correo_institucional AS correo, telefono, estado, ultimo_acceso_en, creado_en, actualizado_en`;

/** Usuario por id. */
export async function buscarPorId(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_USUARIO} FROM usuarios u WHERE u.id = $1 AND u.eliminado_en IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

/** Usuario por el identificador de Firebase. */
export async function buscarPorFirebaseUid(firebaseUid, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_USUARIO} FROM usuarios u WHERE u.firebase_uid = $1 AND u.eliminado_en IS NULL`,
    [firebaseUid]
  );
  return rows[0] ?? null;
}

/** Devuelve los campos únicos que ya están en uso por otro usuario. */
export async function buscarDuplicados({ documento, correo, excluirId = null }, db = pool) {
  const { rows } = await db.query(
    `SELECT u.numero_documento AS documento, u.correo_institucional AS correo
       FROM usuarios u
      WHERE u.eliminado_en IS NULL
        AND ($3::uuid IS NULL OR u.id <> $3)
        AND (u.numero_documento = $1 OR u.correo_institucional = $2::citext)`,
    [documento ?? null, correo ?? null, excluirId]
  );
  const campos = new Set();
  for (const fila of rows) {
    if (documento && fila.documento === documento) campos.add("documento");
    if (correo && String(fila.correo).toLowerCase() === String(correo).toLowerCase()) campos.add("correo");
  }
  return [...campos];
}

/** Inserta usuario. */
export async function crear({ firebaseUid, documento, nombres, apellidos, correo, telefono = null }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO usuarios (firebase_uid, numero_documento, nombres, apellidos, correo_institucional, telefono)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${RETORNO_USUARIO}`,
    [firebaseUid, documento, nombres, apellidos, correo, telefono]
  );
  return rows[0];
}

/** Actualiza campos permitidos. */
export async function actualizar(id, cambios, db = pool) {
  const claves = Object.keys(cambios).filter((clave) => clave in COLUMNAS_ACTUALIZABLES);
  if (!claves.length) return buscarPorId(id, db);
  const asignaciones = claves.map((clave, indice) => `${COLUMNAS_ACTUALIZABLES[clave]} = $${indice + 2}`);
  const { rows } = await db.query(
    `UPDATE usuarios SET ${asignaciones.join(", ")}
      WHERE id = $1 AND eliminado_en IS NULL
      RETURNING ${RETORNO_USUARIO}`,
    [id, ...claves.map((clave) => cambios[clave])]
  );
  return rows[0] ?? null;
}

/** Cambia el estado. */
export async function cambiarEstado(id, estado, db = pool) {
  const { rows } = await db.query(
    `UPDATE usuarios SET estado = $2::estado_usuario
      WHERE id = $1 AND eliminado_en IS NULL
      RETURNING ${RETORNO_USUARIO}`,
    [id, estado]
  );
  return rows[0] ?? null;
}

/** Lista con filtros, búsqueda y paginación. */
export async function listar({ q, rol, semestre, estado, limit, offset }, db = pool) {
  const parametros = [];
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = ["u.eliminado_en IS NULL"];

  if (q) {
    const patron = p(`%${escaparLike(q)}%`);
    condiciones.push(
      `(u.numero_documento ILIKE ${patron} OR u.correo_institucional::text ILIKE ${patron} OR (u.nombres || ' ' || u.apellidos) ILIKE ${patron})`
    );
  }
  if (rol) {
    condiciones.push(
      `EXISTS (SELECT 1 FROM usuarios_roles ur2 JOIN roles r2 ON r2.id = ur2.rol_id
                WHERE ur2.usuario_id = u.id AND ur2.eliminado_en IS NULL AND r2.codigo = ${p(rol)})`
    );
  }
  if (semestre) condiciones.push(`m.semestre = ${p(semestre)}::smallint`);
  if (estado) condiciones.push(`u.estado = ${p(estado)}::estado_usuario`);

  const limite = p(limit);
  const desplazamiento = p(offset);

  const { rows } = await db.query(
    `SELECT u.id, u.numero_documento AS documento, u.nombres, u.apellidos, u.correo_institucional AS correo, u.telefono, u.estado, u.creado_en,
            COALESCE(array_agg(DISTINCT r.codigo) FILTER (WHERE r.codigo IS NOT NULL), '{}') AS roles,
            m.semestre,
            count(*) OVER() AS total
       FROM usuarios u
       LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.eliminado_en IS NULL
       LEFT JOIN roles r ON r.id = ur.rol_id AND r.eliminado_en IS NULL
       LEFT JOIN LATERAL (
              SELECT me.numero_semestre AS semestre
                FROM matriculas_estudiantes me
                JOIN periodos_academicos pe ON pe.id = me.periodo_academico_id
               WHERE me.estudiante_id = u.id AND me.eliminado_en IS NULL
               ORDER BY pe.fecha_inicio DESC
               LIMIT 1
            ) m ON true
      WHERE ${condiciones.join(" AND ")}
      GROUP BY u.id, m.semestre
      ORDER BY u.apellidos, u.nombres, u.id
      LIMIT ${limite} OFFSET ${desplazamiento}`,
    parametros
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { filas: rows.map(({ total: _total, ...fila }) => fila), total };
}

/** Prácticas en curso en las que participa el usuario (como estudiante, docente o asesor). */
export async function contarAsignacionesEnCurso(usuarioId, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS total
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
      WHERE a.eliminado_en IS NULL
        AND a.estado = ANY($2::estado_asignacion[])
        AND (m.estudiante_id = $1 OR a.docente_supervisor_id = $1 OR a.asesor_sitio_id = $1)`,
    [usuarioId, ESTADOS_ASIGNACION_EN_CURSO]
  );
  return rows[0].total;
}

/** Historial de prácticas de un estudiante, una fila por nivel y periodo. */
export async function listarHistorialPracticas(estudianteId, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id AS asignacion_id,
            pe.id AS periodo_id, pe.codigo AS periodo_codigo,
            n.id AS nivel_id, n.codigo AS nivel_codigo, n.nombre AS nivel_nombre, n.orden_visual AS nivel_orden,
            a.estado, a.fecha_inicio, a.fecha_fin,
            i.id AS institucion_id, i.nombre AS institucion_nombre,
            COALESCE(ued.id, d.id) AS docente_id,
            COALESCE(ued.nombres || ' ' || ued.apellidos, d.nombres || ' ' || d.apellidos) AS docente_nombre,
            COALESCE(uea.id, s.id) AS asesor_id,
            COALESCE(uea.nombres || ' ' || uea.apellidos, s.nombres || ' ' || s.apellidos) AS asesor_nombre,
            b.estado AS bitacora_estado,
            COALESCE(ed.estado, 'PENDIENTE') AS evaluacion_docente_estado,
            CASE WHEN ed.estado = 'PUBLICADA' THEN ed.nota END AS nota_docente,
            COALESCE(ea.estado, 'PENDIENTE') AS evaluacion_asesor_estado,
            CASE WHEN ea.estado = 'PUBLICADA' THEN ea.nota END AS nota_asesor
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
       JOIN periodos_academicos pe ON pe.id = m.periodo_academico_id
       JOIN niveles_practica n ON n.id = a.nivel_practica_id
       JOIN instituciones i ON i.id = a.institucion_id
       LEFT JOIN usuarios d ON d.id = a.docente_supervisor_id
       LEFT JOIN usuarios s ON s.id = a.asesor_sitio_id
       LEFT JOIN bitacoras b ON b.asignacion_practica_id = a.id AND b.eliminado_en IS NULL
       LEFT JOIN evaluaciones ed ON ed.asignacion_practica_id = a.id
              AND ed.tipo_evaluador = 'DOCENTE_SUPERVISOR' AND ed.eliminado_en IS NULL
       LEFT JOIN usuarios ued ON ued.id = ed.evaluador_id
       LEFT JOIN evaluaciones ea ON ea.asignacion_practica_id = a.id
              AND ea.tipo_evaluador = 'ASESOR_SITIO' AND ea.eliminado_en IS NULL
       LEFT JOIN usuarios uea ON uea.id = ea.evaluador_id
      WHERE m.estudiante_id = $1 AND a.eliminado_en IS NULL
      ORDER BY pe.fecha_inicio DESC, n.orden_visual`,
    [estudianteId]
  );
  return rows;
}

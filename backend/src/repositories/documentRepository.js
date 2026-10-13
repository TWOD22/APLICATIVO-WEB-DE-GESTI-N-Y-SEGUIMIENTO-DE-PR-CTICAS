/**
 * Repositorio de documentos legales: requisitos por asignación, archivos, versiones y revisión.
 * Un documento nuevo reemplaza al anterior (se conserva el historial de versiones).
 */
import { pool } from "../config/database.js";
import { escaparLike } from "../utils/pagination.js";

/** Bloquea la fila de la asignación hasta terminar la transacción (serializa cargas y revisiones). */
export async function bloquearAsignacion(id, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id, a.estado, a.nivel_practica_id, m.periodo_academico_id AS periodo_id, m.estudiante_id,
            u.firebase_uid AS estudiante_firebase_uid
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
       JOIN usuarios u ON u.id = m.estudiante_id
      WHERE a.id = $1 AND a.eliminado_en IS NULL
        FOR UPDATE OF a`,
    [id]
  );
  return rows[0] ?? null;
}

/** Requisitos del nivel de la asignación con la versión vigente de cada documento. */
export async function listarRequisitos(asignacionId, db = pool) {
  const { rows } = await db.query(
    `SELECT r.id AS requisito_id, r.obligatorio, r.orden_visual,
            t.id AS tipo_id, t.codigo, t.nombre, t.descripcion, t.tipos_mime_permitidos,
            t.tamano_maximo_bytes::bigint AS tamano_maximo_bytes,
            d.id AS documento_id, d.estado, d.numero_version, d.observacion_revision, d.enviado_en, d.revisado_en,
            ar.nombre_original AS archivo_nombre, ar.tamano_bytes::bigint AS archivo_tamano,
            (SELECT count(*)::int FROM documentos_legales_estudiantes x
              WHERE x.asignacion_practica_id = a.id AND x.tipo_documento_legal_id = t.id AND x.eliminado_en IS NULL
            ) AS total_versiones
       FROM asignaciones_practica a
       JOIN requisitos_documentales r ON r.nivel_practica_id = a.nivel_practica_id AND r.eliminado_en IS NULL
       JOIN tipos_documento_legal t ON t.id = r.tipo_documento_legal_id AND t.eliminado_en IS NULL AND t.activo
       LEFT JOIN documentos_legales_estudiantes d ON d.asignacion_practica_id = a.id
              AND d.tipo_documento_legal_id = t.id AND d.es_version_actual AND d.eliminado_en IS NULL
       LEFT JOIN archivos ar ON ar.id = d.archivo_id
      WHERE a.id = $1 AND a.eliminado_en IS NULL
      ORDER BY r.orden_visual, t.nombre`,
    [asignacionId]
  );
  return rows.map((f) => ({
    ...f,
    tamano_maximo_bytes: Number(f.tamano_maximo_bytes),
    archivo_tamano: f.archivo_tamano === null ? null : Number(f.archivo_tamano),
  }));
}

/** El tipo debe ser un requisito vigente del nivel de la asignación. */
export async function buscarRequisito(asignacionId, tipoId, db = pool) {
  const { rows } = await db.query(
    `SELECT t.id AS tipo_id, t.codigo, t.nombre, t.tipos_mime_permitidos,
            t.tamano_maximo_bytes::bigint AS tamano_maximo_bytes, r.obligatorio
       FROM asignaciones_practica a
       JOIN requisitos_documentales r ON r.nivel_practica_id = a.nivel_practica_id AND r.eliminado_en IS NULL
       JOIN tipos_documento_legal t ON t.id = r.tipo_documento_legal_id AND t.eliminado_en IS NULL AND t.activo
      WHERE a.id = $1 AND t.id = $2 AND a.eliminado_en IS NULL`,
    [asignacionId, tipoId]
  );
  return rows[0] ? { ...rows[0], tamano_maximo_bytes: Number(rows[0].tamano_maximo_bytes) } : null;
}

/** Versión vigente del documento de un tipo para una asignación. */
export async function buscarDocumentoActual(asignacionId, tipoId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, estado, numero_version FROM documentos_legales_estudiantes
      WHERE asignacion_practica_id = $1 AND tipo_documento_legal_id = $2
        AND es_version_actual AND eliminado_en IS NULL
      FOR UPDATE`,
    [asignacionId, tipoId]
  );
  return rows[0] ?? null;
}

/** Número de la última versión subida. */
export async function ultimaVersion(asignacionId, tipoId, db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(max(numero_version), 0)::int AS ultima FROM documentos_legales_estudiantes
      WHERE asignacion_practica_id = $1 AND tipo_documento_legal_id = $2`,
    [asignacionId, tipoId]
  );
  return rows[0].ultima;
}

/** Registra en PostgreSQL los metadatos del archivo (el binario vive en el almacenamiento). */
export async function crearArchivo({ id, bucket, ruta, nombreOriginal, tipoMime, tamanoBytes, hashSha256, subidoPorId }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO archivos (id, bucket, ruta_almacenamiento, nombre_original, tipo_mime, tamano_bytes, hash_sha256, subido_por_id, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DISPONIBLE') RETURNING id`,
    [id, bucket, ruta, nombreOriginal, tipoMime, tamanoBytes, hashSha256, subidoPorId]
  );
  return rows[0];
}

/** La versión anterior deja de ser la vigente; nunca se borra ni se sobrescribe. */
export async function reemplazarVersionActual(documentoId, db = pool) {
  await db.query(
    `UPDATE documentos_legales_estudiantes SET es_version_actual = false, estado = 'REEMPLAZADO'
      WHERE id = $1`,
    [documentoId]
  );
}

/** Crea la nueva versión del documento. */
export async function crearDocumento({ asignacionId, tipoId, archivoId, numeroVersion }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO documentos_legales_estudiantes
       (asignacion_practica_id, tipo_documento_legal_id, archivo_id, numero_version, es_version_actual, estado, enviado_en)
     VALUES ($1, $2, $3, $4, true, 'EN_REVISION', now()) RETURNING id`,
    [asignacionId, tipoId, archivoId, numeroVersion]
  );
  return rows[0];
}

/** Documento + contexto de la asignación + archivo (para revisar y descargar). */
export async function buscarDocumento(id, db = pool, { bloquear = false } = {}) {
  const { rows } = await db.query(
    `SELECT d.id, d.estado, d.es_version_actual, d.numero_version, d.observacion_revision,
            d.asignacion_practica_id AS asignacion_id, d.tipo_documento_legal_id AS tipo_id,
            t.nombre AS tipo_nombre, t.codigo AS tipo_codigo,
            ar.bucket, ar.ruta_almacenamiento AS ruta, ar.nombre_original AS archivo_nombre,
            a.estado AS asignacion_estado, m.estudiante_id, u.firebase_uid AS estudiante_firebase_uid
       FROM documentos_legales_estudiantes d
       JOIN tipos_documento_legal t ON t.id = d.tipo_documento_legal_id
       JOIN archivos ar ON ar.id = d.archivo_id
       JOIN asignaciones_practica a ON a.id = d.asignacion_practica_id
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
       JOIN usuarios u ON u.id = m.estudiante_id
      WHERE d.id = $1 AND d.eliminado_en IS NULL
      ${bloquear ? "FOR UPDATE OF d" : ""}`,
    [id]
  );
  return rows[0] ?? null;
}

/** Guarda la decisión de revisión (aprobado / por corregir) con observación y revisor. */
export async function registrarRevision(id, { estado, observacion, revisorId }, db = pool) {
  const pendiente = estado === "EN_REVISION";
  const { rows } = await db.query(
    `UPDATE documentos_legales_estudiantes
        SET estado = $2::estado_documento,
            observacion_revision = $3,
            revisado_por_id = $4,
            revisado_en = CASE WHEN $5 THEN NULL ELSE now() END
      WHERE id = $1 AND eliminado_en IS NULL RETURNING id`,
    [id, estado, observacion ?? null, pendiente ? null : revisorId, pendiente]
  );
  return rows[0] ?? null;
}

/** Aprueba de una vez todas las versiones vigentes que estén en revisión. */
export async function aprobarEnRevision(asignacionId, revisorId, db = pool) {
  const { rows } = await db.query(
    `UPDATE documentos_legales_estudiantes
        SET estado = 'APROBADO', observacion_revision = NULL, revisado_por_id = $2, revisado_en = now()
      WHERE asignacion_practica_id = $1 AND es_version_actual AND estado = 'EN_REVISION' AND eliminado_en IS NULL
      RETURNING id, tipo_documento_legal_id AS tipo_id`,
    [asignacionId, revisorId]
  );
  return rows;
}

// ───────────────────────── Habilitación de la bitácora ─────────────────────────

/** Cuenta los documentos obligatorios del nivel de práctica. */
export async function contarObligatorios(asignacionId, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE d.estado = 'APROBADO')::int AS aprobados
       FROM asignaciones_practica a
       JOIN requisitos_documentales r ON r.nivel_practica_id = a.nivel_practica_id
            AND r.eliminado_en IS NULL AND r.obligatorio
       JOIN tipos_documento_legal t ON t.id = r.tipo_documento_legal_id AND t.eliminado_en IS NULL AND t.activo
       LEFT JOIN documentos_legales_estudiantes d ON d.asignacion_practica_id = a.id
              AND d.tipo_documento_legal_id = t.id AND d.es_version_actual AND d.eliminado_en IS NULL
      WHERE a.id = $1`,
    [asignacionId]
  );
  return rows[0];
}

/** Cambia el estado de la asignación. */
export async function cambiarEstadoAsignacion(id, estado, db = pool) {
  await db.query(`UPDATE asignaciones_practica SET estado = $2::estado_asignacion WHERE id = $1`, [id, estado]);
}

/** Bitácora de la asignación (si existe). */
export async function buscarBitacoraDeAsignacion(asignacionId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, estado FROM bitacoras WHERE asignacion_practica_id = $1 AND eliminado_en IS NULL FOR UPDATE`,
    [asignacionId]
  );
  return rows[0] ?? null;
}

/** Cambia el estado de la bitácora (p. ej. BLOQUEADA → BORRADOR). */
export async function cambiarEstadoBitacora(id, estado, db = pool) {
  await db.query(`UPDATE bitacoras SET estado = $2::estado_bitacora WHERE id = $1`, [id, estado]);
}

/** Directores activos (destinatarios de avisos). */
export async function listarDirectores(db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id, u.firebase_uid
       FROM usuarios u
       JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.eliminado_en IS NULL
            AND ur.vigente_desde <= current_date AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= current_date)
       JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'DIRECTOR_PROGRAMA' AND r.eliminado_en IS NULL
      WHERE u.eliminado_en IS NULL AND u.estado = 'ACTIVO'`
  );
  return rows;
}

// ───────────────────────── Auditoría documental (Director) ─────────────────────────

const BASE_EXPEDIENTES = `
  SELECT a.id AS asignacion_id, a.estado AS asignacion_estado,
         pe.id AS periodo_id, pe.codigo AS periodo_codigo,
         n.id AS nivel_id, n.codigo AS nivel_codigo, n.nombre AS nivel_nombre, n.numero_semestre AS nivel_semestre,
         e.id AS estudiante_id, e.nombres AS estudiante_nombres, e.apellidos AS estudiante_apellidos,
         e.numero_documento AS estudiante_documento,
         i.id AS institucion_id, i.nombre AS institucion_nombre,
         c.total_requisitos, c.aprobados, c.en_revision, c.por_corregir, c.sin_cargar,
         c.total_obligatorios, c.aprobados_obligatorios, c.sin_cargar_obligatorios,
         CASE WHEN c.por_corregir > 0 THEN 'POR_CORREGIR'
              WHEN c.en_revision > 0 THEN 'EN_REVISION'
              WHEN c.aprobados_obligatorios < c.total_obligatorios THEN 'INCOMPLETO'
              ELSE 'COMPLETO' END AS expediente_estado
    FROM asignaciones_practica a
    JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
    JOIN periodos_academicos pe ON pe.id = m.periodo_academico_id
    JOIN usuarios e ON e.id = m.estudiante_id
    JOIN niveles_practica n ON n.id = a.nivel_practica_id
    JOIN instituciones i ON i.id = a.institucion_id
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS total_requisitos,
             count(*) FILTER (WHERE d.estado = 'APROBADO')::int AS aprobados,
             count(*) FILTER (WHERE d.estado = 'EN_REVISION')::int AS en_revision,
             count(*) FILTER (WHERE d.estado = 'POR_CORREGIR')::int AS por_corregir,
             count(*) FILTER (WHERE d.id IS NULL)::int AS sin_cargar,
             count(*) FILTER (WHERE r.obligatorio)::int AS total_obligatorios,
             count(*) FILTER (WHERE r.obligatorio AND d.estado = 'APROBADO')::int AS aprobados_obligatorios,
             count(*) FILTER (WHERE r.obligatorio AND d.id IS NULL)::int AS sin_cargar_obligatorios
        FROM requisitos_documentales r
        JOIN tipos_documento_legal t ON t.id = r.tipo_documento_legal_id AND t.eliminado_en IS NULL AND t.activo
        LEFT JOIN documentos_legales_estudiantes d ON d.asignacion_practica_id = a.id
               AND d.tipo_documento_legal_id = t.id AND d.es_version_actual AND d.eliminado_en IS NULL
       WHERE r.nivel_practica_id = a.nivel_practica_id AND r.eliminado_en IS NULL
    ) c
   WHERE a.eliminado_en IS NULL AND a.estado <> 'CANCELADA'`;

// Construye el WHERE de la auditoría documental según los filtros recibidos.
function filtrosExpedientes({ q, periodo_id, nivel }, parametros) {
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = [];
  if (periodo_id) condiciones.push(`x.periodo_id = ${p(periodo_id)}`);
  if (nivel) condiciones.push(`x.nivel_semestre = ${p(nivel)}`);
  if (q) {
    const patron = p(`%${escaparLike(q)}%`);
    condiciones.push(
      `((x.estudiante_nombres || ' ' || x.estudiante_apellidos) ILIKE ${patron}
        OR x.estudiante_documento ILIKE ${patron} OR x.institucion_nombre ILIKE ${patron})`
    );
  }
  return condiciones;
}

/** Lista expedientes (una fila por asignación) con conteos por estado de documento. */
export async function listarExpedientes({ q, periodo_id, nivel, estado, limit, offset }, db = pool) {
  const parametros = [];
  const condiciones = filtrosExpedientes({ q, periodo_id, nivel }, parametros);
  const baseConteo = [...condiciones];
  const parametrosConteo = [...parametros];
  if (estado) {
    parametros.push(estado);
    condiciones.push(`x.expediente_estado = $${parametros.length}`);
  }
  parametros.push(limit, offset);
  const donde = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const { rows } = await db.query(
    `SELECT x.*, count(*) OVER() AS total FROM (${BASE_EXPEDIENTES}) x ${donde}
      ORDER BY CASE x.expediente_estado WHEN 'EN_REVISION' THEN 1 WHEN 'POR_CORREGIR' THEN 2 WHEN 'INCOMPLETO' THEN 3 ELSE 4 END,
               x.estudiante_apellidos, x.estudiante_nombres, x.asignacion_id
      LIMIT $${parametros.length - 1} OFFSET $${parametros.length}`,
    parametros
  );
  const resumenRows = await db.query(
    `SELECT x.expediente_estado AS estado, count(*)::int AS cantidad FROM (${BASE_EXPEDIENTES}) x
      ${baseConteo.length ? `WHERE ${baseConteo.join(" AND ")}` : ""} GROUP BY x.expediente_estado`,
    parametrosConteo
  );
  const resumen = { en_revision: 0, por_corregir: 0, incompletos: 0, completos: 0 };
  for (const { estado: e, cantidad } of resumenRows.rows) {
    if (e === "EN_REVISION") resumen.en_revision = cantidad;
    if (e === "POR_CORREGIR") resumen.por_corregir = cantidad;
    if (e === "INCOMPLETO") resumen.incompletos = cantidad;
    if (e === "COMPLETO") resumen.completos = cantidad;
  }
  const total = rows.length ? Number(rows[0].total) : 0;
  return { filas: rows.map(({ total: _t, ...fila }) => fila), total, resumen };
}

/**
 * Repositorio de asignaciones de práctica.
 * Única capa que escribe SQL sobre `asignaciones_practica` y sus relaciones (matrícula, nivel, institución, docente, asesor).
 * Cada función acepta opcionalmente `db` para ejecutarse dentro de una transacción.
 */
import { pool } from "../config/database.js";
import { escaparLike } from "../utils/pagination.js";

/**
 * Alcance de datos por rol. Se aplica SIEMPRE en SQL (nunca filtrando en memoria):
 *  - DIRECTOR: todo.
 *  - DOCENTE: solo donde es docente supervisor; sin asignaciones canceladas.
 *  - ASESOR: solo donde es asesor de sitio Y tiene vinculación vigente con la institución en el periodo.
 *  - ESTUDIANTE: solo sus propias asignaciones (incluye canceladas, para su historial).
 */
export const ALCANCE = Object.freeze({
  director: () => ({ tipo: "DIRECTOR" }),
  docente: (usuarioId) => ({ tipo: "DOCENTE", usuarioId }),
  asesor: (usuarioId) => ({ tipo: "ASESOR", usuarioId }),
  estudiante: (usuarioId) => ({ tipo: "ESTUDIANTE", usuarioId }),
});

export const SELECCION = `
  a.id, a.estado, a.fecha_inicio, a.fecha_fin, a.motivo_cancelacion, a.creado_en, a.actualizado_en,
  pe.id AS periodo_id, pe.codigo AS periodo_codigo,
  n.id AS nivel_id, n.codigo AS nivel_codigo, n.nombre AS nivel_nombre, n.numero_semestre AS nivel_semestre,
  m.id AS matricula_id, m.numero_semestre AS estudiante_semestre,
  e.id AS estudiante_id, e.nombres AS estudiante_nombres, e.apellidos AS estudiante_apellidos,
  e.numero_documento AS estudiante_documento, e.correo_institucional AS estudiante_correo, e.firebase_uid AS estudiante_firebase_uid,
  i.id AS institucion_id, i.nombre AS institucion_nombre, i.ciudad AS institucion_ciudad,
  d.id AS docente_id, d.nombres AS docente_nombres, d.apellidos AS docente_apellidos, d.firebase_uid AS docente_firebase_uid,
  s.id AS asesor_id, s.nombres AS asesor_nombres, s.apellidos AS asesor_apellidos, s.firebase_uid AS asesor_firebase_uid,
  CASE WHEN a.docente_supervisor_id IS NULL THEN 'SIN_DOCENTE'
       WHEN a.asesor_sitio_id IS NULL THEN 'SIN_ASESOR'
       ELSE 'COMPLETA' END AS completitud`;

export const DESDE = `
  FROM asignaciones_practica a
  JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
  JOIN periodos_academicos pe ON pe.id = m.periodo_academico_id
  JOIN usuarios e ON e.id = m.estudiante_id
  JOIN niveles_practica n ON n.id = a.nivel_practica_id
  JOIN instituciones i ON i.id = a.institucion_id
  LEFT JOIN usuarios d ON d.id = a.docente_supervisor_id
  LEFT JOIN usuarios s ON s.id = a.asesor_sitio_id`;

// Arma el objeto de una persona (docente/asesor/estudiante) a partir de las columnas de la fila con un prefijo.
const persona = (fila, prefijo, conUid) =>
  fila[`${prefijo}_id`]
    ? {
        id: fila[`${prefijo}_id`],
        nombres: fila[`${prefijo}_nombres`],
        apellidos: fila[`${prefijo}_apellidos`],
        nombre_completo: `${fila[`${prefijo}_nombres`]} ${fila[`${prefijo}_apellidos`]}`,
        ...(conUid ? { firebase_uid: fila[`${prefijo}_firebase_uid`] } : {}),
      }
    : null;

/** Convierte la fila plana en el objeto anidado de la API (sin exponer firebase_uid). */
export function mapearAsignacion(fila, { conUid = false } = {}) {
  return {
    id: fila.id,
    estado: fila.estado,
    completitud: fila.completitud,
    fecha_inicio: fila.fecha_inicio,
    fecha_fin: fila.fecha_fin,
    motivo_cancelacion: fila.motivo_cancelacion,
    periodo: { id: fila.periodo_id, codigo: fila.periodo_codigo },
    nivel: { id: fila.nivel_id, codigo: fila.nivel_codigo, nombre: fila.nivel_nombre, semestre: fila.nivel_semestre },
    estudiante: {
      ...persona(fila, "estudiante", conUid),
      documento: fila.estudiante_documento,
      correo: fila.estudiante_correo,
      semestre: fila.estudiante_semestre,
    },
    institucion: { id: fila.institucion_id, nombre: fila.institucion_nombre, ciudad: fila.institucion_ciudad },
    docente: persona(fila, "docente", conUid),
    asesor: persona(fila, "asesor", conUid),
    creado_en: fila.creado_en,
    actualizado_en: fila.actualizado_en,
  };
}

/** Traduce el alcance del usuario (DIRECTOR, DOCENTE, ASESOR, ESTUDIANTE) en condiciones SQL: cada rol solo ve lo suyo. */
export function condicionesDeAlcance(alcance, p) {
  switch (alcance.tipo) {
    case "DIRECTOR":
      return [];
    case "DOCENTE":
      return [`a.docente_supervisor_id = ${p(alcance.usuarioId)}`, `a.estado <> 'CANCELADA'`];
    case "ASESOR":
      return [
        `a.asesor_sitio_id = ${p(alcance.usuarioId)}`,
        `a.estado <> 'CANCELADA'`,
        `EXISTS (SELECT 1 FROM vinculaciones_asesores v
                  WHERE v.asesor_id = a.asesor_sitio_id AND v.institucion_id = a.institucion_id
                    AND v.periodo_academico_id = m.periodo_academico_id
                    AND v.activa AND v.eliminado_en IS NULL
                    AND v.vigente_desde <= current_date
                    AND (v.vigente_hasta IS NULL OR v.vigente_hasta >= current_date))`,
      ];
    case "ESTUDIANTE":
      return [`m.estudiante_id = ${p(alcance.usuarioId)}`];
    default:
      // Un alcance desconocido nunca debe ampliar el acceso.
      return ["false"];
  }
}

/** Busca una asignación por id respetando el alcance del usuario. */
export async function buscarPorId(id, alcance = ALCANCE.director(), db = pool) {
  const parametros = [id];
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = ["a.id = $1", "a.eliminado_en IS NULL", ...condicionesDeAlcance(alcance, p)];
  const { rows } = await db.query(`SELECT ${SELECCION} ${DESDE} WHERE ${condiciones.join(" AND ")}`, parametros);
  return rows[0] ?? null;
}

/** Lista asignaciones con filtros, paginación y alcance por rol. */
export async function listar(
  { q, periodo_id, nivel, estado, completitud, institucion_id, docente_id, asesor_id, limit, offset },
  alcance = ALCANCE.director(),
  db = pool
) {
  const parametros = [];
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = ["a.eliminado_en IS NULL", ...condicionesDeAlcance(alcance, p)];
  if (periodo_id) condiciones.push(`m.periodo_academico_id = ${p(periodo_id)}`);
  if (nivel) condiciones.push(`n.numero_semestre = ${p(nivel)}`);
  if (estado) condiciones.push(`a.estado = ${p(estado)}::estado_asignacion`);
  if (institucion_id) condiciones.push(`a.institucion_id = ${p(institucion_id)}`);
  if (docente_id) condiciones.push(`a.docente_supervisor_id = ${p(docente_id)}`);
  if (asesor_id) condiciones.push(`a.asesor_sitio_id = ${p(asesor_id)}`);
  if (completitud === "SIN_DOCENTE") condiciones.push("a.docente_supervisor_id IS NULL");
  if (completitud === "SIN_ASESOR") condiciones.push("a.docente_supervisor_id IS NOT NULL AND a.asesor_sitio_id IS NULL");
  if (completitud === "COMPLETA") condiciones.push("a.docente_supervisor_id IS NOT NULL AND a.asesor_sitio_id IS NOT NULL");
  if (q) {
    const patron = p(`%${escaparLike(q)}%`);
    condiciones.push(
      `((e.nombres || ' ' || e.apellidos) ILIKE ${patron} OR e.numero_documento ILIKE ${patron} OR i.nombre ILIKE ${patron})`
    );
  }
  const limite = p(limit);
  const desplazamiento = p(offset);
  const { rows } = await db.query(
    `SELECT ${SELECCION}, count(*) OVER() AS total ${DESDE}
      WHERE ${condiciones.join(" AND ")}
      ORDER BY e.apellidos, e.nombres, a.id
      LIMIT ${limite} OFFSET ${desplazamiento}`,
    parametros
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { filas: rows.map(({ total: _t, ...fila }) => mapearAsignacion(fila)), total };
}

/** Estudiantes con matrícula activa en el periodo y sin práctica vigente (para "Nueva asignación"). */
export async function listarEstudiantesSinAsignacion({ periodoId, q, limit, offset }, db = pool) {
  const parametros = [periodoId];
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = [
    "m.periodo_academico_id = $1", "m.eliminado_en IS NULL", "m.estado_academico = 'ACTIVA'",
    "e.eliminado_en IS NULL", "e.estado = 'ACTIVO'",
    `NOT EXISTS (SELECT 1 FROM asignaciones_practica a
                  WHERE a.matricula_estudiante_id = m.id AND a.eliminado_en IS NULL AND a.estado <> 'CANCELADA')`,
  ];
  if (q) {
    const patron = p(`%${escaparLike(q)}%`);
    condiciones.push(`((e.nombres || ' ' || e.apellidos) ILIKE ${patron} OR e.numero_documento ILIKE ${patron})`);
  }
  const limite = p(limit);
  const desplazamiento = p(offset);
  const { rows } = await db.query(
    `SELECT e.id AS estudiante_id, e.nombres, e.apellidos, e.numero_documento AS documento,
            e.correo_institucional AS correo, m.id AS matricula_id, m.numero_semestre AS semestre,
            n.id AS nivel_sugerido_id, n.codigo AS nivel_sugerido_codigo, count(*) OVER() AS total
       FROM matriculas_estudiantes m
       JOIN usuarios e ON e.id = m.estudiante_id
       LEFT JOIN niveles_practica n ON n.programa_academico_id = m.programa_academico_id
                                   AND n.numero_semestre = m.numero_semestre AND n.eliminado_en IS NULL
      WHERE ${condiciones.join(" AND ")}
      ORDER BY e.apellidos, e.nombres
      LIMIT ${limite} OFFSET ${desplazamiento}`,
    parametros
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { filas: rows.map(({ total: _t, ...fila }) => fila), total };
}

/** Matrícula del estudiante en un periodo. */
export async function buscarMatricula(estudianteId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT m.id, m.numero_semestre AS semestre, m.estado_academico AS estado, m.programa_academico_id AS programa_id
       FROM matriculas_estudiantes m
      WHERE m.estudiante_id = $1 AND m.periodo_academico_id = $2 AND m.eliminado_en IS NULL`,
    [estudianteId, periodoId]
  );
  return rows[0] ?? null;
}

/** Nivel de práctica por id. */
export async function buscarNivel(id, db = pool) {
  const { rows } = await db.query(
    `SELECT id, programa_academico_id AS programa_id, codigo, nombre, numero_semestre AS semestre, activo
       FROM niveles_practica WHERE id = $1 AND eliminado_en IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

/** Institución por id. */
export async function buscarInstitucion(id, db = pool) {
  const { rows } = await db.query(
    `SELECT id, nombre, activa, estado_convenio FROM instituciones WHERE id = $1 AND eliminado_en IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

/** Usuario con sus roles vigentes (para validar docente y asesor con mensajes claros). */
export async function buscarPersonaConRoles(id, db = pool) {
  const { rows } = await db.query(
    `SELECT u.id, u.estado, u.firebase_uid, u.nombres, u.apellidos,
            COALESCE(array_agg(r.codigo) FILTER (WHERE r.codigo IS NOT NULL), '{}') AS roles
       FROM usuarios u
       LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.eliminado_en IS NULL
            AND ur.vigente_desde <= current_date AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= current_date)
       LEFT JOIN roles r ON r.id = ur.rol_id AND r.eliminado_en IS NULL
      WHERE u.id = $1 AND u.eliminado_en IS NULL
      GROUP BY u.id`,
    [id]
  );
  return rows[0] ?? null;
}

/** ¿El asesor tiene vinculación vigente con la institución en ese periodo? */
export async function tieneVinculacionVigente({ asesorId, institucionId, periodoId }, db = pool) {
  const { rows } = await db.query(
    `SELECT 1 FROM vinculaciones_asesores v
      WHERE v.asesor_id = $1 AND v.institucion_id = $2 AND v.periodo_academico_id = $3
        AND v.activa AND v.eliminado_en IS NULL AND v.vigente_desde <= current_date
        AND (v.vigente_hasta IS NULL OR v.vigente_hasta >= current_date)`,
    [asesorId, institucionId, periodoId]
  );
  return rows.length > 0;
}

/** ¿La matrícula ya tiene una asignación vigente (no cancelada ni finalizada)? */
export async function existeAsignacionVigente(matriculaId, db = pool) {
  const { rows } = await db.query(
    `SELECT 1 FROM asignaciones_practica
      WHERE matricula_estudiante_id = $1 AND eliminado_en IS NULL AND estado <> 'CANCELADA'`,
    [matriculaId]
  );
  return rows.length > 0;
}

/** Evaluaciones ya publicadas de la asignación: el evaluador no puede reemplazarse después. */
export async function tiposEvaluacionPublicada(asignacionId, db = pool) {
  const { rows } = await db.query(
    `SELECT tipo_evaluador FROM evaluaciones
      WHERE asignacion_practica_id = $1 AND estado = 'PUBLICADA' AND eliminado_en IS NULL`,
    [asignacionId]
  );
  return rows.map((fila) => fila.tipo_evaluador);
}

/** Inserta la asignación. */
export async function crear(datos, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO asignaciones_practica
       (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asesor_sitio_id,
        fecha_inicio, fecha_fin, asignada_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      datos.matriculaId, datos.nivelId, datos.institucionId, datos.docenteId ?? null, datos.asesorId ?? null,
      datos.fecha_inicio ?? null, datos.fecha_fin ?? null, datos.asignadaPorId,
    ]
  );
  return rows[0];
}

const COLUMNAS_ACTUALIZABLES = {
  institucion_id: "institucion_id",
  docente_supervisor_id: "docente_supervisor_id",
  asesor_sitio_id: "asesor_sitio_id",
  fecha_inicio: "fecha_inicio",
  fecha_fin: "fecha_fin",
};

/** Actualiza campos de la asignación. */
export async function actualizar(id, cambios, db = pool) {
  const claves = Object.keys(cambios).filter((clave) => clave in COLUMNAS_ACTUALIZABLES);
  if (!claves.length) return { id };
  const asignaciones = claves.map((clave, indice) => `${COLUMNAS_ACTUALIZABLES[clave]} = $${indice + 2}`);
  const { rows } = await db.query(
    `UPDATE asignaciones_practica SET ${asignaciones.join(", ")}
      WHERE id = $1 AND eliminado_en IS NULL RETURNING id`,
    [id, ...claves.map((clave) => cambios[clave])]
  );
  return rows[0] ?? null;
}

/** Cancela la asignación guardando el motivo. */
export async function cancelar(id, motivo, db = pool) {
  const { rows } = await db.query(
    `UPDATE asignaciones_practica SET estado = 'CANCELADA', motivo_cancelacion = $2
      WHERE id = $1 AND eliminado_en IS NULL AND estado <> 'CANCELADA' RETURNING id`,
    [id, motivo]
  );
  return rows[0] ?? null;
}

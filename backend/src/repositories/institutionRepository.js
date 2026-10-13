/**
 * Repositorio de instituciones y de la vinculación de asesores de sitio por periodo.
 */
import { pool } from "../config/database.js";
import { escaparLike } from "../utils/pagination.js";
import { ESTADOS_ASIGNACION_EN_CURSO } from "../utils/constants.js";

const COLUMNAS = `i.id, i.nombre, i.nit, i.ciudad, i.direccion, i.correo, i.telefono,
  i.estado_convenio, i.fecha_inicio_convenio AS convenio_inicio, i.fecha_fin_convenio AS convenio_fin, i.activa, i.creado_en, i.actualizado_en`;

// Nombre en la API -> columna en PostgreSQL (el contrato de la API no cambia).
const COLUMNAS_ACTUALIZABLES = {
  nombre: "nombre", nit: "nit", ciudad: "ciudad", direccion: "direccion", correo: "correo",
  telefono: "telefono", estado_convenio: "estado_convenio",
  convenio_inicio: "fecha_inicio_convenio", convenio_fin: "fecha_fin_convenio",
};

/** Institución por id. */
export async function buscarPorId(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS},
            (SELECT count(*)::int FROM asignaciones_practica a
              WHERE a.institucion_id = i.id AND a.eliminado_en IS NULL
                AND a.estado = ANY($2::estado_asignacion[])) AS practicas_activas
       FROM instituciones i
      WHERE i.id = $1 AND i.eliminado_en IS NULL`,
    [id, ESTADOS_ASIGNACION_EN_CURSO]
  );
  return rows[0] ?? null;
}

/** ¿Existe otra institución con el mismo NIT? */
export async function existeNit(nit, excluirId = null, db = pool) {
  const { rows } = await db.query(
    `SELECT 1 FROM instituciones WHERE nit = $1 AND eliminado_en IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
    [nit, excluirId]
  );
  return rows.length > 0;
}

/** Inserta institución. */
export async function crear(datos, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO instituciones
       (nombre, nit, ciudad, direccion, correo, telefono, estado_convenio, fecha_inicio_convenio, fecha_fin_convenio)
     VALUES ($1, $2, $3, $4, $5, $6, $7::estado_convenio, $8, $9)
     RETURNING id`,
    [
      datos.nombre, datos.nit, datos.ciudad, datos.direccion ?? null, datos.correo,
      datos.telefono ?? null, datos.estado_convenio ?? "EN_TRAMITE",
      datos.convenio_inicio ?? null, datos.convenio_fin ?? null,
    ]
  );
  return rows[0];
}

/** Actualiza campos. */
export async function actualizar(id, cambios, db = pool) {
  const claves = Object.keys(cambios).filter((clave) => clave in COLUMNAS_ACTUALIZABLES);
  if (!claves.length) return { id };
  const asignaciones = claves.map((clave, indice) => {
    const columna = COLUMNAS_ACTUALIZABLES[clave];
    return columna === "estado_convenio" ? `${columna} = $${indice + 2}::estado_convenio` : `${columna} = $${indice + 2}`;
  });
  const { rows } = await db.query(
    `UPDATE instituciones SET ${asignaciones.join(", ")}
      WHERE id = $1 AND eliminado_en IS NULL RETURNING id`,
    [id, ...claves.map((clave) => cambios[clave])]
  );
  return rows[0] ?? null;
}

/** Activa o desactiva la institución. */
export async function cambiarActiva(id, activa, db = pool) {
  const { rows } = await db.query(
    `UPDATE instituciones SET activa = $2 WHERE id = $1 AND eliminado_en IS NULL RETURNING id`,
    [id, activa]
  );
  return rows[0] ?? null;
}

/** Lista con filtros y paginación. */
export async function listar({ q, estado_convenio, activa, limit, offset }, db = pool) {
  const parametros = [];
  const p = (valor) => {
    parametros.push(valor);
    return `$${parametros.length}`;
  };
  const condiciones = ["i.eliminado_en IS NULL"];

  if (q) {
    const patron = p(`%${escaparLike(q)}%`);
    condiciones.push(
      `(i.nombre ILIKE ${patron} OR i.nit ILIKE ${patron} OR i.ciudad ILIKE ${patron}
        OR EXISTS (SELECT 1 FROM vinculaciones_asesores v
                     JOIN usuarios u ON u.id = v.asesor_id AND u.eliminado_en IS NULL
                    WHERE v.institucion_id = i.id AND v.eliminado_en IS NULL
                      AND (u.nombres || ' ' || u.apellidos) ILIKE ${patron}))`
    );
  }
  if (estado_convenio) condiciones.push(`i.estado_convenio = ${p(estado_convenio)}::estado_convenio`);
  if (typeof activa === "boolean") condiciones.push(`i.activa = ${p(activa)}`);

  const enCurso = p(ESTADOS_ASIGNACION_EN_CURSO);
  const limite = p(limit);
  const desplazamiento = p(offset);

  const { rows } = await db.query(
    `SELECT ${COLUMNAS},
            (SELECT count(DISTINCT v.asesor_id)::int FROM vinculaciones_asesores v
              WHERE v.institucion_id = i.id AND v.eliminado_en IS NULL) AS asesores_vinculados,
            (SELECT count(*)::int FROM asignaciones_practica a
              WHERE a.institucion_id = i.id AND a.eliminado_en IS NULL
                AND a.estado = ANY(${enCurso}::estado_asignacion[])) AS practicas_activas,
            count(*) OVER() AS total
       FROM instituciones i
      WHERE ${condiciones.join(" AND ")}
      ORDER BY i.nombre, i.id
      LIMIT ${limite} OFFSET ${desplazamiento}`,
    parametros
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { filas: rows.map(({ total: _total, ...fila }) => fila), total };
}

/** Estudiantes con práctica en la institución. */
export async function listarEstudiantes(institucionId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id AS asignacion_id, u.id AS estudiante_id,
            u.nombres, u.apellidos, u.numero_documento AS documento, u.correo_institucional AS correo,
            m.numero_semestre AS semestre, pe.codigo AS periodo_codigo,
            n.codigo AS nivel_codigo, n.nombre AS nivel_nombre,
            a.estado AS estado_asignacion
       FROM asignaciones_practica a
       JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
       JOIN usuarios u ON u.id = m.estudiante_id
       JOIN periodos_academicos pe ON pe.id = m.periodo_academico_id
       JOIN niveles_practica n ON n.id = a.nivel_practica_id
      WHERE a.institucion_id = $1 AND a.eliminado_en IS NULL AND a.estado <> 'CANCELADA'
        AND ($2::uuid IS NULL OR m.periodo_academico_id = $2)
      ORDER BY u.apellidos, u.nombres`,
    [institucionId, periodoId ?? null]
  );
  return rows;
}

/** Asesores vinculados. */
export async function listarAsesores(institucionId, periodoId, db = pool) {
  const { rows } = await db.query(
    `SELECT v.id AS vinculacion_id, u.id AS asesor_id, u.nombres, u.apellidos, u.correo_institucional AS correo, u.estado, v.cargo, v.activa,
            pe.codigo AS periodo_codigo, v.vigente_desde, v.vigente_hasta,
            (SELECT count(*)::int FROM asignaciones_practica a
               JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
              WHERE a.asesor_sitio_id = u.id AND a.institucion_id = v.institucion_id
                AND m.periodo_academico_id = v.periodo_academico_id AND a.eliminado_en IS NULL
                AND a.estado <> 'CANCELADA') AS estudiantes_asignados
       FROM vinculaciones_asesores v
       JOIN usuarios u ON u.id = v.asesor_id AND u.eliminado_en IS NULL
       JOIN periodos_academicos pe ON pe.id = v.periodo_academico_id
      WHERE v.institucion_id = $1 AND v.eliminado_en IS NULL
        AND ($2::uuid IS NULL OR v.periodo_academico_id = $2)
      ORDER BY u.apellidos, u.nombres`,
    [institucionId, periodoId ?? null]
  );
  return rows;
}

/** Vincula un asesor con la institución en un periodo. */
export async function crearVinculacionAsesor({ asesorId, institucionId, periodoId }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO vinculaciones_asesores (asesor_id, institucion_id, periodo_academico_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [asesorId, institucionId, periodoId]
  );
  return rows[0];
}

/** Vinculaciones del asesor. */
export async function listarVinculacionesDeAsesor(asesorId, db = pool) {
  const { rows } = await db.query(
    `SELECT v.id, i.id AS institucion_id, i.nombre AS institucion_nombre, i.ciudad,
            pe.codigo AS periodo_codigo, v.vigente_desde, v.vigente_hasta
       FROM vinculaciones_asesores v
       JOIN instituciones i ON i.id = v.institucion_id AND i.eliminado_en IS NULL
       JOIN periodos_academicos pe ON pe.id = v.periodo_academico_id
      WHERE v.asesor_id = $1 AND v.eliminado_en IS NULL
      ORDER BY pe.fecha_inicio DESC`,
    [asesorId]
  );
  return rows;
}

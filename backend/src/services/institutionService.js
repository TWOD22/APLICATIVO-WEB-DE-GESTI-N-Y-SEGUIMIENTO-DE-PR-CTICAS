/**
 * Servicio de instituciones receptoras de práctica.
 * Reglas: NIT único, fechas de convenio coherentes y confirmación antes de deshabilitar una institución con prácticas en curso.
 * Cada cambio se registra en la auditoría con el valor anterior y el nuevo.
 */
import { withTransaction } from "../database/transaction.js";
import * as institutionRepository from "../repositories/institutionRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { ApiError } from "../utils/apiError.js";
import { calcularCambios } from "../utils/diff.js";

// Campos que el Director puede editar.
const CAMPOS_EDITABLES = [
  "nombre", "nit", "ciudad", "direccion", "correo", "telefono",
  "estado_convenio", "convenio_inicio", "convenio_fin",
];

// Busca la institución o responde 404.
async function obtenerODetener(id) {
  const institucion = await institutionRepository.buscarPorId(id);
  if (!institucion) throw ApiError.noEncontrado("La institución no existe.", "INSTITUTION_NOT_FOUND");
  return institucion;
}

// La fecha final del convenio no puede ser anterior a la inicial.
function validarFechasConvenio(inicio, fin) {
  if (inicio && fin && fin < inicio) {
    throw ApiError.reglaDeNegocio("La fecha final del convenio no puede ser anterior a la inicial.", "INVALID_AGREEMENT_DATES");
  }
}

// El NIT no puede repetirse (se ignora la misma institución al editar).
async function lanzarSiNitDuplicado(nit, excluirId = null) {
  if (await institutionRepository.existeNit(nit, excluirId)) {
    throw ApiError.conflicto("Ya existe una institución con ese NIT.", "DUPLICATE_INSTITUTION", [
      { campo: "nit", mensaje: "Valor ya registrado" },
    ]);
  }
}

/** Lista instituciones con filtros y paginación. */
export const listar = (filtros) => institutionRepository.listar(filtros);
/** Detalle de una institución (404 si no existe). */
export const obtener = obtenerODetener;

/** Registra una institución nueva. */
export async function crear(datos, contexto) {
  validarFechasConvenio(datos.convenio_inicio, datos.convenio_fin);
  await lanzarSiNitDuplicado(datos.nit);
  const { id } = await withTransaction((client) => institutionRepository.crear(datos, client));
  await registrarAuditoria({
    contexto,
    accion: "INSTITUCION_CREADA",
    entidad: "instituciones",
    entidad_id: id,
    valor_nuevo: { nombre: datos.nombre, nit: datos.nit, estado_convenio: datos.estado_convenio ?? "EN_TRAMITE" },
  });
  return obtenerODetener(id);
}

/** Edita solo lo que cambió y guarda el antes/después en la auditoría. */
export async function actualizar(id, cambios, contexto) {
  const actual = await obtenerODetener(id);
  const diff = calcularCambios(actual, cambios, CAMPOS_EDITABLES);
  if (!diff.hayCambios) return actual;

  validarFechasConvenio(
    diff.nuevo.convenio_inicio !== undefined ? diff.nuevo.convenio_inicio : actual.convenio_inicio,
    diff.nuevo.convenio_fin !== undefined ? diff.nuevo.convenio_fin : actual.convenio_fin
  );
  if (diff.nuevo.nit) await lanzarSiNitDuplicado(diff.nuevo.nit, id);

  await withTransaction((client) => institutionRepository.actualizar(id, diff.nuevo, client));
  await registrarAuditoria({
    contexto,
    accion: "INSTITUCION_ACTUALIZADA",
    entidad: "instituciones",
    entidad_id: id,
    valor_anterior: diff.anterior,
    valor_nuevo: diff.nuevo,
  });
  return obtenerODetener(id);
}

/** Habilita o deshabilita una institución; si tiene prácticas en curso exige confirmación. */
export async function cambiarEstado(id, { activa, confirmar = false }, contexto) {
  const actual = await obtenerODetener(id);
  if (actual.activa === activa) return actual;

  if (!activa && !confirmar && actual.practicas_activas > 0) {
    throw ApiError.conflicto(
      "La institución tiene prácticas en curso. Confirma para deshabilitarla.",
      "CONFIRMATION_REQUIRED",
      [{ practicas_activas: actual.practicas_activas }]
    );
  }
  await withTransaction((client) => institutionRepository.cambiarActiva(id, activa, client));
  await registrarAuditoria({
    contexto,
    accion: activa ? "INSTITUCION_HABILITADA" : "INSTITUCION_DESHABILITADA",
    entidad: "instituciones",
    entidad_id: id,
    valor_anterior: { activa: actual.activa },
    valor_nuevo: { activa },
  });
  return obtenerODetener(id);
}

/** Si no se indica periodo se usa el periodo activo (puede ser null: entonces se listan todos). */
async function resolverPeriodo(periodoId) {
  if (periodoId) {
    const periodo = await periodRepository.buscarPorId(periodoId);
    if (!periodo) throw ApiError.reglaDeNegocio("El periodo académico indicado no existe.", "PERIOD_NOT_FOUND");
    return periodo.id;
  }
  const activo = await periodRepository.buscarActivo();
  return activo?.id ?? null;
}

/** Estudiantes con práctica en la institución. */
export async function listarEstudiantes(id, periodoId) {
  await obtenerODetener(id);
  return institutionRepository.listarEstudiantes(id, await resolverPeriodo(periodoId));
}

/** Asesores de sitio vinculados a la institución. */
export async function listarAsesores(id, periodoId) {
  await obtenerODetener(id);
  return institutionRepository.listarAsesores(id, await resolverPeriodo(periodoId));
}

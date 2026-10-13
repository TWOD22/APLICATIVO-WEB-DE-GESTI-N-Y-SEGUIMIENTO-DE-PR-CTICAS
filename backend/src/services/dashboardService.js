/**
 * Servicio del dashboard.
 * Arma los indicadores y la tabla de seguimiento de prácticas según el rol activo:
 * el Director ve todo, el Docente y el Asesor solo lo suyo, y el Estudiante su propia práctica.
 */
import * as assignmentRepository from "../repositories/assignmentRepository.js";
import * as dashboardRepository from "../repositories/dashboardRepository.js";
import * as documentRepository from "../repositories/documentRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";
import { ApiError } from "../utils/apiError.js";
import { ROLES } from "../utils/constants.js";
import { alcancePorRol } from "./logbookService.js";

const { mapearAsignacion } = assignmentRepository;

// Tipo de evaluación que corresponde a cada rol evaluador.
const TIPO_POR_ROL = Object.freeze({
  [ROLES.DOCENTE_SUPERVISOR]: "DOCENTE_SUPERVISOR",
  [ROLES.ASESOR_SITIO]: "ASESOR_SITIO",
});
// Estados de bitácora en los que ya fue enviada por el estudiante.
const BITACORA_ENVIADA = ["ENVIADA", "EN_EVALUACION", "EVALUADA"];

/** El periodo pedido (404 si no existe) o el activo; sin ninguno de los dos no se filtra por periodo. */
async function resolverPeriodo(periodoId) {
  if (periodoId) {
    const periodo = await periodRepository.buscarPorId(periodoId);
    if (!periodo) throw ApiError.noEncontrado("El periodo académico no existe.", "PERIOD_NOT_FOUND");
    return periodo;
  }
  return (await periodRepository.buscarActivo()) ?? null;
}

// Reduce un periodo a los campos que necesita el frontend.
const armarPeriodo = (p) => (p ? { id: p.id, codigo: p.codigo, nombre: p.nombre, estado: p.estado } : null);

/**
 * Qué muestra una evaluación en la tabla. La nota solo aparece publicada (el borrador es de su autor y se consulta en
 * /evaluations). El estudiante nunca ve estados internos: lo no publicado es "PENDIENTE".
 */
function armarEvaluacion(estado, nota, publicadaEn, rol) {
  if (!estado) return null;
  const publicada = estado === "PUBLICADA";
  return {
    estado: rol === ROLES.ESTUDIANTE && !publicada ? "PENDIENTE" : estado,
    nota: publicada ? nota : null,
    publicada_en: publicada ? publicadaEn : null,
  };
}

/** Fila de la tabla de seguimiento, ajustada a lo que el rol puede ver (guía §11 y matriz de permisos). */
export function armarFilaPractica(fila, rol) {
    // Docente y Asesor: ven su propia evaluación y un estado simple de la bitácora.
  const evaluador = rol in TIPO_POR_ROL;
  const docente = armarEvaluacion(fila.docente_eval_estado, fila.docente_eval_nota, fila.docente_eval_publicada_en, rol);
  const asesor = armarEvaluacion(fila.asesor_eval_estado, fila.asesor_eval_nota, fila.asesor_eval_publicada_en, rol);

  const resultado = { ...mapearAsignacion(fila) };
  const enviada = BITACORA_ENVIADA.includes(fila.bitacora_estado);

  if (evaluador) {
    // Docente y asesor: sin expediente legal, solo su propia evaluación y un estado simple de la bitácora.
    const propia = TIPO_POR_ROL[rol] === "DOCENTE_SUPERVISOR" ? docente : asesor;
    resultado.bitacora = { id: enviada ? fila.bitacora_id : null, estado: enviada ? fila.bitacora_estado : "EN_DESARROLLO", enviada_en: enviada ? fila.enviada_en : null };
    resultado.mi_evaluacion = propia ?? { estado: "SIN_ENTREGA", nota: null, publicada_en: null };
    return resultado;
  }

    // Director y Estudiante: ven bitácora, estado del expediente legal y evaluaciones.
  resultado.bitacora = fila.bitacora_id ? { id: fila.bitacora_id, estado: fila.bitacora_estado, enviada_en: fila.enviada_en } : null;
  resultado.documentos = { estado: fila.expediente_estado, aprobados: fila.aprobados_obligatorios, total: fila.total_obligatorios };
  resultado.evaluaciones = { docente, asesor };
    // Estado global: SIN_ENTREGA, PENDIENTE, PARCIAL (una evaluación publicada) o COMPLETA (ambas).
  const publicadas = [docente, asesor].filter((e) => e?.estado === "PUBLICADA").length;
  resultado.evaluacion_global = !docente && !asesor ? "SIN_ENTREGA" : publicadas === 2 ? "COMPLETA" : publicadas === 1 ? "PARCIAL" : "PENDIENTE";
  return resultado;
}

/** Tabla de seguimiento: filas filtradas por el alcance del rol y paginadas. */
export async function listarPracticas(filtros, auth) {
  const { page_size: _p, page: _pg, todos_los_periodos: todos, ...criterios } = filtros;
  const periodo = todos && !filtros.periodo_id ? null : await resolverPeriodo(filtros.periodo_id);
  const { filas, total } = await dashboardRepository.listarPracticas(
    { ...criterios, periodo_id: periodo?.id },
    alcancePorRol(auth),
    { limit: filtros.limit, offset: filtros.offset }
  );
  return { filas: filas.map((f) => armarFilaPractica(f, auth.rolActivo)), total, periodo: armarPeriodo(periodo) };
}

/** Indicadores y alertas del rol activo para el periodo (activo si no se indica otro). */
export async function resumen({ periodo_id }, auth) {
  const periodo = await resolverPeriodo(periodo_id);
  const periodoId = periodo?.id ?? null;
  const base = { rol: auth.rolActivo, periodo: armarPeriodo(periodo) };

    // Director: contadores de prácticas, evaluaciones, instituciones y expedientes, más alertas.
  if (auth.rolActivo === ROLES.DIRECTOR_PROGRAMA) {
    const [practicas, evaluaciones, instituciones, { resumen: expedientes }] = await Promise.all([
      dashboardRepository.contarPracticas({ periodoId }),
      dashboardRepository.contarEvaluaciones({ periodoId }),
      dashboardRepository.contarInstituciones(),
      documentRepository.listarExpedientes({ periodo_id: periodoId ?? undefined, limit: 1, offset: 0 }),
    ]);
    return {
      ...base,
      indicadores: {
        practicas_activas: practicas.activas,
        practicas_finalizadas: practicas.finalizadas,
        expedientes_completos: expedientes.completos,
        evaluaciones_pendientes: evaluaciones.sin_publicar,
        evaluaciones_publicadas: evaluaciones.publicadas,
        instituciones_activas: instituciones.activas,
      },
      alertas: {
        expedientes_por_auditar: expedientes.en_revision,
        expedientes_por_corregir: expedientes.por_corregir,
        practicas_sin_docente: practicas.sin_docente,
        practicas_sin_asesor: practicas.sin_asesor,
        convenios_en_tramite: instituciones.convenios_en_tramite,
      },
    };
  }

    // Docente y Asesor: contadores de sus estudiantes y evaluaciones.
  const tipo = TIPO_POR_ROL[auth.rolActivo];
  if (tipo) {
    const c = await dashboardRepository.contarDeEvaluador({ periodoId, tipo }, alcancePorRol(auth));
    return {
      ...base,
      indicadores: {
        estudiantes: c.estudiantes,
        en_desarrollo: c.en_desarrollo,
        pendientes: c.pendientes,
        en_borrador: c.en_borrador,
        evaluados: c.publicadas,
      },
    };
  }

    // Estudiante: su práctica del periodo (o null si no tiene una).
  // Estudiante: su práctica del periodo (o null si no tiene una).
  const { filas } = await dashboardRepository.listarPracticas({ periodo_id: periodoId ?? undefined }, alcancePorRol(auth), { limit: 1, offset: 0 });
  return { ...base, practica: filas[0] ? armarFilaPractica(filas[0], auth.rolActivo) : null };
}

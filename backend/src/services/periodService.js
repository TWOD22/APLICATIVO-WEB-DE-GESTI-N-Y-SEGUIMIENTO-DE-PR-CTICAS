/**
 * Servicio de catálogos académicos (programas, periodos y niveles) y del ciclo de vida de los periodos.
 *
 * Ciclo: PLANIFICADO → ACTIVO → CERRADO. Solo hay un periodo activo a la vez.
 *  - Activar un periodo, si hay uno cerrado antes, prepara el nuevo: matrícula a los estudiantes que continúan
 *    (con paso de semestre), y copia los docentes de nivel y las guías de criterios del periodo anterior.
 *  - Cerrar exige que no haya prácticas en marcha; las solicitudes que siguen abiertas se cancelan (con confirmación).
 */
import { withTransaction } from "../database/transaction.js";
import * as programRepository from "../repositories/programRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";
import * as criteriaGuideRepository from "../repositories/criteriaGuideRepository.js";
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { ApiError } from "../utils/apiError.js";

export const listarProgramas = () => programRepository.listar();
export const listarPeriodos = () => periodRepository.listar();
export const listarNivelesPractica = (programaId) => programRepository.listarNivelesPractica({ programaId });

const MOTIVO_CIERRE = "El periodo académico se cerró antes de que la solicitud avanzara.";

async function cargar(id) {
  const periodo = await periodRepository.buscarPorId(id);
  if (!periodo) throw ApiError.noEncontrado("El periodo no existe.", "PERIOD_NOT_FOUND");
  return periodo;
}

/** Crea un periodo planificado. */
export async function crear({ codigo, nombre, fecha_inicio, fecha_fin }, contexto) {
  if (fecha_fin < fecha_inicio) {
    throw ApiError.reglaDeNegocio("La fecha de fin no puede ser anterior a la de inicio.", "PERIOD_DATES_INVALID");
  }
  if (await periodRepository.existeCodigo(codigo)) {
    throw ApiError.conflicto(`Ya existe un periodo con el código ${codigo}.`, "PERIOD_CODE_EXISTS");
  }
  const periodo = await periodRepository.crear({ codigo, nombre, fecha_inicio, fecha_fin });
  await registrarAuditoria({
    contexto, accion: "PERIODO_CREADO", entidad: "periodos_academicos", entidad_id: periodo.id, valor_nuevo: { codigo, nombre },
  });
  return periodo;
}

/**
 * Activa un periodo planificado. Si hay un periodo cerrado antes, prepara el nuevo a partir de él
 * (opciones, todas activas por defecto): matrículas con paso de semestre, docentes de nivel y guías de criterios.
 */
export async function activar(id, opciones = {}, contexto) {
  const periodo = await cargar(id);
  if (periodo.estado !== "PLANIFICADO") {
    throw ApiError.reglaDeNegocio(
      periodo.estado === "ACTIVO" ? "El periodo ya está activo." : "Un periodo cerrado no puede volver a activarse.",
      "PERIOD_STATE_INVALID"
    );
  }
  const activo = await periodRepository.buscarActivo();
  if (activo) {
    throw ApiError.reglaDeNegocio(
      `El periodo ${activo.codigo} sigue activo. Ciérralo antes de activar uno nuevo.`,
      "PERIOD_ACTIVE_EXISTS",
      [{ periodo_activo: activo.codigo }]
    );
  }
  const { arrastrar_matriculas = true, copiar_docentes = true, copiar_guias = true } = opciones;
  const anterior = await periodRepository.buscarUltimoCerrado();
  const resumen = { periodo_anterior: anterior?.codigo ?? null, matriculados: 0, egresados: 0, docentes_copiados: 0, guias_copiadas: 0 };

  await withTransaction(async (client) => {
    await periodRepository.cambiarEstado(periodo.id, "ACTIVO", client);
    if (!anterior) return;
    if (arrastrar_matriculas) {
      const r = await periodRepository.arrastrarMatriculas({ origenId: anterior.id, destinoId: periodo.id }, client);
      resumen.matriculados = r.matriculados;
      resumen.egresados = r.egresados;
    }
    if (copiar_docentes) {
      resumen.docentes_copiados = await periodRepository.copiarDocentesDeNivel(
        { origenId: anterior.id, destinoId: periodo.id, asignadoPorId: contexto.actor.usuario_id }, client
      );
    }
    if (copiar_guias) {
      resumen.guias_copiadas = await criteriaGuideRepository.copiarVigentes({ origenId: anterior.id, destinoId: periodo.id }, client);
    }
  });
  await registrarAuditoria({
    contexto, accion: "PERIODO_ACTIVADO", entidad: "periodos_academicos", entidad_id: periodo.id,
    valor_anterior: { estado: "PLANIFICADO" }, valor_nuevo: { estado: "ACTIVO", ...resumen },
  });
  return { periodo: await cargar(periodo.id), preparacion: resumen };
}

/** Qué pasaría al cerrar el periodo (para que el Director decida con la información delante). */
export async function resumenDeCierre(id) {
  const periodo = await cargar(id);
  const r = await periodRepository.resumenDeCierre(periodo.id);
  return {
    periodo: { id: periodo.id, codigo: periodo.codigo, estado: periodo.estado },
    practicas_en_marcha: r.en_marcha,
    solicitudes_abiertas: r.solicitudes_abiertas,
    practicas_finalizadas: r.finalizadas,
    matriculas_activas: r.matriculas,
    se_puede_cerrar: periodo.estado === "ACTIVO" && r.en_marcha === 0,
  };
}

/**
 * Cierra el periodo activo. No se puede con prácticas en curso o pendientes de evaluación.
 * Las solicitudes abiertas se cancelan (pide `confirmar`) y las matrículas pasan a FINALIZADA.
 */
export async function cerrar(id, { confirmar = false } = {}, contexto) {
  const periodo = await cargar(id);
  if (periodo.estado !== "ACTIVO") {
    throw ApiError.reglaDeNegocio("Solo se puede cerrar el periodo activo.", "PERIOD_STATE_INVALID");
  }
  const r = await periodRepository.resumenDeCierre(periodo.id);
  if (r.en_marcha > 0) {
    throw ApiError.reglaDeNegocio(
      `Aún hay ${r.en_marcha} práctica(s) en curso o pendientes de evaluación. Finalízalas o cancélalas antes de cerrar el periodo.`,
      "PERIOD_HAS_OPEN_PRACTICES",
      [{ practicas_en_marcha: r.en_marcha }]
    );
  }
  if (r.solicitudes_abiertas > 0 && !confirmar) {
    throw ApiError.conflicto(
      `Hay ${r.solicitudes_abiertas} solicitud(es) sin resolver. Al cerrar el periodo se cancelarán. Confirma para continuar.`,
      "CONFIRMATION_REQUIRED",
      [{ solicitudes_abiertas: r.solicitudes_abiertas }]
    );
  }
  let canceladas = 0;
  let matriculas = 0;
  await withTransaction(async (client) => {
    canceladas = await periodRepository.cancelarSolicitudesAbiertas(periodo.id, MOTIVO_CIERRE, client);
    matriculas = await periodRepository.finalizarMatriculas(periodo.id, client);
    await periodRepository.cambiarEstado(periodo.id, "CERRADO", client);
  });
  await registrarAuditoria({
    contexto, accion: "PERIODO_CERRADO", entidad: "periodos_academicos", entidad_id: periodo.id,
    valor_anterior: { estado: "ACTIVO" },
    valor_nuevo: { estado: "CERRADO", solicitudes_canceladas: canceladas, matriculas_finalizadas: matriculas },
  });
  return { periodo: await cargar(periodo.id), solicitudes_canceladas: canceladas, matriculas_finalizadas: matriculas };
}

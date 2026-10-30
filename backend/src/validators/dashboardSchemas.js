/**
 * Validación de los filtros del dashboard (periodo, búsqueda y estado).
 */
import { z } from "zod";
import { booleanoQuery, paginacionQuery, textoQuery, uuid } from "./commonSchemas.js";

const ESTADOS_ASIGNACION = [
  "BORRADOR", "ENVIADA", "DEVUELTA", "DOCUMENTOS_APROBADOS", "PLAZA_SELECCIONADA", "RECHAZADA",
  "PENDIENTE_DOCUMENTOS", "ACTIVA", "PENDIENTE_EVALUACION", "FINALIZADA", "CANCELADA",
];

export const resumenDashboardQuery = z.object({ periodo_id: uuid.optional() });

export const listarPracticasDashboardQuery = z.object({
  q: textoQuery,
  periodo_id: uuid.optional(),
  todos_los_periodos: booleanoQuery,
  estado: z.enum(ESTADOS_ASIGNACION).optional(),
  // Grupo de etapas para el seguimiento: EN_MARCHA = prácticas ya iniciadas (en curso, en evaluación o finalizadas).
  grupo: z.enum(["EN_MARCHA", "VIGENTES", "EN_CURSO", "EN_EVALUACION", "FINALIZADA"]).optional(),
  nivel_practica_id: uuid.optional(),
  ...paginacionQuery,
});

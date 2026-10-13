/**
 * Validación de los filtros del dashboard (periodo, búsqueda y estado).
 */
import { z } from "zod";
import { booleanoQuery, paginacionQuery, textoQuery, uuid } from "./commonSchemas.js";

const ESTADOS_ASIGNACION = ["PENDIENTE_DOCUMENTOS", "ACTIVA", "PENDIENTE_EVALUACION", "FINALIZADA", "CANCELADA"];

export const resumenDashboardQuery = z.object({ periodo_id: uuid.optional() });

export const listarPracticasDashboardQuery = z.object({
  q: textoQuery,
  periodo_id: uuid.optional(),
  todos_los_periodos: booleanoQuery,
  estado: z.enum(ESTADOS_ASIGNACION).optional(),
  ...paginacionQuery,
});

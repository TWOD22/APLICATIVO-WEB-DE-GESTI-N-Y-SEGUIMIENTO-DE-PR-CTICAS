/**
 * Validación de los filtros de la bandeja de notificaciones.
 */
import { z } from "zod";
import { booleanoQuery, paginacionQuery } from "./commonSchemas.js";

export const listarNotificacionesQuery = z.object({
  ...paginacionQuery,
  solo_no_leidas: booleanoQuery,
});

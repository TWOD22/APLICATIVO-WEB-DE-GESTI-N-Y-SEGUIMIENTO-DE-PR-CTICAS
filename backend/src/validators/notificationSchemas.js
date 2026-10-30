/**
 * Validación de los filtros de la bandeja de notificaciones.
 */
import { z } from "zod";
import { booleanoQuery, paginacionQuery } from "./commonSchemas.js";

export const listarNotificacionesQuery = z.object({
  ...paginacionQuery,
  solo_no_leidas: booleanoQuery,
});

/**
 * Id de una notificación. No es un UUID: las que crea el servicio de notificaciones llevan el id del evento y un
 * número (por ejemplo «abc123_0»), así que se aceptan letras, números, guion y guion bajo.
 */
export const notificacionIdParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/, "Identificador no válido") });

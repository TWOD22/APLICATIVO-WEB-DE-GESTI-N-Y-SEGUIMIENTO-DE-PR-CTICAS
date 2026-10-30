/**
 * Validación de docentes por nivel: filtros del listado y cuerpo para definir el docente de un nivel.
 */
import { z } from "zod";
import { uuid } from "./commonSchemas.js";

/** Parámetro de ruta: el nivel de práctica. */
export const nivelParamSchema = z.object({ nivelId: uuid });

/** Filtros del listado: periodo (por defecto el activo) y programa. */
export const listarDocentesNivelQuery = z.object({
  periodo_id: uuid.optional(),
  programa_id: uuid.optional(),
});

/** docente_id null quita al docente del nivel. */
export const definirDocenteNivelBody = z.object({
  docente_id: uuid.nullable(),
  periodo_id: uuid.optional(),
});

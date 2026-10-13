/**
 * Validación del filtro de niveles de práctica por programa.
 */
import { z } from "zod";
import { uuid } from "./commonSchemas.js";

export const listarNivelesQuery = z.object({ programa_id: uuid.optional() });

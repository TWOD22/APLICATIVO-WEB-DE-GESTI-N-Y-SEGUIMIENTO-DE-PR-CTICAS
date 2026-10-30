/** Filtro de los reportes: periodo (por defecto el activo). */
import { z } from "zod";
import { uuid } from "./commonSchemas.js";

export const reporteQuery = z.object({ periodo_id: uuid.optional() });

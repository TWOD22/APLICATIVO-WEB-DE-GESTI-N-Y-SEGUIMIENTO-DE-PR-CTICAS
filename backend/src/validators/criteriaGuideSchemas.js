/**
 * Validación de la guía de criterios: parámetros de ruta (nivel y periodo).
 */
import { z } from "zod";
import { uuid } from "./commonSchemas.js";

export const guiaParams = z.object({ nivelId: uuid, periodoId: uuid });
export const versionParams = z.object({ nivelId: uuid, periodoId: uuid, guiaId: uuid });

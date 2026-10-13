/**
 * Validación de entrada de documentos legales (parámetros de ruta, revisión del Director y filtros de expedientes).
 */
import { z } from "zod";
import { paginacionQuery, textoQuery, uuid } from "./commonSchemas.js";

export const asignacionParams = z.object({ id: uuid });
export const asignacionTipoParams = z.object({ id: uuid, tipoId: uuid });

export const revisarDocumentoBody = z
  .object({
    decision: z.enum(["APROBAR", "RECHAZAR", "PENDIENTE"]),
    // Catálogo opcional del modal de rechazo ("El archivo no es legible", ...).
    motivo: z.string().trim().min(3).max(150).optional(),
    observacion: z.string().trim().min(5, "Describe el motivo (mínimo 5 caracteres)").max(1000).optional(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    if (datos.decision === "RECHAZAR" && !datos.observacion) {
      ctx.addIssue({ code: "custom", path: ["observacion"], message: "Rechazar un documento exige una observación" });
    }
  });

export const listarExpedientesQuery = z.object({
  q: textoQuery,
  periodo_id: uuid.optional(),
  nivel: z.coerce.number().int().min(1).max(8).optional(),
  estado: z.enum(["EN_REVISION", "POR_CORREGIR", "INCOMPLETO", "COMPLETO"]).optional(),
  ...paginacionQuery,
});

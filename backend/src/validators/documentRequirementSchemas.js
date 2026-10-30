/** Validación de la configuración de documentos legales. */
import { z } from "zod";
import { uuid } from "./commonSchemas.js";

const nombre = z.string().trim().min(3, "Mínimo 3 caracteres").max(120, "Máximo 120 caracteres");
const descripcion = z.string().trim().max(500, "Máximo 500 caracteres").nullable();
const mb = z.number().int().min(1, "Mínimo 1 MB").max(25, "Máximo 25 MB");

export const crearTipoBody = z.object({ nombre, descripcion: descripcion.optional(), tamano_maximo_mb: mb.optional() });
export const actualizarTipoBody = z.object({
  nombre: nombre.optional(), descripcion: descripcion.optional(), tamano_maximo_mb: mb.optional(), activo: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, "No hay cambios para guardar");
export const definirNivelesBody = z.object({
  niveles: z.array(z.object({ nivel_id: uuid, obligatorio: z.boolean() })).max(20),
  confirmar: z.boolean().optional(),
  aplicar_en_curso: z.boolean().optional(),
});

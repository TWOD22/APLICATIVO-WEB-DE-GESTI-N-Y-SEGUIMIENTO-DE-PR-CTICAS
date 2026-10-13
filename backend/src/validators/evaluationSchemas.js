/**
 * Validación de evaluaciones: borrador, publicación (nota y retroalimentación), reapertura y filtros de listado.
 */
import { z } from "zod";
import { EVALUACION, PAGINA_TAMANO_MAXIMO, PAGINA_TAMANO_POR_DEFECTO } from "../utils/constants.js";
import { textoQuery, uuid } from "./commonSchemas.js";

const ESTADOS = ["PENDIENTE", "BORRADOR", "PUBLICADA"];

/** Nota global entre 0.00 y 5.00 con máximo dos decimales (el campo de la base es numeric(3,2)). */
const nota = z
  .number({ invalid_type_error: "La nota debe ser un número", required_error: "La nota es obligatoria" })
  .min(EVALUACION.NOTA_MINIMA, "La nota debe estar entre 0.00 y 5.00")
  .max(EVALUACION.NOTA_MAXIMA, "La nota debe estar entre 0.00 y 5.00")
  .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-9, "La nota admite máximo dos decimales");

/** "" llega desde los formularios vacíos: se guarda como ausencia de retroalimentación. */
const retroalimentacion = z
  .string()
  .trim()
  .max(EVALUACION.MAXIMO_CARACTERES_RETROALIMENTACION, `La retroalimentación admite máximo ${EVALUACION.MAXIMO_CARACTERES_RETROALIMENTACION} caracteres`)
  .transform((valor) => (valor === "" ? null : valor));

/**
 * PUT del borrador: reemplaza nota y retroalimentación (lo que no se envía queda vacío). Un borrador puede estar
 * incompleto: la nota solo es obligatoria al publicar.
 */
export const borradorEvaluacionBody = z
  .object({
    nota: nota.nullable().default(null),
    retroalimentacion: retroalimentacion.nullable().default(null),
  })
  .strict();

/**
 * Publicar usa lo que se envíe y, si algo no se envía, lo guardado en el borrador. Así la interfaz puede publicar
 * en un solo paso ("Guardar evaluación") o publicar lo que ya autoguardó.
 */
export const publicarEvaluacionBody = z
  .object({
    nota: nota.optional(),
    retroalimentacion: retroalimentacion.nullable().optional(),
  })
  .strict();

export const reabrirEvaluacionBody = z
  .object({ motivo: z.string().trim().min(5, "Describe el motivo (mínimo 5 caracteres)").max(500) })
  .strict();

export const listarEvaluacionesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(PAGINA_TAMANO_MAXIMO).default(PAGINA_TAMANO_POR_DEFECTO),
  estado: z.enum(ESTADOS).optional(),
  tipo: z.enum(EVALUACION.TIPOS).optional(),
  periodo_id: uuid.optional(),
  asignacion_id: uuid.optional(),
  q: textoQuery,
});

export const asignacionParams = z.object({ id: uuid });

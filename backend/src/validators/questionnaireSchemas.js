/**
 * Validación de cuestionarios y preguntas: creación, edición, habilitación y reordenamiento.
 */
import { z } from "zod";
import { uuid } from "./commonSchemas.js";

const tipoPregunta = z.enum(["ABIERTA", "CERRADA_UNICA", "CERRADA_MULTIPLE"]);
const enunciado = z.string().trim().min(3, "El enunciado debe tener al menos 3 caracteres").max(1000);
const opcion = z.object({ etiqueta: z.string().trim().min(1, "La opción no puede estar vacía").max(250) }).strict();

export const listarCuestionariosQuery = z.object({
  nivel_practica_id: uuid.optional(),
  nivel: z.coerce.number().int().min(1).max(8).optional(),
});

export const crearCuestionarioBody = z
  .object({
    nivel_practica_id: uuid,
    titulo: z.string().trim().min(3).max(200).optional(),
    /** Versión de la que se copian las preguntas; por defecto, la habilitada del nivel. */
    copiar_de: uuid.optional(),
    /** true para empezar en blanco. */
    sin_copia: z.boolean().optional(),
  })
  .strict();

export const actualizarCuestionarioBody = z.object({ titulo: z.string().trim().min(3).max(200) }).strict();

export const crearPreguntaBody = z
  .object({
    tipo: tipoPregunta,
    enunciado,
    obligatoria: z.boolean().default(true),
    opciones: z.array(opcion).max(10).optional(),
  })
  .strict();

export const actualizarPreguntaBody = z
  .object({
    tipo: tipoPregunta.optional(),
    enunciado: enunciado.optional(),
    obligatoria: z.boolean().optional(),
    opciones: z.array(opcion).max(10).optional(),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, "Envía al menos un campo para modificar");

export const habilitarBody = z.object({ habilitado: z.boolean() }).strict();

export const reordenarBody = z.object({ orden: z.array(uuid).min(1).max(100) }).strict();

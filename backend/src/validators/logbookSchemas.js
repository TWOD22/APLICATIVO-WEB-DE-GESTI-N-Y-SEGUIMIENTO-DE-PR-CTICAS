/**
 * Validación de bitácoras: borrador, envío (con revisión base para evitar pisar cambios), devolución, evidencias y llave de idempotencia.
 */
import { z } from "zod";
import { BITACORA } from "../utils/constants.js";
import { uuid } from "./commonSchemas.js";

export const asignacionParams = z.object({ id: uuid });
export const evidenciaParams = z.object({ id: uuid, evidenciaId: uuid });

const respuesta = z
  .object({
    pregunta_id: uuid,
    texto: z.string().max(BITACORA.MAXIMO_CARACTERES_RESPUESTA, "La respuesta es demasiado larga").nullish(),
    opciones_ids: z.array(uuid).max(20).optional(),
  })
  .strict();

/** El autoguardado reemplaza el borrador completo; `revision_base` es la revisión que la interfaz vio por última vez. */
export const guardarBorradorBody = z
  .object({
    revision_base: z.number().int().min(0),
    reflexion: z.string().max(BITACORA.MAXIMO_CARACTERES_REFLEXION, "La reflexión es demasiado larga").default(""),
    respuestas: z.array(respuesta).max(100).default([]),
  })
  .strict();

export const enviarBitacoraBody = z.object({ revision_base: z.number().int().min(0) }).strict();

export const devolverBitacoraBody = z
  .object({ motivo: z.string().trim().min(5, "Describe el motivo (mínimo 5 caracteres)").max(1000) })
  .strict();

export const descripcionEvidenciaBody = z
  .object({ descripcion: z.string().trim().max(500, "La descripción admite máximo 500 caracteres") })
  .strict();

/** La llave de idempotencia identifica un intento de envío: la interfaz genera una nueva por cada clic confirmado. */
export const llaveIdempotencia = z
  .string()
  .trim()
  .min(8, "La llave de idempotencia es demasiado corta")
  .max(63, "La llave de idempotencia es demasiado larga")
  .regex(/^[A-Za-z0-9._:-]+$/, "La llave de idempotencia tiene caracteres no permitidos");

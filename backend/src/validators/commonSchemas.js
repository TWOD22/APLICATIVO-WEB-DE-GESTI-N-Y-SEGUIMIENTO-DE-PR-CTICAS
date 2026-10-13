/**
 * Esquemas Zod reutilizables: identificadores UUID, paginación, fechas ISO, correo, teléfono y filtros de texto/booleano para query strings.
 */
import { z } from "zod";
import { PAGINA_TAMANO_MAXIMO, PAGINA_TAMANO_POR_DEFECTO } from "../utils/constants.js";

export const uuid = z.string().uuid("Debe ser un identificador válido");

export const idParamSchema = z.object({ id: uuid });

/** page / page_size llegan como texto en la query string. */
export const paginacionQuery = {
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(PAGINA_TAMANO_MAXIMO).default(PAGINA_TAMANO_POR_DEFECTO),
};

/** Fecha calendario YYYY-MM-DD válida. */
export const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD")
  .refine((valor) => {
    const fecha = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
  }, "La fecha no es válida");

/** Los formularios envían "" para campos vacíos: se convierten en null antes de validar. */
export const opcionalVacio = (esquema) =>
  z.preprocess((valor) => (typeof valor === "string" && valor.trim() === "" ? null : valor), esquema.nullable().optional());

export const correo = z.string().trim().toLowerCase().email("Correo electrónico inválido").max(160);

export const telefono = z
  .string()
  .trim()
  .regex(/^[0-9+()\-\s]{7,30}$/, "Teléfono inválido");

export const textoQuery = z.string().trim().max(100).optional();

/** "true"/"false" de la query string a booleano. */
export const booleanoQuery = z
  .enum(["true", "false"])
  .transform((valor) => valor === "true")
  .optional();

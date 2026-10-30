/**
 * Validación del filtro de niveles de práctica por programa.
 */
import { z } from "zod";
import { uuid } from "./commonSchemas.js";

export const listarNivelesQuery = z.object({ programa_id: uuid.optional() });

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD");

/** Crear un periodo. El código es el que ve todo el sistema (p. ej. 2027-1). */
export const crearPeriodoBody = z.object({
  codigo: z.string().trim().min(3, "Mínimo 3 caracteres").max(20, "Máximo 20 caracteres"),
  nombre: z.string().trim().min(3, "Mínimo 3 caracteres").max(120, "Máximo 120 caracteres"),
  fecha_inicio: fecha,
  fecha_fin: fecha,
});

/** Activar: qué se prepara a partir del periodo cerrado anterior (todo activo por defecto). */
export const activarPeriodoBody = z.object({
  arrastrar_matriculas: z.boolean().optional(),
  copiar_docentes: z.boolean().optional(),
  copiar_guias: z.boolean().optional(),
});

/** Cerrar: `confirmar` acepta que las solicitudes abiertas se cancelen. */
export const cerrarPeriodoBody = z.object({ confirmar: z.boolean().optional() });

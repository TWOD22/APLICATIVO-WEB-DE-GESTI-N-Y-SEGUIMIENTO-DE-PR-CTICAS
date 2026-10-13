/**
 * Validación de entrada de asignaciones (listar, estudiantes elegibles, crear, actualizar y cancelar).
 */
import { z } from "zod";
import { fechaIso, opcionalVacio, paginacionQuery, textoQuery, uuid } from "./commonSchemas.js";

const ESTADOS = ["PENDIENTE_DOCUMENTOS", "ACTIVA", "PENDIENTE_EVALUACION", "FINALIZADA", "CANCELADA"];

export const listarAsignacionesQuery = z.object({
  q: textoQuery,
  periodo_id: uuid.optional(),
  todos_los_periodos: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  nivel: z.coerce.number().int().min(1).max(8).optional(),
  estado: z.enum(ESTADOS).optional(),
  completitud: z.enum(["SIN_DOCENTE", "SIN_ASESOR", "COMPLETA"]).optional(),
  institucion_id: uuid.optional(),
  docente_id: uuid.optional(),
  asesor_id: uuid.optional(),
  ...paginacionQuery,
});

export const estudiantesSinAsignacionQuery = z.object({
  periodo_id: uuid.optional(),
  q: textoQuery,
  ...paginacionQuery,
});

// Regla cruzada: la fecha de fin no puede ser anterior a la de inicio.
const ordenDeFechas = (datos, ctx) => {
  if (datos.fecha_inicio && datos.fecha_fin && datos.fecha_fin < datos.fecha_inicio) {
    ctx.addIssue({ code: "custom", path: ["fecha_fin"], message: "La fecha final no puede ser anterior a la inicial" });
  }
};

export const crearAsignacionBody = z
  .object({
    estudiante_id: uuid,
    periodo_id: uuid.optional(),
    nivel_practica_id: uuid,
    institucion_id: uuid,
    docente_supervisor_id: opcionalVacio(uuid),
    asesor_sitio_id: opcionalVacio(uuid),
    fecha_inicio: opcionalVacio(fechaIso),
    fecha_fin: opcionalVacio(fechaIso),
  })
  .strict()
  .superRefine(ordenDeFechas);

export const actualizarAsignacionBody = z
  .object({
    institucion_id: uuid.optional(),
    docente_supervisor_id: opcionalVacio(uuid),
    asesor_sitio_id: opcionalVacio(uuid),
    fecha_inicio: opcionalVacio(fechaIso),
    fecha_fin: opcionalVacio(fechaIso),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, "Envía al menos un campo para actualizar")
  .superRefine(ordenDeFechas);

export const cancelarAsignacionBody = z
  .object({
    estado: z.literal("CANCELADA"),
    motivo: z.string().trim().min(5, "Describe el motivo (mínimo 5 caracteres)").max(500),
    confirmar: z.boolean().optional(),
  })
  .strict();

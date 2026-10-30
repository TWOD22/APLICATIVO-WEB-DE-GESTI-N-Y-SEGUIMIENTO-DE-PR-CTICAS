/**
 * Validación de entrada de las solicitudes de práctica del estudiante.
 */
import { z } from "zod";
import { fechaIso, opcionalVacio, paginacionQuery, textoQuery, uuid } from "./commonSchemas.js";

/** El estudiante confirma explícitamente el nivel que le propuso el sistema. */
export const crearSolicitudBody = z.object({ nivel_practica_id: uuid }).strict();

/** El estudiante elige la institución donde quiere hacer su práctica. */
export const elegirPlazaBody = z.object({ institucion_id: uuid }).strict();

/** Estados de solicitud que la bandeja del Director puede filtrar. */
const ESTADOS_SOLICITUD = ["ENVIADA", "DEVUELTA", "DOCUMENTOS_APROBADOS", "PLAZA_SELECCIONADA", "RECHAZADA"];

/** Filtros de la bandeja de solicitudes del Director. */
export const listarSolicitudesQuery = z.object({
  q: textoQuery,
  periodo_id: uuid.optional(),
  estado: z.enum(ESTADOS_SOLICITUD).optional(),
  ...paginacionQuery,
});

/** Institución a consultar en el panel de asesores (por defecto, la que eligió el estudiante). */
export const asesoresSolicitudQuery = z.object({ institucion_id: uuid.optional() });

// La fecha de fin no puede ser anterior a la de inicio.
const ordenDeFechas = (datos, ctx) => {
  if (datos.fecha_inicio && datos.fecha_fin && datos.fecha_fin < datos.fecha_inicio) {
    ctx.addIssue({ code: "custom", path: ["fecha_fin"], message: "La fecha final no puede ser anterior a la inicial" });
  }
};

/** "Confirmar y asignar": plaza (opcional si no cambia), motivo si la cambia, asesor (opcional si hay uno solo) y fechas. */
export const asignarSolicitudBody = z
  .object({
    institucion_id: uuid.optional(),
    motivo_cambio_plaza: opcionalVacio(z.string().trim().min(5, "Describe el motivo (mínimo 5 caracteres)").max(500)),
    asesor_sitio_id: opcionalVacio(uuid),
    fecha_inicio: opcionalVacio(fechaIso),
    fecha_fin: opcionalVacio(fechaIso),
  })
  .strict()
  .superRefine(ordenDeFechas);

/** Rechazo de una solicitud: el motivo es obligatorio. */
export const rechazarSolicitudBody = z
  .object({ motivo: z.string().trim().min(5, "Describe el motivo (mínimo 5 caracteres)").max(500) })
  .strict();

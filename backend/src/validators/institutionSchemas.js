/**
 * Validación de instituciones: listado, alta, edición, estado del convenio y filtros de personas.
 */
import { z } from "zod";
import { ESTADOS_CONVENIO } from "../utils/constants.js";
import {
  booleanoQuery, correo, fechaIso, opcionalVacio, paginacionQuery, telefono, textoQuery, uuid,
} from "./commonSchemas.js";

const nit = z
  .string()
  .trim()
  .regex(/^[0-9]{6,12}(-[0-9Kk])?$/, "NIT inválido (ejemplo: 900123456-7)");

const camposInstitucion = {
  nombre: z.string().trim().min(3, "Mínimo 3 caracteres").max(200),
  nit,
  ciudad: z.string().trim().min(2).max(100),
  direccion: opcionalVacio(z.string().trim().max(250)),
  correo, // obligatorio: el modelo de datos exige correo institucional de contacto
  telefono: opcionalVacio(telefono),
  estado_convenio: z.enum(ESTADOS_CONVENIO),
  convenio_inicio: opcionalVacio(fechaIso),
  convenio_fin: opcionalVacio(fechaIso),
};

export const listarInstitucionesQuery = z.object({
  q: textoQuery,
  estado_convenio: z.enum(ESTADOS_CONVENIO).optional(),
  activa: booleanoQuery,
  ...paginacionQuery,
});

export const crearInstitucionBody = z
  .object({ ...camposInstitucion, estado_convenio: camposInstitucion.estado_convenio.default("EN_TRAMITE") })
  .strict();

export const actualizarInstitucionBody = z
  .object({
    nombre: camposInstitucion.nombre.optional(),
    nit: camposInstitucion.nit.optional(),
    ciudad: camposInstitucion.ciudad.optional(),
    direccion: camposInstitucion.direccion,
    correo: camposInstitucion.correo.optional(),
    telefono: camposInstitucion.telefono,
    estado_convenio: camposInstitucion.estado_convenio.optional(),
    convenio_inicio: camposInstitucion.convenio_inicio,
    convenio_fin: camposInstitucion.convenio_fin,
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, "Envía al menos un campo para actualizar");

export const cambiarEstadoInstitucionBody = z
  .object({ activa: z.boolean(), confirmar: z.boolean().optional() })
  .strict();

export const personasInstitucionQuery = z.object({ periodo_id: uuid.optional() });

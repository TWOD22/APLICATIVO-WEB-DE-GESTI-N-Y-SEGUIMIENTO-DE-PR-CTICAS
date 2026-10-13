/**
 * Validación de usuarios: listado, alta, edición, cambio de estado, perfil propio y cambio de rol activo.
 */
import { z } from "zod";
import { ESTADOS_USUARIO, LISTA_ROLES, ROLES, ROLES_REGISTRABLES } from "../utils/constants.js";
import { correo, opcionalVacio, paginacionQuery, telefono, textoQuery, uuid } from "./commonSchemas.js";

const documento = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z.\-]{5,30}$/, "El documento debe tener entre 5 y 30 caracteres alfanuméricos");
const nombre = z.string().trim().min(2, "Mínimo 2 caracteres").max(120);

export const listarUsuariosQuery = z.object({
  q: textoQuery,
  rol: z.enum(LISTA_ROLES).optional(),
  semestre: z.coerce.number().int().min(1).max(8).optional(),
  estado: z.enum(ESTADOS_USUARIO).optional(),
  ...paginacionQuery,
});

export const crearUsuarioBody = z
  .object({
    rol: z.enum(ROLES_REGISTRABLES),
    documento,
    nombres: nombre,
    apellidos: nombre,
    correo,
    telefono: opcionalVacio(telefono),
    programa_id: opcionalVacio(uuid),
    semestre: z.coerce.number().int().min(1, "Semestre entre 1 y 8").max(8, "Semestre entre 1 y 8").optional(),
    institucion_id: opcionalVacio(uuid),
  })
  .strict()
  .superRefine((datos, ctx) => {
    if (datos.rol === ROLES.ESTUDIANTE && datos.semestre === undefined) {
      ctx.addIssue({ code: "custom", path: ["semestre"], message: "El semestre es obligatorio para estudiantes" });
    }
    if (datos.rol === ROLES.ASESOR_SITIO && !datos.institucion_id) {
      ctx.addIssue({ code: "custom", path: ["institucion_id"], message: "La institución es obligatoria para asesores" });
    }
  });

export const actualizarUsuarioBody = z
  .object({
    documento: documento.optional(),
    nombres: nombre.optional(),
    apellidos: nombre.optional(),
    correo: correo.optional(),
    telefono: opcionalVacio(telefono),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, "Envía al menos un campo para actualizar");

export const cambiarEstadoUsuarioBody = z
  .object({
    estado: z.enum(ESTADOS_USUARIO),
    confirmar: z.boolean().optional(),
  })
  .strict();

export const actualizarPerfilPropioBody = z
  .object({
    nombres: nombre.optional(),
    apellidos: nombre.optional(),
    telefono: opcionalVacio(telefono),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, "Envía al menos un campo para actualizar");

export const cambiarRolActivoBody = z.object({ rol: z.enum(LISTA_ROLES) }).strict();

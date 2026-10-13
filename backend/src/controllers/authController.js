/**
 * Controlador de sesión: perfil propio, rol activo y cierre de sesiones.
 */
import * as authService from "../services/authService.js";
import * as userService from "../services/userService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderOk } from "../utils/respuesta.js";

/** Devuelve la sesión actual (usuario, roles y rol activo). */
export const obtenerSesion = (req, res) => responderOk(res, authService.describirSesion(req.auth));

/** Cambia el rol activo. */
export const cambiarRolActivo = (req, res) =>
  responderOk(res, authService.seleccionarRolActivo(req.auth, req.body.rol));

/** El usuario actualiza su propio perfil. */
export const actualizarMiPerfil = async (req, res) => {
  const usuario = await userService.actualizarPerfilPropio(req.auth.usuario, req.body, construirContexto(req));
  responderOk(res, usuario);
};

/** Revoca todas las sesiones del usuario. */
export const cerrarTodasLasSesiones = async (req, res) =>
  responderOk(res, await authService.cerrarTodasLasSesiones(req.auth, construirContexto(req)));

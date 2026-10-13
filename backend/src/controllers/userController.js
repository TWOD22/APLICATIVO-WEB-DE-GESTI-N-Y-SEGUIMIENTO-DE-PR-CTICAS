/**
 * Controlador de usuarios.
 */
import * as userService from "../services/userService.js";
import { construirContexto } from "../utils/contexto.js";
import { armarMetaPaginacion, calcularPaginacion } from "../utils/pagination.js";
import { responderCreado, responderListado, responderOk } from "../utils/respuesta.js";

/** Lista usuarios. */
export const listar = async (req, res) => {
  const paginacion = calcularPaginacion(req.query);
  const { filas, total } = await userService.listar({ ...req.query, limit: paginacion.limit, offset: paginacion.offset });
  responderListado(res, filas, armarMetaPaginacion(paginacion, total));
};

/** Crea usuario. */
export const crear = async (req, res) =>
  responderCreado(res, await userService.crear(req.body, construirContexto(req)));

/** Detalle. */
export const obtener = async (req, res) => responderOk(res, await userService.obtenerDetalle(req.params.id));

/** Actualiza. */
export const actualizar = async (req, res) =>
  responderOk(res, await userService.actualizar(req.params.id, req.body, construirContexto(req)));

/** Cambia estado. */
export const cambiarEstado = async (req, res) =>
  responderOk(res, await userService.cambiarEstado(req.params.id, req.body, construirContexto(req)));

/** Prácticas del usuario. */
export const listarPracticas = async (req, res) =>
  responderOk(res, await userService.listarPracticas(req.params.id));

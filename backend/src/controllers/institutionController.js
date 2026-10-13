/**
 * Controlador de instituciones.
 */
import * as institutionService from "../services/institutionService.js";
import { construirContexto } from "../utils/contexto.js";
import { armarMetaPaginacion, calcularPaginacion } from "../utils/pagination.js";
import { responderCreado, responderListado, responderOk } from "../utils/respuesta.js";

/** Lista instituciones. */
export const listar = async (req, res) => {
  const paginacion = calcularPaginacion(req.query);
  const { filas, total } = await institutionService.listar({ ...req.query, limit: paginacion.limit, offset: paginacion.offset });
  responderListado(res, filas, armarMetaPaginacion(paginacion, total));
};

/** Crea una institución. */
export const crear = async (req, res) =>
  responderCreado(res, await institutionService.crear(req.body, construirContexto(req)));

/** Detalle. */
export const obtener = async (req, res) => responderOk(res, await institutionService.obtener(req.params.id));

/** Actualiza. */
export const actualizar = async (req, res) =>
  responderOk(res, await institutionService.actualizar(req.params.id, req.body, construirContexto(req)));

/** Cambia el estado del convenio. */
export const cambiarEstado = async (req, res) =>
  responderOk(res, await institutionService.cambiarEstado(req.params.id, req.body, construirContexto(req)));

/** Estudiantes de la institución. */
export const listarEstudiantes = async (req, res) =>
  responderOk(res, await institutionService.listarEstudiantes(req.params.id, req.query.periodo_id));

/** Asesores de la institución. */
export const listarAsesores = async (req, res) =>
  responderOk(res, await institutionService.listarAsesores(req.params.id, req.query.periodo_id));

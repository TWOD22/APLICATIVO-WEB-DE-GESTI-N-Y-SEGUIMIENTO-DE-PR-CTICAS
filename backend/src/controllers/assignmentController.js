/**
 * Controlador de asignaciones: traduce la petición HTTP a llamadas al servicio y arma la respuesta.
 */
import * as assignmentService from "../services/assignmentService.js";
import { construirContexto } from "../utils/contexto.js";
import { armarMetaPaginacion, calcularPaginacion } from "../utils/pagination.js";
import { responderCreado, responderListado, responderOk } from "../utils/respuesta.js";

/** Lista asignaciones según el rol del usuario. */
export const listar = async (req, res) => {
  const paginacion = calcularPaginacion(req.query);
  const { filas, total } = await assignmentService.listar(
    { ...req.query, limit: paginacion.limit, offset: paginacion.offset },
    req.auth
  );
  responderListado(res, filas, armarMetaPaginacion(paginacion, total));
};

/** Estudiantes con matrícula activa que aún no tienen asignación. */
export const listarEstudiantesSinAsignacion = async (req, res) => {
  const paginacion = calcularPaginacion(req.query);
  const { filas, total } = await assignmentService.listarEstudiantesSinAsignacion({
    ...req.query, limit: paginacion.limit, offset: paginacion.offset,
  });
  responderListado(res, filas, armarMetaPaginacion(paginacion, total));
};

/** Detalle de una asignación. */
export const obtener = async (req, res) => responderOk(res, await assignmentService.obtener(req.params.id, req.auth));

/** Crea una asignación. */
export const crear = async (req, res) =>
  responderCreado(res, await assignmentService.crear(req.body, construirContexto(req)));

/** Actualiza una asignación. */
export const actualizar = async (req, res) =>
  responderOk(res, await assignmentService.actualizar(req.params.id, req.body, construirContexto(req)));

/** Cancela una asignación. */
export const cancelar = async (req, res) =>
  responderOk(res, await assignmentService.cancelar(req.params.id, req.body, construirContexto(req)));

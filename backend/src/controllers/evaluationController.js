/**
 * Controlador de evaluaciones.
 */
import * as evaluationService from "../services/evaluationService.js";
import { construirContexto } from "../utils/contexto.js";
import { armarMetaPaginacion, calcularPaginacion } from "../utils/pagination.js";
import { responderListado, responderOk } from "../utils/respuesta.js";

/** Lista evaluaciones. */
export const listar = async (req, res) => {
  const paginacion = calcularPaginacion(req.query);
  const { filas, total, resumen } = await evaluationService.listar(
    { ...req.query, limit: paginacion.limit, offset: paginacion.offset },
    req.auth
  );
  responderListado(res, filas, { ...armarMetaPaginacion(paginacion, total), resumen });
};

/** Detalle de una evaluación. */
export const obtener = async (req, res) => responderOk(res, await evaluationService.obtener(req.params.id, req.auth));

/** Guarda el borrador. */
export const guardarBorrador = async (req, res) =>
  responderOk(res, await evaluationService.guardarBorrador(req.params.id, req.body, req.auth));

/** Publica la evaluación. */
export const publicar = async (req, res) =>
  responderOk(res, await evaluationService.publicar(req.params.id, req.body, req.auth, construirContexto(req)));

/** Reabre una evaluación. */
export const reabrir = async (req, res) =>
  responderOk(res, await evaluationService.reabrir(req.params.id, req.body, req.auth, construirContexto(req)));

/** Finaliza la práctica. */
export const finalizarPractica = async (req, res) =>
  responderOk(res, await evaluationService.finalizarPractica(req.params.id, construirContexto(req)));

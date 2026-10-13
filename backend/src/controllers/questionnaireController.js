/**
 * Controlador de cuestionarios y preguntas.
 */
import * as questionnaireService from "../services/questionnaireService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderCreado, responderOk, responderSinContenido } from "../utils/respuesta.js";

/** Lista. */
export const listar = async (req, res) => responderOk(res, await questionnaireService.listar(req.query));

/** Detalle. */
export const obtener = async (req, res) => responderOk(res, await questionnaireService.obtener(req.params.id));

/** Crea. */
export const crear = async (req, res) =>
  responderCreado(res, await questionnaireService.crear(req.body, construirContexto(req)));

/** Actualiza. */
export const actualizar = async (req, res) =>
  responderOk(res, await questionnaireService.actualizar(req.params.id, req.body));

/** Publica. */
export const publicar = async (req, res) =>
  responderOk(res, await questionnaireService.publicar(req.params.id, construirContexto(req)));

/** Habilita o deshabilita. */
export const cambiarHabilitado = async (req, res) =>
  responderOk(res, await questionnaireService.cambiarHabilitado(req.params.id, req.body, construirContexto(req)));

/** Agrega pregunta. */
export const agregarPregunta = async (req, res) =>
  responderCreado(res, await questionnaireService.agregarPregunta(req.params.id, req.body));

/** Reordena preguntas. */
export const reordenar = async (req, res) =>
  responderOk(res, await questionnaireService.reordenar(req.params.id, req.body));

/** Actualiza pregunta. */
export const actualizarPregunta = async (req, res) =>
  responderOk(res, await questionnaireService.actualizarPregunta(req.params.id, req.body));

/** Elimina pregunta. */
export const eliminarPregunta = async (req, res) => {
  await questionnaireService.eliminarPregunta(req.params.id);
  responderSinContenido(res);
};

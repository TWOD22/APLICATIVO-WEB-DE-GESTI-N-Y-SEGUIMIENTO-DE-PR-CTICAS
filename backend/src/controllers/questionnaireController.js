/**
 * Controlador de cuestionarios y preguntas.
 */
import * as questionnaireService from "../services/questionnaireService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderCreado, responderOk, responderSinContenido } from "../utils/respuesta.js";

/** Lista. */
export const listar = async (req, res) => responderOk(res, await questionnaireService.listar(req.query, req.auth));

/** Detalle. */
export const obtener = async (req, res) => responderOk(res, await questionnaireService.obtener(req.params.id, req.auth));

/** Crea. */
export const crear = async (req, res) =>
  responderCreado(res, await questionnaireService.crear(req.body, construirContexto(req), req.auth));

/** Actualiza. */
export const actualizar = async (req, res) =>
  responderOk(res, await questionnaireService.actualizar(req.params.id, req.body, req.auth));

/** Efecto de publicar el borrador (aviso previo). */
export const impactoDePublicar = async (req, res) =>
  responderOk(res, await questionnaireService.impactoDePublicar(req.params.id, req.auth));

/** Publica. */
export const publicar = async (req, res) =>
  responderOk(res, await questionnaireService.publicar(req.params.id, construirContexto(req), req.auth));

/** Habilita o deshabilita. */
export const cambiarHabilitado = async (req, res) =>
  responderOk(res, await questionnaireService.cambiarHabilitado(req.params.id, req.body, construirContexto(req), req.auth));

/** Agrega pregunta. */
export const agregarPregunta = async (req, res) =>
  responderCreado(res, await questionnaireService.agregarPregunta(req.params.id, req.body, req.auth));

/** Reordena preguntas. */
export const reordenar = async (req, res) =>
  responderOk(res, await questionnaireService.reordenar(req.params.id, req.body, req.auth));

/** Actualiza pregunta. */
export const actualizarPregunta = async (req, res) =>
  responderOk(res, await questionnaireService.actualizarPregunta(req.params.id, req.body, req.auth));

/** Elimina pregunta. */
export const eliminarPregunta = async (req, res) => {
  await questionnaireService.eliminarPregunta(req.params.id, req.auth);
  responderSinContenido(res);
};

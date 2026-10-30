/**
 * Controlador de catálogos: programas, periodos y niveles.
 */
import * as periodService from "../services/periodService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderCreado, responderOk } from "../utils/respuesta.js";

export const listarProgramas = async (_req, res) => responderOk(res, await periodService.listarProgramas());
export const listarPeriodos = async (_req, res) => responderOk(res, await periodService.listarPeriodos());
export const listarNiveles = async (req, res) =>
  responderOk(res, await periodService.listarNivelesPractica(req.query.programa_id));
export const crearPeriodo = async (req, res) => responderCreado(res, await periodService.crear(req.body, construirContexto(req)));
export const activarPeriodo = async (req, res) =>
  responderOk(res, await periodService.activar(req.params.id, req.body, construirContexto(req)));
export const resumenDeCierre = async (req, res) => responderOk(res, await periodService.resumenDeCierre(req.params.id));
export const cerrarPeriodo = async (req, res) =>
  responderOk(res, await periodService.cerrar(req.params.id, req.body, construirContexto(req)));

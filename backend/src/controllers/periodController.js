/**
 * Controlador de catálogos: programas, periodos y niveles.
 */
import * as periodService from "../services/periodService.js";
import { responderOk } from "../utils/respuesta.js";

export const listarProgramas = async (_req, res) => responderOk(res, await periodService.listarProgramas());
export const listarPeriodos = async (_req, res) => responderOk(res, await periodService.listarPeriodos());
export const listarNiveles = async (req, res) =>
  responderOk(res, await periodService.listarNivelesPractica(req.query.programa_id));

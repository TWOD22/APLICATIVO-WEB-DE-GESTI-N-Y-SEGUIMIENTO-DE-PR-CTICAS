/** Controlador de la configuración de documentos legales (Director). */
import * as service from "../services/documentRequirementService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderCreado, responderOk } from "../utils/respuesta.js";

export const listar = async (_req, res) => responderOk(res, await service.listar());
export const crearTipo = async (req, res) => responderCreado(res, await service.crearTipo(req.body, construirContexto(req)));
export const actualizarTipo = async (req, res) => responderOk(res, await service.actualizarTipo(req.params.id, req.body, construirContexto(req)));
export const definirNiveles = async (req, res) => responderOk(res, await service.definirNiveles(req.params.id, req.body, construirContexto(req)));

/** Controlador de la configuración de documentos legales (Director). */
import * as service from "../services/documentRequirementService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderCreado, responderOk } from "../utils/respuesta.js";

/** GET: catálogo de tipos de documento y, por nivel, si se pide como obligatorio u opcional. */
export const listar = async (_req, res) => responderOk(res, await service.listar());
/** POST: crea un tipo de documento (solo PDF). */
export const crearTipo = async (req, res) => responderCreado(res, await service.crearTipo(req.body, construirContexto(req)));
/** PATCH: cambia nombre, descripción o tamaño máximo, o desactiva/reactiva el tipo. */
export const actualizarTipo = async (req, res) => responderOk(res, await service.actualizarTipo(req.params.id, req.body, construirContexto(req)));
/** PUT: define en qué niveles se pide el documento; pide confirmación si hay estudiantes afectados. */
export const definirNiveles = async (req, res) => responderOk(res, await service.definirNiveles(req.params.id, req.body, construirContexto(req)));

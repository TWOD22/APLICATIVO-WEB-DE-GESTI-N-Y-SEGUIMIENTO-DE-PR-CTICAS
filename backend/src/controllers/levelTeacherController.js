/**
 * Controlador de docentes por nivel de práctica.
 */
import * as levelTeacherService from "../services/levelTeacherService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderOk } from "../utils/respuesta.js";

/** Niveles con su docente en el periodo. */
export const listar = async (req, res) => responderOk(res, await levelTeacherService.listar(req.query));

/** Define o quita el docente de un nivel. */
export const definir = async (req, res) =>
  responderOk(res, await levelTeacherService.definir(req.params.nivelId, req.body, construirContexto(req)));

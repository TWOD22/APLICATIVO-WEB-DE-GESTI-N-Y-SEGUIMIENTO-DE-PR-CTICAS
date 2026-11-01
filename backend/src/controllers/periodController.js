/**
 * Controlador de catálogos: programas, periodos y niveles.
 */
import * as periodService from "../services/periodService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderCreado, responderOk } from "../utils/respuesta.js";

/** GET: programas académicos. */
export const listarProgramas = async (_req, res) => responderOk(res, await periodService.listarProgramas());
/** GET: periodos académicos. */
export const listarPeriodos = async (_req, res) => responderOk(res, await periodService.listarPeriodos());
/** GET: niveles de práctica de un programa (?programa_id=). */
export const listarNiveles = async (req, res) =>
  responderOk(res, await periodService.listarNivelesPractica(req.query.programa_id));
/** POST: crea un periodo (valida fechas y que el código no exista). */
export const crearPeriodo = async (req, res) => responderCreado(res, await periodService.crear(req.body, construirContexto(req)));
/** POST: activa un periodo planificado; falla si ya hay otro activo. Puede traer matrículas, docentes y guías del último periodo cerrado. */
export const activarPeriodo = async (req, res) =>
  responderOk(res, await periodService.activar(req.params.id, req.body, construirContexto(req)));
/** GET: cuántas prácticas y solicitudes siguen abiertas y si el periodo se puede cerrar (vista previa del cierre). */
export const resumenDeCierre = async (req, res) => responderOk(res, await periodService.resumenDeCierre(req.params.id));
/** POST: cierra el periodo activo; exige confirmación si hay solicitudes sin resolver (se cancelan) y no permite prácticas en curso. */
export const cerrarPeriodo = async (req, res) =>
  responderOk(res, await periodService.cerrar(req.params.id, req.body, construirContexto(req)));

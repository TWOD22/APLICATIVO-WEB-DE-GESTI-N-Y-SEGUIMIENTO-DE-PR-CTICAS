/**
 * Controlador de solicitudes de práctica del estudiante.
 */
import * as assignmentService from "../services/assignmentService.js";
import * as practiceRequestService from "../services/practiceRequestService.js";
import { construirContexto } from "../utils/contexto.js";
import { armarMetaPaginacion, calcularPaginacion } from "../utils/pagination.js";
import { responderCreado, responderListado, responderOk } from "../utils/respuesta.js";

/** Trayectoria del estudiante autenticado. */
export const trayectoria = async (req, res) => responderOk(res, await practiceRequestService.obtenerTrayectoria(req.auth));

/** Crea la solicitud (BORRADOR) del nivel propuesto. */
export const crear = async (req, res) =>
  responderCreado(res, await practiceRequestService.crear(req.body, req.auth, construirContexto(req)));

/** Envía la solicitud a Dirección. */
export const enviar = async (req, res) =>
  responderOk(res, await practiceRequestService.enviar(req.params.id, req.auth, construirContexto(req)));

/** Descarta el borrador. */
export const descartar = async (req, res) =>
  responderOk(res, await practiceRequestService.descartar(req.params.id, req.auth, construirContexto(req)));

// ───────── Elección de plaza (estudiante) ─────────

/** Instituciones disponibles para elegir plaza. */
export const plazasDisponibles = async (_req, res) => responderOk(res, await practiceRequestService.listarPlazas());

/** El estudiante elige su plaza. */
export const elegirPlaza = async (req, res) =>
  responderOk(res, await practiceRequestService.elegirPlaza(req.params.id, req.body, req.auth, construirContexto(req)));

// ───────── Bandeja y asignación (Director) ─────────

/** Bandeja de solicitudes. */
export const listarSolicitudes = async (req, res) => {
  const paginacion = calcularPaginacion(req.query);
  const { filas, total } = await assignmentService.listarSolicitudes({ ...req.query, limit: paginacion.limit, offset: paginacion.offset }, req.auth);
  responderListado(res, filas, armarMetaPaginacion(paginacion, total));
};

/** Doble pantalla: docente del nivel y asesores de la institución con su número de practicantes. */
export const asesoresDeSolicitud = async (req, res) =>
  responderOk(res, await assignmentService.asesoresDeSolicitud(req.params.id, req.query));

/** Confirmar y asignar. */
export const asignar = async (req, res) =>
  responderOk(res, await assignmentService.confirmarSolicitud(req.params.id, req.body, construirContexto(req)));

/** Rechazar la solicitud. */
export const rechazar = async (req, res) =>
  responderOk(res, await assignmentService.rechazarSolicitud(req.params.id, req.body, construirContexto(req)));

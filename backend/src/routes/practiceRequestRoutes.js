/**
 * Rutas de solicitudes de práctica del estudiante (flujo v2). Se montan en la raíz de la API
 * porque incluyen /me/practice-trajectory además de /practice-requests.
 */
import { Router } from "express";
import * as controller from "../controllers/practiceRequestController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import {
  asesoresSolicitudQuery, asignarSolicitudBody, crearSolicitudBody, elegirPlazaBody,
  listarSolicitudesQuery, rechazarSolicitudBody,
} from "../validators/practiceRequestSchemas.js";

const router = Router();
const estudiante = [authenticate, authorize(ROLES.ESTUDIANTE)];
const director = [authenticate, authorize(ROLES.DIRECTOR_PROGRAMA)];
const estudianteODirector = [authenticate, authorize(ROLES.ESTUDIANTE, ROLES.DIRECTOR_PROGRAMA)];

// GET /me/practice-trajectory: niveles hechos, nivel propuesto y solicitud abierta.
router.get("/me/practice-trajectory", estudiante, asyncHandler(controller.trayectoria));
// POST /practice-requests: crea el borrador del nivel propuesto.
router.post("/practice-requests", estudiante, validar({ body: crearSolicitudBody }), asyncHandler(controller.crear));
// POST /practice-requests/:id/submit: envía la solicitud a Dirección.
router.post("/practice-requests/:id/submit", estudiante, validar({ params: idParamSchema }), asyncHandler(controller.enviar));
// DELETE /practice-requests/:id: descarta el borrador.
router.delete("/practice-requests/:id", estudiante, validar({ params: idParamSchema }), asyncHandler(controller.descartar));

// GET /practice-requests/available-sites: instituciones con convenio vigente para elegir plaza.
router.get("/practice-requests/available-sites", estudianteODirector, asyncHandler(controller.plazasDisponibles));
// PATCH /practice-requests/:id/site: el estudiante elige su plaza (con los documentos ya aprobados).
router.patch("/practice-requests/:id/site", estudiante, validar({ params: idParamSchema, body: elegirPlazaBody }), asyncHandler(controller.elegirPlaza));

// GET /practice-requests: bandeja de solicitudes del Director.
router.get("/practice-requests", director, validar({ query: listarSolicitudesQuery }), asyncHandler(controller.listarSolicitudes));
// GET /practice-requests/:id/advisors: docente del nivel y asesores de la institución con su número de practicantes.
router.get("/practice-requests/:id/advisors", director, validar({ params: idParamSchema, query: asesoresSolicitudQuery }), asyncHandler(controller.asesoresDeSolicitud));
// POST /practice-requests/:id/assign: "Confirmar y asignar" (la práctica pasa a ACTIVA).
router.post("/practice-requests/:id/assign", director, validar({ params: idParamSchema, body: asignarSolicitudBody }), asyncHandler(controller.asignar));
// POST /practice-requests/:id/reject: rechaza la solicitud con motivo.
router.post("/practice-requests/:id/reject", director, validar({ params: idParamSchema, body: rechazarSolicitudBody }), asyncHandler(controller.rechazar));

export default router;

/**
 * Rutas del dashboard: indicadores y tabla de seguimiento según el rol activo.
 */
import { Router } from "express";
import * as controller from "../controllers/dashboardController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { LISTA_ROLES, ROLES } from "../utils/constants.js";
import { listarPracticasDashboardQuery, resumenDashboardQuery } from "../validators/dashboardSchemas.js";

/** Vistas generales por rol (Vista general, Mis tutorías, Mis practicantes, Mi práctica). Se monta en /dashboard. */
const router = Router();

router.use(authenticate, authorize(...LISTA_ROLES));

// Tarjetas de resumen.
router.get("/", validar({ query: resumenDashboardQuery }), asyncHandler(controller.resumen));
// Tarjetas de acción inmediata: solo Director y Docente.
router.get("/actions", authorize(ROLES.DIRECTOR_PROGRAMA, ROLES.DOCENTE_SUPERVISOR), validar({ query: resumenDashboardQuery }), asyncHandler(controller.acciones));
// Niveles que atiende el docente en el periodo (estudiantes, guía y cuestionario): base de «Mi grupo de práctica».
router.get("/levels", authorize(ROLES.DOCENTE_SUPERVISOR), validar({ query: resumenDashboardQuery }), asyncHandler(controller.misNiveles));
// Tabla de prácticas con filtros.
router.get("/practices", validar({ query: listarPracticasDashboardQuery }), asyncHandler(controller.listarPracticas));

export default router;

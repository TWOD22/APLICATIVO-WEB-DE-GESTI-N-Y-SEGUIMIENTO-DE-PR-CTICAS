/**
 * Rutas del dashboard: indicadores y tabla de seguimiento según el rol activo.
 */
import { Router } from "express";
import * as controller from "../controllers/dashboardController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { LISTA_ROLES } from "../utils/constants.js";
import { listarPracticasDashboardQuery, resumenDashboardQuery } from "../validators/dashboardSchemas.js";

/** Vistas generales por rol (Vista general, Mis tutorías, Mis practicantes, Mi práctica). Se monta en /dashboard. */
const router = Router();

router.use(authenticate, authorize(...LISTA_ROLES));

// Tarjetas de resumen.
router.get("/", validar({ query: resumenDashboardQuery }), asyncHandler(controller.resumen));
// Tabla de prácticas con filtros.
router.get("/practices", validar({ query: listarPracticasDashboardQuery }), asyncHandler(controller.listarPracticas));

export default router;

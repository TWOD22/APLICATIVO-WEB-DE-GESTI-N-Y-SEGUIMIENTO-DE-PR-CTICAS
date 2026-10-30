/** Rutas de reportes de gestión (MEN/CNA). Solo el Director de Programa. */
import { Router } from "express";
import * as controller from "../controllers/reportController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../utils/constants.js";
import { reporteQuery } from "../validators/reportSchemas.js";

const router = Router();
router.use(authenticate, authorize(ROLES.DIRECTOR_PROGRAMA));
router.get("/summary", validar({ query: reporteQuery }), asyncHandler(controller.resumen));
router.get("/practices.csv", validar({ query: reporteQuery }), asyncHandler(controller.detalleCsv));
router.get("/summary.pdf", validar({ query: reporteQuery }), asyncHandler(controller.resumenPdf));

export default router;

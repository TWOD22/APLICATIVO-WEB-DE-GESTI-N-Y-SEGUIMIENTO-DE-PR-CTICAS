/**
 * Rutas de catálogos académicos: programas, periodos y niveles de práctica.
 */
import { Router } from "express";
import * as controller from "../controllers/periodController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { LISTA_ROLES } from "../utils/constants.js";
import { listarNivelesQuery } from "../validators/periodSchemas.js";

const router = Router();
// Catálogos de lectura: cualquier rol activo autenticado.
const lectura = [authenticate, authorize(...LISTA_ROLES)];

// Programas.
router.get("/programs", lectura, asyncHandler(controller.listarProgramas));
// Periodos académicos.
router.get("/periods", lectura, asyncHandler(controller.listarPeriodos));
// Niveles de práctica.
router.get("/practice-levels", lectura, validar({ query: listarNivelesQuery }), asyncHandler(controller.listarNiveles));

export default router;

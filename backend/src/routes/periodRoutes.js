/**
 * Rutas de catálogos académicos: programas, periodos y niveles de práctica.
 */
import { Router } from "express";
import * as controller from "../controllers/periodController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { LISTA_ROLES, ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import { activarPeriodoBody, cerrarPeriodoBody, crearPeriodoBody, listarNivelesQuery } from "../validators/periodSchemas.js";

const router = Router();
// Catálogos de lectura: cualquier rol activo autenticado.
const lectura = [authenticate, authorize(...LISTA_ROLES)];

// Programas.
router.get("/programs", lectura, asyncHandler(controller.listarProgramas));
// Periodos académicos.
router.get("/periods", lectura, asyncHandler(controller.listarPeriodos));
// Ciclo de vida del periodo: solo el Director.
const director = [authenticate, authorize(ROLES.DIRECTOR_PROGRAMA)];
router.post("/periods", director, validar({ body: crearPeriodoBody }), asyncHandler(controller.crearPeriodo));
router.get("/periods/:id/closing-summary", director, validar({ params: idParamSchema }), asyncHandler(controller.resumenDeCierre));
router.post("/periods/:id/activate", director, validar({ params: idParamSchema, body: activarPeriodoBody }), asyncHandler(controller.activarPeriodo));
router.post("/periods/:id/close", director, validar({ params: idParamSchema, body: cerrarPeriodoBody }), asyncHandler(controller.cerrarPeriodo));
// Niveles de práctica.
router.get("/practice-levels", lectura, validar({ query: listarNivelesQuery }), asyncHandler(controller.listarNiveles));

export default router;

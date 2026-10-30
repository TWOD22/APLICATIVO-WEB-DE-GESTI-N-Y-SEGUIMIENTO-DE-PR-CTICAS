/**
 * Rutas de docentes por nivel de práctica. Solo el Director de Programa.
 */
import { Router } from "express";
import * as controller from "../controllers/levelTeacherController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../utils/constants.js";
import { definirDocenteNivelBody, listarDocentesNivelQuery, nivelParamSchema } from "../validators/levelTeacherSchemas.js";

const router = Router();
router.use(authenticate, authorize(ROLES.DIRECTOR_PROGRAMA));

// GET /level-teachers: niveles con su docente en el periodo.
router.get("/", validar({ query: listarDocentesNivelQuery }), asyncHandler(controller.listar));
// PUT /level-teachers/:nivelId: define (o quita con docente_id null) el docente del nivel.
router.put("/:nivelId", validar({ params: nivelParamSchema, body: definirDocenteNivelBody }), asyncHandler(controller.definir));

export default router;

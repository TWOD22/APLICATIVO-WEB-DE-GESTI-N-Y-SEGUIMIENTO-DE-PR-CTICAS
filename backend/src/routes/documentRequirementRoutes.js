/** Rutas de la configuración de documentos legales. Solo el Director de Programa. */
import { Router } from "express";
import * as controller from "../controllers/documentRequirementController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import { actualizarTipoBody, crearTipoBody, definirNivelesBody } from "../validators/documentRequirementSchemas.js";

const router = Router();
router.use(authenticate, authorize(ROLES.DIRECTOR_PROGRAMA));
router.get("/", asyncHandler(controller.listar));
router.post("/types", validar({ body: crearTipoBody }), asyncHandler(controller.crearTipo));
router.patch("/types/:id", validar({ params: idParamSchema, body: actualizarTipoBody }), asyncHandler(controller.actualizarTipo));
router.put("/types/:id/levels", validar({ params: idParamSchema, body: definirNivelesBody }), asyncHandler(controller.definirNiveles));

export default router;

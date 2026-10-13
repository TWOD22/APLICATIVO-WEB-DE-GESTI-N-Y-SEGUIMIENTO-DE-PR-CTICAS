/**
 * Rutas de notificaciones del usuario autenticado.
 */
import { Router } from "express";
import * as controller from "../controllers/notificationController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { LISTA_ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import { listarNotificacionesQuery } from "../validators/notificationSchemas.js";

/** Bandeja de notificaciones del usuario autenticado (cualquier rol). Se monta en /notifications. */
const router = Router();

router.use(authenticate, authorize(...LISTA_ROLES));

// Bandeja de notificaciones.
router.get("/", validar({ query: listarNotificacionesQuery }), asyncHandler(controller.listar));
// Marcar todas como leídas.
router.patch("/read-all", asyncHandler(controller.marcarTodasLeidas));
// Marcar una como leída.
router.patch("/:id/read", validar({ params: idParamSchema }), asyncHandler(controller.marcarLeida));

export default router;

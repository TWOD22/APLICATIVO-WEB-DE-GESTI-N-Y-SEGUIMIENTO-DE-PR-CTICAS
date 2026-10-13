/**
 * Rutas de gestión de usuarios. Solo el Director de Programa.
 */
import { Router } from "express";
import * as controller from "../controllers/userController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import {
  actualizarUsuarioBody, cambiarEstadoUsuarioBody, crearUsuarioBody, listarUsuariosQuery,
} from "../validators/userSchemas.js";

const router = Router();
router.use(authenticate, authorize(ROLES.DIRECTOR_PROGRAMA));

// GET /users: listado con filtros y paginación.
router.get("/", validar({ query: listarUsuariosQuery }), asyncHandler(controller.listar));
// POST /users: alta de usuario (se crea en PostgreSQL y en Firebase).
router.post("/", validar({ body: crearUsuarioBody }), asyncHandler(controller.crear));
// GET /users/:id: detalle del usuario.
router.get("/:id", validar({ params: idParamSchema }), asyncHandler(controller.obtener));
// PATCH /users/:id: edición de datos y roles.
router.patch("/:id", validar({ params: idParamSchema, body: actualizarUsuarioBody }), asyncHandler(controller.actualizar));
// PATCH /users/:id/status: activar, inactivar o suspender.
router.patch("/:id/status", validar({ params: idParamSchema, body: cambiarEstadoUsuarioBody }), asyncHandler(controller.cambiarEstado));
// GET /users/:id/practices: prácticas del usuario.
router.get("/:id/practices", validar({ params: idParamSchema }), asyncHandler(controller.listarPracticas));

export default router;

/**
 * Rutas de sesión y perfil propio (/me).
 * Son las primeras que consume el frontend tras iniciar sesión en Firebase.
 */
import { Router } from "express";
import * as controller from "../controllers/authController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { actualizarPerfilPropioBody, cambiarRolActivoBody } from "../validators/userSchemas.js";

const router = Router();

// Sesión: no exigen rol activo para que el usuario con varios roles pueda elegir contexto.
// GET /me: datos del usuario autenticado, sus roles y el rol activo.
router.get("/me", authenticate, asyncHandler(controller.obtenerSesion));
// PATCH /me: el usuario edita su propio perfil (campos permitidos).
router.patch("/me", authenticate, validar({ body: actualizarPerfilPropioBody }), asyncHandler(controller.actualizarMiPerfil));
// POST /me/active-role: cambia el rol con el que actúa quien tiene varios.
router.post("/me/active-role", authenticate, validar({ body: cambiarRolActivoBody }), asyncHandler(controller.cambiarRolActivo));
// POST /auth/logout-all: cierra la sesión en todos los dispositivos (revoca tokens).
router.post("/auth/logout-all", authenticate, asyncHandler(controller.cerrarTodasLasSesiones));

export default router;

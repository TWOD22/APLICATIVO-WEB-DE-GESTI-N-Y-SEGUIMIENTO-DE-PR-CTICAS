/**
 * Rutas de cuestionarios y preguntas (configuración del Director).
 */
import { Router } from "express";
import * as controller from "../controllers/questionnaireController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import {
  actualizarCuestionarioBody, actualizarPreguntaBody, crearCuestionarioBody, crearPreguntaBody,
  habilitarBody, listarCuestionariosQuery, reordenarBody,
} from "../validators/questionnaireSchemas.js";

/** Cuestionarios por nivel: solo Dirección los configura. Este router se monta en la raíz (no usa router.use(authenticate)). */
const router = Router();
const director = [authenticate, authorize(ROLES.DIRECTOR_PROGRAMA)];

// Listar cuestionarios.
router.get("/questionnaires", ...director, validar({ query: listarCuestionariosQuery }), asyncHandler(controller.listar));
// Crear cuestionario.
router.post("/questionnaires", ...director, validar({ body: crearCuestionarioBody }), asyncHandler(controller.crear));
// Detalle con sus preguntas.
router.get("/questionnaires/:id", ...director, validar({ params: idParamSchema }), asyncHandler(controller.obtener));
// Editar datos del cuestionario.
router.patch("/questionnaires/:id", ...director, validar({ params: idParamSchema, body: actualizarCuestionarioBody }), asyncHandler(controller.actualizar));
// Publicar (queda congelado para las bitácoras).
router.post("/questionnaires/:id/publish", ...director, validar({ params: idParamSchema }), asyncHandler(controller.publicar));
// Habilitar o deshabilitar.
router.patch("/questionnaires/:id/enabled", ...director, validar({ params: idParamSchema, body: habilitarBody }), asyncHandler(controller.cambiarHabilitado));
// Agregar pregunta.
router.post("/questionnaires/:id/questions", ...director, validar({ params: idParamSchema, body: crearPreguntaBody }), asyncHandler(controller.agregarPregunta));
// Reordenar preguntas.
router.post("/questionnaires/:id/reorder", ...director, validar({ params: idParamSchema, body: reordenarBody }), asyncHandler(controller.reordenar));

// Editar pregunta.
router.patch("/questions/:id", ...director, validar({ params: idParamSchema, body: actualizarPreguntaBody }), asyncHandler(controller.actualizarPregunta));
// Eliminar pregunta.
router.delete("/questions/:id", ...director, validar({ params: idParamSchema }), asyncHandler(controller.eliminarPregunta));

export default router;

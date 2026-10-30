/**
 * Rutas de cuestionarios y preguntas (configuración del docente del nivel; Dirección consulta).
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

/**
 * Cuestionarios por nivel (flujo v2): los configura el docente asignado a ese nivel en el periodo activo; Dirección y
 * los docentes consultan. El servicio valida el nivel del docente. Este router se monta en la raíz (no usa router.use(authenticate)).
 */
const router = Router();
const consulta = [authenticate, authorize(ROLES.DIRECTOR_PROGRAMA, ROLES.DOCENTE_SUPERVISOR)];
const docente = [authenticate, authorize(ROLES.DOCENTE_SUPERVISOR)];

// Listar cuestionarios.
router.get("/questionnaires", ...consulta, validar({ query: listarCuestionariosQuery }), asyncHandler(controller.listar));
// Crear cuestionario.
router.post("/questionnaires", ...docente, validar({ body: crearCuestionarioBody }), asyncHandler(controller.crear));
// Detalle con sus preguntas.
router.get("/questionnaires/:id", ...consulta, validar({ params: idParamSchema }), asyncHandler(controller.obtener));
// Editar datos del cuestionario.
router.patch("/questionnaires/:id", ...docente, validar({ params: idParamSchema, body: actualizarCuestionarioBody }), asyncHandler(controller.actualizar));
// Efecto de publicar: bitácoras que lo recibirán y las que conservan su versión.
router.get("/questionnaires/:id/publish-impact", ...docente, validar({ params: idParamSchema }), asyncHandler(controller.impactoDePublicar));
// Publicar (queda congelado para las bitácoras).
router.post("/questionnaires/:id/publish", ...docente, validar({ params: idParamSchema }), asyncHandler(controller.publicar));
// Habilitar o deshabilitar.
router.patch("/questionnaires/:id/enabled", ...docente, validar({ params: idParamSchema, body: habilitarBody }), asyncHandler(controller.cambiarHabilitado));
// Agregar pregunta.
router.post("/questionnaires/:id/questions", ...docente, validar({ params: idParamSchema, body: crearPreguntaBody }), asyncHandler(controller.agregarPregunta));
// Reordenar preguntas.
router.post("/questionnaires/:id/reorder", ...docente, validar({ params: idParamSchema, body: reordenarBody }), asyncHandler(controller.reordenar));

// Editar pregunta.
router.patch("/questions/:id", ...docente, validar({ params: idParamSchema, body: actualizarPreguntaBody }), asyncHandler(controller.actualizarPregunta));
// Eliminar pregunta.
router.delete("/questions/:id", ...docente, validar({ params: idParamSchema }), asyncHandler(controller.eliminarPregunta));

export default router;

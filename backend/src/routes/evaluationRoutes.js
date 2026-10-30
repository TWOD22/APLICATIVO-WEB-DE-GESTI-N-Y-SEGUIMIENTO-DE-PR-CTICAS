/**
 * Rutas de evaluaciones. Docente y Asesor evalúan de forma independiente (no hay promedio automático).
 */
import { Router } from "express";
import * as controller from "../controllers/evaluationController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { LISTA_ROLES, ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import {
  borradorEvaluacionBody, listarEvaluacionesQuery, publicarEvaluacionBody, corregirEvaluacionBody,
} from "../validators/evaluationSchemas.js";

/**
 * Evaluaciones. Docente y asesor evalúan de forma independiente (sin promedio); Cada evaluador corrige su propia nota;
 * Dirección consulta y finaliza la práctica; el estudiante solo ve lo publicado. Se monta en la raíz (como
 * documentos y bitácoras), por eso autentica en cada ruta.
 */
const router = Router();

const todos = [authenticate, authorize(...LISTA_ROLES)]; // el alcance de datos lo aplica el servicio según el rol activo
const evaluador = [authenticate, authorize(ROLES.DOCENTE_SUPERVISOR, ROLES.ASESOR_SITIO)];
const director = [authenticate, authorize(ROLES.DIRECTOR_PROGRAMA)];

// Listado de evaluaciones según el rol.
router.get("/evaluations", ...todos, validar({ query: listarEvaluacionesQuery }), asyncHandler(controller.listar));
// Detalle de una evaluación.
router.get("/evaluations/:id", ...todos, validar({ params: idParamSchema }), asyncHandler(controller.obtener));
// Guarda borrador de nota y comentarios.
router.put("/evaluations/:id/draft", ...evaluador, validar({ params: idParamSchema, body: borradorEvaluacionBody }), asyncHandler(controller.guardarBorrador));
// Publica la evaluación (queda cerrada).
router.post("/evaluations/:id/publish", ...evaluador, validar({ params: idParamSchema, body: publicarEvaluacionBody }), asyncHandler(controller.publicar));
// El evaluador corrige su propia nota publicada (con motivo); queda historial de versiones.
router.post("/evaluations/:id/correct", ...evaluador, validar({ params: idParamSchema, body: corregirEvaluacionBody }), asyncHandler(controller.corregir));

// Cierre de la práctica (guía 12: POST /practice-assignments/:id/finish).
// Cierra la práctica cuando ambas evaluaciones están publicadas.
router.post("/practice-assignments/:id/finish", ...director, validar({ params: idParamSchema }), asyncHandler(controller.finalizarPractica));

export default router;

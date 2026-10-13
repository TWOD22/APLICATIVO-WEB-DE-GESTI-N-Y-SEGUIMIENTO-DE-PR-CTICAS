/**
 * Rutas de documentos legales: carga del estudiante y revisión del Director.
 */
import express from "express";
import { Router } from "express";
import * as controller from "../controllers/documentController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import {
  asignacionParams, asignacionTipoParams, listarExpedientesQuery, revisarDocumentoBody,
} from "../validators/documentSchemas.js";

/**
 * Documentos legales. Solo Director y Estudiante: docentes y asesores NO tienen acceso al expediente.
 * No se usa router.use(authenticate): este router se monta en la raíz y no debe autenticar rutas ajenas.
 */
const router = Router();

const director = [authenticate, authorize(ROLES.DIRECTOR_PROGRAMA)];
const estudiante = [authenticate, authorize(ROLES.ESTUDIANTE)];
const directorOEstudiante = [authenticate, authorize(ROLES.DIRECTOR_PROGRAMA, ROLES.ESTUDIANTE)];

// El PDF viaja como cuerpo binario (Content-Type: application/pdf, nombre en X-File-Name).
// El parser se declara DESPUÉS de autenticar para no leer 10 MB de quien no tiene sesión.
const cuerpoPdf = express.raw({ type: "application/pdf", limit: "10mb" });

// Lista los documentos legales de una asignación.
router.get("/practice-assignments/:id/legal-documents", ...directorOEstudiante, validar({ params: asignacionParams }), asyncHandler(controller.listarDeAsignacion));
// Aprueba de una vez todos los documentos (desbloquea la bitácora).
router.post("/practice-assignments/:id/legal-documents/approve-all", ...director, validar({ params: asignacionParams }), asyncHandler(controller.aprobarExpediente));
// El estudiante sube un PDF para un tipo de documento.
router.post("/practice-assignments/:id/legal-documents/:tipoId/upload", ...estudiante, validar({ params: asignacionTipoParams }), cuerpoPdf, asyncHandler(controller.subir));

// "expedientes" debe declararse antes de "/legal-documents/:id/...".
router.get("/legal-documents/expedientes", ...director, validar({ query: listarExpedientesQuery }), asyncHandler(controller.listarExpedientes));
// El Director aprueba o devuelve un documento con observaciones.
router.post("/legal-documents/:id/review", ...director, validar({ params: idParamSchema, body: revisarDocumentoBody }), asyncHandler(controller.revisar));
// Genera una URL temporal para ver/descargar el archivo.
router.get("/legal-documents/:id/download-url", ...directorOEstudiante, validar({ params: idParamSchema }), asyncHandler(controller.urlDeDescarga));

export default router;

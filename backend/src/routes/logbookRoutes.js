/**
 * Rutas de bitácoras: borrador, evidencias, envío, devolución y exportación a PDF.
 */
import express from "express";
import { Router } from "express";
import * as controller from "../controllers/logbookController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { BITACORA, ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import {
  asignacionParams, descripcionEvidenciaBody, devolverBitacoraBody, enviarBitacoraBody,
  evidenciaParams, guardarBorradorBody,
} from "../validators/logbookSchemas.js";

/**
 * Bitácoras. El estudiante las diligencia; Dirección, docente y asesor las consultan (con su alcance).
 * Se monta en la raíz, así que no usa router.use(authenticate).
 */
const router = Router();

const estudiante = [authenticate, authorize(ROLES.ESTUDIANTE)];
const director = [authenticate, authorize(ROLES.DIRECTOR_PROGRAMA)];
const todos = [authenticate, authorize(ROLES.ESTUDIANTE, ROLES.DIRECTOR_PROGRAMA, ROLES.DOCENTE_SUPERVISOR, ROLES.ASESOR_SITIO)];

// Evidencias: cuerpo binario (imagen o PDF) con el nombre en X-File-Name. El parser va DESPUÉS de autenticar.
const cuerpoEvidencia = express.raw({ type: Object.keys(BITACORA.TIPOS_EVIDENCIA), limit: "10mb" });

// Bitácora de una asignación.
router.get("/practice-assignments/:id/logbook", ...todos, validar({ params: asignacionParams }), asyncHandler(controller.obtenerDeAsignacion));
// El estudiante crea la bitácora (requiere documentos aprobados).
router.post("/practice-assignments/:id/logbook", ...estudiante, validar({ params: asignacionParams }), asyncHandler(controller.crearDeAsignacion));

// Detalle de una bitácora.
router.get("/logbooks/:id", ...todos, validar({ params: idParamSchema }), asyncHandler(controller.obtener));
// Autoguardado del borrador.
router.put("/logbooks/:id/draft", ...estudiante, validar({ params: idParamSchema, body: guardarBorradorBody }), asyncHandler(controller.guardarBorrador));
// Exporta la bitácora en PDF.
router.get("/logbooks/:id/export", ...todos, validar({ params: idParamSchema }), asyncHandler(controller.exportar));
// Envío definitivo (ya no se puede editar).
router.post("/logbooks/:id/submit", ...estudiante, validar({ params: idParamSchema, body: enviarBitacoraBody }), asyncHandler(controller.enviar));
// El Director la devuelve al estudiante para corrección.
router.post("/logbooks/:id/return", ...director, validar({ params: idParamSchema, body: devolverBitacoraBody }), asyncHandler(controller.devolver));

// Sube una evidencia (imagen o PDF).
router.post("/logbooks/:id/evidences", ...estudiante, validar({ params: idParamSchema }), cuerpoEvidencia, asyncHandler(controller.subirEvidencia));
// Cambia la descripción de una evidencia.
router.patch("/logbooks/:id/evidences/:evidenciaId", ...estudiante, validar({ params: evidenciaParams, body: descripcionEvidenciaBody }), asyncHandler(controller.actualizarEvidencia));
// Elimina una evidencia.
router.delete("/logbooks/:id/evidences/:evidenciaId", ...estudiante, validar({ params: evidenciaParams }), asyncHandler(controller.eliminarEvidencia));
// URL temporal de la evidencia.
router.get("/logbooks/:id/evidences/:evidenciaId/download-url", ...todos, validar({ params: evidenciaParams }), asyncHandler(controller.urlDeEvidencia));

export default router;

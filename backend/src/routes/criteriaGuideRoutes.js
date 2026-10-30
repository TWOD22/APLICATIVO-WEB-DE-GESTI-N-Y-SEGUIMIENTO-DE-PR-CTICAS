/**
 * Rutas de la guía de criterios (PDF) por nivel y periodo.
 */
import express, { Router } from "express";
import * as controller from "../controllers/criteriaGuideController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { LISTA_ROLES, ROLES } from "../utils/constants.js";
import { guiaParams, versionParams } from "../validators/criteriaGuideSchemas.js";

const router = Router();
const lectores = [authenticate, authorize(...LISTA_ROLES)]; // el servicio aplica el alcance por rol
const docente = [authenticate, authorize(ROLES.DOCENTE_SUPERVISOR)];
// El parser va DESPUÉS de autenticar para no leer 10 MB de quien no tiene sesión.
const cuerpoPdf = express.raw({ type: "application/pdf", limit: "10mb" });

// Guía vigente (URL firmada) y versiones.
router.get("/levels/:nivelId/periods/:periodoId/criteria-guide", ...lectores, validar({ params: guiaParams }), asyncHandler(controller.obtener));
// El docente del nivel sube una versión nueva (cuerpo binario application/pdf, nombre en X-File-Name).
router.post("/levels/:nivelId/periods/:periodoId/criteria-guide", ...docente, validar({ params: guiaParams }), cuerpoPdf, asyncHandler(controller.subir));

// El docente del nivel elige otra versión como vigente o elimina una versión que ya no quiere.
router.post("/levels/:nivelId/periods/:periodoId/criteria-guide/versions/:guiaId/activate", ...docente, validar({ params: versionParams }), asyncHandler(controller.activarVersion));
router.delete("/levels/:nivelId/periods/:periodoId/criteria-guide/versions/:guiaId", ...docente, validar({ params: versionParams }), asyncHandler(controller.eliminarVersion));

export default router;

/**
 * Rutas de instituciones receptoras de práctica. Solo el Director de Programa.
 */
import { Router } from "express";
import * as controller from "../controllers/institutionController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES } from "../utils/constants.js";
import { idParamSchema } from "../validators/commonSchemas.js";
import {
  actualizarInstitucionBody, cambiarEstadoInstitucionBody, crearInstitucionBody,
  listarInstitucionesQuery, personasInstitucionQuery,
} from "../validators/institutionSchemas.js";

const router = Router();
router.use(authenticate, authorize(ROLES.DIRECTOR_PROGRAMA));

// GET /institutions: listado con filtros.
router.get("/", validar({ query: listarInstitucionesQuery }), asyncHandler(controller.listar));
// POST /institutions: registrar institución.
router.post("/", validar({ body: crearInstitucionBody }), asyncHandler(controller.crear));
// GET /institutions/:id: detalle.
router.get("/:id", validar({ params: idParamSchema }), asyncHandler(controller.obtener));
// PATCH /institutions/:id: editar datos.
router.patch("/:id", validar({ params: idParamSchema, body: actualizarInstitucionBody }), asyncHandler(controller.actualizar));
// PATCH /institutions/:id/status: cambiar estado del convenio.
router.patch("/:id/status", validar({ params: idParamSchema, body: cambiarEstadoInstitucionBody }), asyncHandler(controller.cambiarEstado));
// GET /institutions/:id/students: estudiantes en práctica en la institución.
router.get("/:id/students", validar({ params: idParamSchema, query: personasInstitucionQuery }), asyncHandler(controller.listarEstudiantes));
// GET /institutions/:id/advisors: asesores de sitio de la institución.
router.get("/:id/advisors", validar({ params: idParamSchema, query: personasInstitucionQuery }), asyncHandler(controller.listarAsesores));

export default router;

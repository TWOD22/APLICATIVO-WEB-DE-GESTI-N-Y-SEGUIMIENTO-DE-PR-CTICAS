/**
 * Rutas de asignaciones de práctica (estudiante ↔ institución ↔ docente ↔ asesor).
 */
import { Router } from "express";
import * as controller from "../controllers/assignmentController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validar } from "../middlewares/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { LISTA_ROLES, ROLES } from "../utils/constants.js";
import {
  actualizarAsignacionBody, cancelarAsignacionBody, crearAsignacionBody,
  estudiantesSinAsignacionQuery, listarAsignacionesQuery,
} from "../validators/assignmentSchemas.js";
import { idParamSchema } from "../validators/commonSchemas.js";

const router = Router();
router.use(authenticate);

const director = authorize(ROLES.DIRECTOR_PROGRAMA);
const cualquierRol = authorize(...LISTA_ROLES); // el alcance de datos lo aplica el servicio según el rol activo

// Cada rol ve únicamente lo suyo (Director: todo; Docente/Asesor/Estudiante: sus asignaciones).
// GET /practice-assignments: listado (cada rol ve solo lo suyo).
router.get("/", cualquierRol, validar({ query: listarAsignacionesQuery }), asyncHandler(controller.listar));
// Debe declararse antes de "/:id".
router.get(
  "/eligible-students",
  director,
  validar({ query: estudiantesSinAsignacionQuery }),
  asyncHandler(controller.listarEstudiantesSinAsignacion)
);
// POST /practice-assignments: el Director crea una asignación.
router.post("/", director, validar({ body: crearAsignacionBody }), asyncHandler(controller.crear));
// GET /practice-assignments/:id: detalle.
router.get("/:id", cualquierRol, validar({ params: idParamSchema }), asyncHandler(controller.obtener));
// PATCH /practice-assignments/:id: editar la asignación.
router.patch("/:id", director, validar({ params: idParamSchema, body: actualizarAsignacionBody }), asyncHandler(controller.actualizar));
// PATCH /practice-assignments/:id/status: cancelar la asignación.
router.patch("/:id/status", director, validar({ params: idParamSchema, body: cancelarAsignacionBody }), asyncHandler(controller.cancelar));

export default router;

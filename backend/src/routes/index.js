/**
 * Enrutador principal de la API v1.
 * Reúne las rutas de cada módulo. El orden importa: las rutas más específicas se montan antes que las genéricas.
 */
import { Router } from "express";
import authRoutes from "./authRoutes.js";
import userRoutes from "./userRoutes.js";
import institutionRoutes from "./institutionRoutes.js";
import periodRoutes from "./periodRoutes.js";
import assignmentRoutes from "./assignmentRoutes.js";
import documentRoutes from "./documentRoutes.js";
import questionnaireRoutes from "./questionnaireRoutes.js";
import logbookRoutes from "./logbookRoutes.js";
import evaluationRoutes from "./evaluationRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import dashboardRoutes from "./dashboardRoutes.js";

const router = Router();

router.use(authRoutes); // /me, /me/active-role, /auth/logout-all
router.use("/users", userRoutes);
router.use("/institutions", institutionRoutes);
// documentRoutes va ANTES de assignmentRoutes: sus rutas /practice-assignments/:id/legal-documents/* se resuelven
// aquí y evitan autenticar dos veces al pasar por el router de asignaciones.
router.use(documentRoutes);
router.use(questionnaireRoutes); // /questionnaires, /questions
router.use(logbookRoutes); // /logbooks y /practice-assignments/:id/logbook (antes que assignmentRoutes, igual que documentos)
router.use(evaluationRoutes); // /evaluations y /practice-assignments/:id/finish (antes que assignmentRoutes)
router.use("/notifications", notificationRoutes); // bandeja del usuario autenticado
router.use("/dashboard", dashboardRoutes); // indicadores y tabla de seguimiento por rol
router.use("/practice-assignments", assignmentRoutes);
router.use(periodRoutes); // /programs, /periods, /practice-levels

export default router;

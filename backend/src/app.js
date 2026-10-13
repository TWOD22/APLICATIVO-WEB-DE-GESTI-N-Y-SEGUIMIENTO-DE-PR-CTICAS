/**
 * Aplicación Express del backend.
 * Configura las capas de seguridad (helmet, CORS, límite de peticiones), el análisis de JSON,
 * las sondas de salud (/health y /ready) y monta la API versionada en /api/v1.
 */
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { pool } from "./config/database.js";
import { almacenamientoDisponible } from "./adapters/storageAdapter.js";
import { firebaseConfigurado } from "./config/firebase.js";
import { supabaseConfigurado } from "./config/supabase.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import { limitadorGeneral } from "./middlewares/rateLimit.js";
import { requestContext } from "./middlewares/requestContext.js";
import routes from "./routes/index.js";
import { asyncHandler } from "./utils/asyncHandler.js";

/** Fábrica de la aplicación Express (separada de server.js para poder probarla sin abrir un puerto). */
export function crearApp() {
  const app = express();
  app.disable("x-powered-by");
  if (env.TRUST_PROXY > 0) app.set("trust proxy", env.TRUST_PROXY);

  // Primero se asigna un identificador a cada petición para poder rastrearla en los logs y en las respuestas.
  app.use(requestContext);
  // Cabeceras HTTP de seguridad (helmet) y política CORS: solo se aceptan los orígenes configurados en FRONTEND_ORIGINS.
  app.use(helmet());
  app.use(
    cors({
      origin(origen, callback) {
        // Sin cabecera Origin (curl, health checks, servidor a servidor) no aplica CORS.
        if (!origen || env.FRONTEND_ORIGINS.includes(origen)) return callback(null, true);
        return callback(Object.assign(new Error("Origen no permitido"), { code: "CORS_ORIGIN_DENIED" }));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Active-Role", "X-Request-Id", "Idempotency-Key", "X-File-Name", "X-Evidence-Description"],
      exposedHeaders: ["X-Request-Id", "Content-Disposition"], // el navegador necesita leer el nombre del PDF exportado
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: env.MAX_JSON_SIZE }));

  // Sondas de operación (fuera del prefijo versionado y sin autenticación).
  app.get("/health", (req, res) => res.json({ data: { status: "ok" }, meta: { request_id: req.id } }));
  app.get(
    "/ready",
    asyncHandler(async (req, res) => {
      const comprobaciones = { postgres: false, firebase: firebaseConfigurado() };
      try {
        await pool.query("SELECT 1");
        comprobaciones.postgres = true;
      } catch {
        comprobaciones.postgres = false;
      }
      // El almacenamiento de archivos solo se exige si está configurado (obligatorio en staging/producción).
      if (supabaseConfigurado()) comprobaciones.almacenamiento = await almacenamientoDisponible();
      const listo = Object.values(comprobaciones).every(Boolean);
      res.status(listo ? 200 : 503).json({
        data: { status: listo ? "ready" : "not_ready", checks: comprobaciones },
        meta: { request_id: req.id },
      });
    })
  );

  // Toda la API de negocio vive bajo /api/v1 y pasa por el limitador de peticiones general.
  app.use("/api/v1", limitadorGeneral, routes);

  // Al final: rutas inexistentes (404) y manejador central de errores, que da un formato uniforme a todas las respuestas de error.
  app.use(notFound);
  app.use(errorHandler);
  return app;
}


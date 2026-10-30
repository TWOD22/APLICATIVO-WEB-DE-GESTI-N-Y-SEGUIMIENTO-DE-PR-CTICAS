/**
 * Aplicación Express del servicio de notificaciones y auditoría.
 *   POST  /events                                      recibe un evento firmado (idempotente por id)
 *   GET   /users/:uid/notifications                    bandeja del usuario
 *   PATCH /users/:uid/notifications/:id/read           marca una como leída
 *   POST  /users/:uid/notifications/read-all           marca todas como leídas
 *   DELETE /users/:uid/notifications/:id               borra una
 *   DELETE /users/:uid/notifications                   borra todas
 *   GET   /health, /ready                              sondas
 * Todo, salvo las sondas, exige la firma HMAC del servicio principal (cabeceras X-Timestamp y X-Signature).
 */
import express from "express";
import { verificar } from "./firma.js";
import { procesarEvento } from "./procesador.js";
import { esquemaSobre } from "./sobre.js";

// Express 4 no captura promesas rechazadas: se envían al manejador de errores.
const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const respuesta = (res, estado, cuerpo) => res.status(estado).json(cuerpo);
const error = (res, estado, code, message, details = []) => respuesta(res, estado, { error: { code, message, details } });

export function crearApp({ almacen, secreto, ahora = () => Math.floor(Date.now() / 1000) }) {
  const app = express();
  app.disable("x-powered-by");
  const cuerpoCrudo = express.raw({ type: "application/json", limit: "1mb" });

  /** Verifica la firma sobre `texto` (el cuerpo o el método y la ruta). */
  const firmaValida = (req, texto) =>
    verificar({ texto, marca: req.get("x-timestamp"), firma: req.get("x-signature"), secreto, ahora: ahora() });
  const exigirFirmaDeConsulta = (req, res, next) =>
    firmaValida(req, `${req.method} ${req.originalUrl}`) ? next() : error(res, 401, "INVALID_SIGNATURE", "Firma inválida o vencida.");

  app.get("/health", (_req, res) => respuesta(res, 200, { data: { status: "ok" } }));
  app.get("/ready", asincrono(async (_req, res) => {
    const listo = await almacen.disponible();
    respuesta(res, listo ? 200 : 503, { data: { status: listo ? "ready" : "not_ready", almacen: almacen.nombre } });
  }));

  app.post("/events", cuerpoCrudo, asincrono(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return error(res, 400, "BODY_REQUIRED", "Envía el evento como application/json.");
    const texto = req.body.toString("utf8");
    if (!firmaValida(req, texto)) return error(res, 401, "INVALID_SIGNATURE", "Firma inválida o vencida.");
    let datos;
    try {
      datos = JSON.parse(texto);
    } catch {
      return error(res, 400, "INVALID_JSON", "El cuerpo no es JSON válido.");
    }
    const parsed = esquemaSobre.safeParse(datos);
    if (!parsed.success) {
      return error(res, 400, "INVALID_EVENT", "El evento no cumple el contrato.", parsed.error.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message })));
    }
    if (req.get("x-event-id") && req.get("x-event-id") !== parsed.data.id) {
      return error(res, 400, "EVENT_ID_MISMATCH", "X-Event-Id no coincide con el id del evento.");
    }
    try {
      const r = await procesarEvento(parsed.data, almacen);
      return respuesta(res, r.duplicado ? 409 : 201, { data: { id: parsed.data.id, duplicado: r.duplicado, auditorias: r.auditorias, notificaciones: r.notificaciones } });
    } catch (e) {
      console.error("Error al procesar el evento", parsed.data.id, e?.message);
      return error(res, 500, "STORE_ERROR", "No se pudo guardar el evento; el emisor debe reintentar.");
    }
  }));

  const aSalida = (n) => ({
    id: n.id, tipo: n.tipo ?? null, titulo: n.titulo ?? "", mensaje: n.mensaje ?? "", ruta_destino: n.ruta_destino ?? null,
    prioridad: n.prioridad ?? "normal", entidad: n.entidad ?? null, leida: Boolean(n.leida),
    fecha: n.fecha ? new Date(n.fecha).toISOString() : null, leida_en: n.leida_en ? new Date(n.leida_en).toISOString() : null,
  });

  app.get("/users/:uid/notifications", exigirFirmaDeConsulta, asincrono(async (req, res) => {
    const filas = await almacen.listarNotificaciones(req.params.uid);
    respuesta(res, 200, { data: filas.map(aSalida) });
  }));
  app.post("/users/:uid/notifications/read-all", exigirFirmaDeConsulta, asincrono(async (req, res) => {
    respuesta(res, 200, { data: { marcadas: await almacen.marcarTodasLeidas(req.params.uid) } });
  }));
  app.patch("/users/:uid/notifications/:id/read", exigirFirmaDeConsulta, asincrono(async (req, res) => {
    const n = await almacen.marcarLeida(req.params.uid, req.params.id);
    if (!n) return error(res, 404, "NOTIFICATION_NOT_FOUND", "La notificación no existe.");
    return respuesta(res, 200, { data: aSalida(n) });
  }));

  app.delete("/users/:uid/notifications/:id", exigirFirmaDeConsulta, asincrono(async (req, res) => {
    if (!(await almacen.eliminarNotificacion(req.params.uid, req.params.id))) return error(res, 404, "NOTIFICATION_NOT_FOUND", "La notificación no existe.");
    return respuesta(res, 200, { data: { eliminada: true } });
  }));
  app.delete("/users/:uid/notifications", exigirFirmaDeConsulta, asincrono(async (req, res) => {
    respuesta(res, 200, { data: { eliminadas: await almacen.eliminarTodasNotificaciones(req.params.uid) } });
  }));

  // Rutas inexistentes y errores no previstos con el mismo formato.
  app.use((_req, res) => error(res, 404, "NOT_FOUND", "Ruta no encontrada."));
  // eslint-disable-next-line no-unused-vars
  app.use((e, _req, res, _next) => {
    if (e?.type === "entity.too.large") return error(res, 413, "PAYLOAD_TOO_LARGE", "El evento es demasiado grande.");
    console.error("Error no controlado", e?.message);
    return error(res, 500, "INTERNAL_ERROR", "Error interno.");
  });
  return app;
}

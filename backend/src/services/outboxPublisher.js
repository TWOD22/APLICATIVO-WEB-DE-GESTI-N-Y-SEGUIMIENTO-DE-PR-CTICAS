/**
 * Publicador del outbox: toma los eventos pendientes y los envía por HTTP firmado al servicio de notificaciones y
 * auditoría. Éxito (2xx, o 409 = ya lo tenía) → PUBLICADO. Fallo → reintento con espera exponencial; al agotar los
 * intentos queda FALLIDO y no se pierde (se puede reencolar). Varios procesos pueden correr a la vez sin duplicar.
 */
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { withTransaction } from "../database/transaction.js";
import * as outboxRepository from "../repositories/outboxRepository.js";
import { firmar } from "../utils/firmaEventos.js";
import { armarSobre } from "./eventService.js";

const TIMEOUT_ENVIO_MS = 5000;

/** Espera antes del siguiente intento: 5 s, 10 s, 20 s… hasta 15 minutos. */
export const esperaSegundos = (intentosHechos) => Math.min(5 * 2 ** Math.max(0, intentosHechos), 900);

async function enviar(fila, { url, secreto, fetchImpl }) {
  const cuerpo = JSON.stringify(armarSobre(fila));
  const marca = String(Math.floor(Date.now() / 1000));
  const respuesta = await fetchImpl(`${url.replace(/\/$/, "")}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Event-Id": fila.id,
      "X-Timestamp": marca,
      "X-Signature": firmar(cuerpo, marca, secreto),
    },
    body: cuerpo,
    signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
  });
  // 409 significa que el servicio ya procesó este evento: cuenta como entregado.
  if (!(respuesta.ok || respuesta.status === 409)) throw new Error(`El servicio respondió ${respuesta.status}`);
}

/**
 * Procesa un lote. Devuelve { enviados, fallidos, definitivos }.
 * La transacción mantiene bloqueadas las filas mientras se envían (lote pequeño, timeout corto).
 */
export async function publicarPendientes({
  url = env.NOTIFICATIONS_SERVICE_URL, secreto = env.EVENTS_SHARED_SECRET,
  lote = env.OUTBOX_BATCH_SIZE, maxIntentos = env.OUTBOX_MAX_ATTEMPTS, fetchImpl = fetch,
} = {}) {
  if (!url || !secreto) throw new Error("Falta NOTIFICATIONS_SERVICE_URL o EVENTS_SHARED_SECRET");
  const resultado = { enviados: 0, fallidos: 0, definitivos: 0 };
  await withTransaction(async (client) => {
    for (const fila of await outboxRepository.reclamarLote(lote, client)) {
      try {
        await enviar(fila, { url, secreto, fetchImpl });
        await outboxRepository.marcarPublicado(fila.id, client);
        resultado.enviados += 1;
      } catch (error) {
        const definitivo = fila.intentos + 1 >= maxIntentos;
        await outboxRepository.marcarFallo(
          fila.id,
          { error: error?.message ?? String(error), esperaSegundos: esperaSegundos(fila.intentos), definitivo },
          client
        );
        resultado.fallidos += 1;
        if (definitivo) resultado.definitivos += 1;
        logger.warn({ evento_id: fila.id, tipo: fila.tipo, intentos: fila.intentos + 1, definitivo, err: error?.message }, "No se pudo enviar el evento");
      }
    }
  });
  return resultado;
}

/** Arranca el publicador periódico. Devuelve una función para detenerlo. */
export function iniciarPublicador({ cadaMs = env.OUTBOX_POLL_MS, ...opciones } = {}) {
  let activo = true;
  let enCurso = false;
  const temporizador = setInterval(async () => {
    if (!activo || enCurso) return;
    enCurso = true;
    try {
      await publicarPendientes(opciones);
    } catch (error) {
      logger.error({ err: error }, "Falló el ciclo del publicador de eventos");
    } finally {
      enCurso = false;
    }
  }, cadaMs);
  temporizador.unref();
  return () => {
    activo = false;
    clearInterval(temporizador);
  };
}

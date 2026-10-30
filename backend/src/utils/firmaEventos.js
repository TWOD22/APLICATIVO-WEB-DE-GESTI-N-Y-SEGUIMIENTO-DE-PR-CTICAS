/**
 * Firma de los eventos que viajan entre servicios: HMAC-SHA256 sobre "<marca de tiempo>.<cuerpo>".
 * El receptor la recalcula con el mismo secreto compartido y rechaza firmas ajenas o mensajes viejos (anti-repetición).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOLERANCIA_SEGUNDOS = 300;

/** Firma hexadecimal del cuerpo con la marca de tiempo (segundos desde 1970). */
export function firmar(cuerpo, marca, secreto) {
  return createHmac("sha256", secreto).update(`${marca}.${cuerpo}`).digest("hex");
}

/** ¿La firma corresponde al cuerpo y la marca está dentro de la tolerancia? Compara en tiempo constante. */
export function verificar({ cuerpo, marca, firma, secreto, ahora = Math.floor(Date.now() / 1000) }) {
  const segundos = Number(marca);
  if (!Number.isFinite(segundos) || Math.abs(ahora - segundos) > TOLERANCIA_SEGUNDOS) return false;
  const esperada = Buffer.from(firmar(cuerpo, marca, secreto), "hex");
  const recibida = Buffer.from(String(firma ?? ""), "hex");
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

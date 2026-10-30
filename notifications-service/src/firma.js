/**
 * Verificación de la firma HMAC-SHA256 que pone el servicio principal: firma de "<marca>.<texto>" con el secreto compartido.
 * Para POST /events el texto es el cuerpo; para las consultas es "<MÉTODO> <ruta con parámetros>".
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOLERANCIA_SEGUNDOS = 300;

export const firmar = (texto, marca, secreto) => createHmac("sha256", secreto).update(`${marca}.${texto}`).digest("hex");

export function verificar({ texto, marca, firma, secreto, ahora = Math.floor(Date.now() / 1000) }) {
  const segundos = Number(marca);
  if (!Number.isFinite(segundos) || Math.abs(ahora - segundos) > TOLERANCIA_SEGUNDOS) return false;
  const esperada = Buffer.from(firmar(texto, marca, secreto), "hex");
  const recibida = Buffer.from(String(firma ?? ""), "hex");
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

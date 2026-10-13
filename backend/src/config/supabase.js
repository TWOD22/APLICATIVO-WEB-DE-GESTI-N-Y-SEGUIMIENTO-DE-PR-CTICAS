/**
 * Acceso a Supabase Storage.
 * Supabase se usa únicamente como almacén privado de archivos (documentos legales, evidencias y PDF).
 * Este módulo construye la petición HTTP autenticada con la clave secreta del servidor.
 */
import { env } from "./env.js";

// Reemplazo de `fetch` usado solo en pruebas para no llamar a Supabase de verdad.
let sustituto = null;

/**
 * Punto de inyección para pruebas automáticas: reemplaza la llamada HTTP a Supabase
 * por una función `fetch` falsa. Solo disponible con NODE_ENV=test.
 */
export function sustituirSupabaseParaPruebas(fetchFalso) {
  if (!env.esTest) throw new Error("sustituirSupabaseParaPruebas solo puede usarse con NODE_ENV=test");
  sustituto = fetchFalso;
}

/** Indica si hay credenciales suficientes para hablar con Supabase Storage. */
export function supabaseConfigurado() {
  if (sustituto) return true;
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY && env.SUPABASE_STORAGE_BUCKET);
}

/**
 * Llamada HTTP a la API de Storage de Supabase con la clave secreta (solo servidor).
 * Las claves nuevas (sb_secret_...) no son JWT: se envían únicamente en `apikey`.
 * Las claves antiguas (service_role, formato JWT) además van en `Authorization`.
 */
export async function solicitudStorage(ruta, { metodo = "GET", cabeceras = {}, cuerpo, tiempoMaximoMs = 15_000 } = {}) {
  const clave = env.SUPABASE_SECRET_KEY;
  const cabecerasFinales = { apikey: clave ?? "", ...cabeceras };
  if (clave?.startsWith("eyJ")) cabecerasFinales.Authorization = `Bearer ${clave}`;
  const ejecutar = sustituto ?? fetch;
  return ejecutar(`${env.SUPABASE_URL}/storage/v1${ruta}`, {
    method: metodo,
    headers: cabecerasFinales,
    body: cuerpo,
    signal: AbortSignal.timeout(tiempoMaximoMs),
  });
}

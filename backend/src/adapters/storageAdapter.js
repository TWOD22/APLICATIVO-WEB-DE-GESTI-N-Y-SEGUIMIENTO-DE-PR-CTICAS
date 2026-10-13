/**
 * Adaptador de Supabase Storage.
 * Sube, descarga, firma y elimina archivos privados. Solo se usa para archivos;
 * la base de datos de la aplicación sigue siendo PostgreSQL.
 */
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { solicitudStorage, supabaseConfigurado } from "../config/supabase.js";
import { ApiError } from "../utils/apiError.js";

/**
 * Almacenamiento de archivos privados en Supabase Storage.
 * En PostgreSQL (tabla `archivos`) solo se guarda bucket + ruta; el archivo vive aquí.
 * Las rutas nunca incluyen datos personales (se usan UUID), y la descarga se hace
 * siempre con URL firmadas de vida corta.
 */

// Implementación alternativa (en memoria) que solo se activa en pruebas automáticas.
let sustituto = null;

/**
 * Punto de inyección para pruebas automáticas: reemplaza el almacenamiento por una
 * implementación en memoria { subirArchivo, crearUrlFirmada, eliminarArchivo, almacenamientoDisponible } (y, opcional, descargarArchivo).
 * Solo disponible con NODE_ENV=test.
 */
export function sustituirAlmacenamientoParaPruebas(implementacion) {
  if (!env.esTest) throw new Error("sustituirAlmacenamientoParaPruebas solo puede usarse con NODE_ENV=test");
  sustituto = implementacion;
}

// Falla con 503 si faltan las credenciales de Supabase en el entorno.
function exigirConfiguracion() {
  if (!supabaseConfigurado()) {
    throw new ApiError({
      codigo: "STORAGE_NOT_CONFIGURED",
      estado_http: 503,
      mensaje: "El servicio de almacenamiento de archivos no está configurado.",
    });
  }
}

// Codifica cada tramo de la ruta para que nombres con espacios o tildes sean válidos en la URL.
const codificarRuta = (ruta) => ruta.split("/").map(encodeURIComponent).join("/");

// Convierte una respuesta fallida del almacenamiento en un error 502 sin exponer detalles internos.
function falloStorage(accion, respuesta) {
  logger.error({ accion, estado_storage: respuesta?.status }, "Fallo del almacenamiento de archivos");
  return new ApiError({
    codigo: "STORAGE_ERROR",
    estado_http: 502,
    mensaje: "No se pudo completar la operación con el almacenamiento de archivos.",
  });
}

/** Sube (o reemplaza) un archivo. `contenido` es un Buffer. Devuelve { bucket, ruta }. */
export async function subirArchivo({ ruta, contenido, tipoMime }) {
  if (sustituto) return sustituto.subirArchivo({ ruta, contenido, tipoMime });
  exigirConfiguracion();
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  let respuesta;
  try {
    respuesta = await solicitudStorage(`/object/${encodeURIComponent(bucket)}/${codificarRuta(ruta)}`, {
      metodo: "POST",
      cabeceras: { "Content-Type": tipoMime, "x-upsert": "false", "cache-control": "max-age=0" },
      cuerpo: contenido,
      tiempoMaximoMs: 60_000,
    });
  } catch (error) {
    logger.error({ err: error }, "No se pudo contactar al almacenamiento de archivos");
    throw falloStorage("subir", null);
  }
  if (!respuesta.ok) throw falloStorage("subir", respuesta);
  return { bucket, ruta };
}

/** URL temporal de lectura. Caduca a los SIGNED_URL_TTL_SECONDS (15 min por defecto). */
export async function crearUrlFirmada(ruta, { segundos = env.SIGNED_URL_TTL_SECONDS } = {}) {
  if (sustituto) return sustituto.crearUrlFirmada(ruta, { segundos });
  exigirConfiguracion();
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  let respuesta;
  try {
    respuesta = await solicitudStorage(`/object/sign/${encodeURIComponent(bucket)}/${codificarRuta(ruta)}`, {
      metodo: "POST",
      cabeceras: { "Content-Type": "application/json" },
      cuerpo: JSON.stringify({ expiresIn: segundos }),
    });
  } catch (error) {
    logger.error({ err: error }, "No se pudo contactar al almacenamiento de archivos");
    throw falloStorage("firmar", null);
  }
  if (!respuesta.ok) throw falloStorage("firmar", respuesta);
  const { signedURL } = await respuesta.json();
  return { url: `${env.SUPABASE_URL}/storage/v1${signedURL}`, expira_en_segundos: segundos };
}

/** Descarga el contenido de un archivo (Buffer). Se usa para incrustar evidencias en el PDF de la bitácora. */
export async function descargarArchivo(ruta) {
  if (sustituto) {
    if (!sustituto.descargarArchivo) throw falloStorage("descargar", null);
    return sustituto.descargarArchivo(ruta);
  }
  exigirConfiguracion();
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  let respuesta;
  try {
    respuesta = await solicitudStorage(`/object/${encodeURIComponent(bucket)}/${codificarRuta(ruta)}`, { tiempoMaximoMs: 30_000 });
  } catch (error) {
    logger.error({ err: error }, "No se pudo contactar al almacenamiento de archivos");
    throw falloStorage("descargar", null);
  }
  if (!respuesta.ok) throw falloStorage("descargar", respuesta);
  return Buffer.from(await respuesta.arrayBuffer());
}

/** Elimina un archivo físico (el borrado lógico en PostgreSQL es responsabilidad del servicio). */
export async function eliminarArchivo(ruta) {
  if (sustituto) return sustituto.eliminarArchivo(ruta);
  exigirConfiguracion();
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  let respuesta;
  try {
    respuesta = await solicitudStorage(`/object/${encodeURIComponent(bucket)}`, {
      metodo: "DELETE",
      cabeceras: { "Content-Type": "application/json" },
      cuerpo: JSON.stringify({ prefixes: [ruta] }),
    });
  } catch (error) {
    logger.error({ err: error }, "No se pudo contactar al almacenamiento de archivos");
    throw falloStorage("eliminar", null);
  }
  if (!respuesta.ok) throw falloStorage("eliminar", respuesta);
}

/** Verifica que el almacenamiento responde (se usa en la sonda /ready). */
/**
 * Sonda para /ready: credenciales presentes y bucket existente y privado.
 * Devuelve true/false sin lanzar y sin registrar secretos.
 */
export async function almacenamientoDisponible() {
  if (sustituto) return sustituto.almacenamientoDisponible();
  if (!supabaseConfigurado()) return false;
  try {
    const respuesta = await solicitudStorage(`/bucket/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}`, {
      tiempoMaximoMs: 4_000,
    });
    if (!respuesta.ok) return false;
    const bucket = await respuesta.json();
    if (bucket?.public === true) {
      logger.error("El bucket de almacenamiento es PÚBLICO: los documentos legales deben ser privados");
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

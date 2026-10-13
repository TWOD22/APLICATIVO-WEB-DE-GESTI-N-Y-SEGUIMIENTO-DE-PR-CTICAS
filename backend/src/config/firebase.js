/**
 * Inicialización de Firebase Admin.
 * Crea (una sola vez) la aplicación de Firebase y expone Auth, Firestore y Storage.
 * Permite sustituir Firebase por una versión en memoria durante las pruebas automáticas.
 */
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { env } from "./env.js";
import { ApiError } from "../utils/apiError.js";

// `aplicacion` guarda la instancia ya creada; `sustituto` es el reemplazo usado solo en pruebas.
let aplicacion = null;
let sustituto = null;

/**
 * Punto de inyección para pruebas automáticas: reemplaza Firebase Admin por una
 * implementación en memoria ({ auth, firestore }). Solo disponible con NODE_ENV=test.
 */
export function sustituirFirebaseParaPruebas(implementacion) {
  if (!env.esTest) throw new Error("sustituirFirebaseParaPruebas solo puede usarse con NODE_ENV=test");
  sustituto = implementacion;
}

// Con los emuladores de Firebase (desarrollo local) no hacen falta credenciales reales.
const usaEmuladores = () =>
  Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST);

/** Indica si hay credenciales (o emuladores) suficientes para usar Firebase Admin. */
export function firebaseConfigurado() {
  if (sustituto) return true;
  if (env.FIREBASE_PROJECT_ID && usaEmuladores()) return true;
  return Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
}

/** Devuelve la aplicación de Firebase Admin, creándola la primera vez. Lanza 503 si falta configuración. */
function obtenerAplicacion() {
  if (aplicacion) return aplicacion;
  if (!firebaseConfigurado()) {
    throw new ApiError({
      codigo: "FIREBASE_NOT_CONFIGURED",
      estado_http: 503,
      mensaje: "El servicio de autenticación no está configurado.",
    });
  }
  if (getApps().length) {
    aplicacion = getApp();
    return aplicacion;
  }
  const opciones = { projectId: env.FIREBASE_PROJECT_ID, storageBucket: env.FIREBASE_STORAGE_BUCKET };
  if (!usaEmuladores()) {
    opciones.credential = cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // Las plataformas de despliegue suelen guardar los saltos de línea escapados.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  }
  aplicacion = initializeApp(opciones);
  return aplicacion;
}

// Accesos directos a cada servicio de Firebase (o a su sustituto en pruebas).
export const obtenerAuth = () => sustituto?.auth ?? getAuth(obtenerAplicacion());
export const obtenerFirestore = () => sustituto?.firestore ?? getFirestore(obtenerAplicacion());
export const obtenerBucket = () => sustituto?.bucket ?? getStorage(obtenerAplicacion()).bucket();
// Marca de tiempo generada por el servidor de Firestore (en pruebas devuelve un valor fijo).
export const marcaDeTiempoServidor = () => (sustituto ? "TS" : FieldValue.serverTimestamp());

/**
 * Firebase Web SDK (solo Authentication). Los valores VITE_FIREBASE_* viven en el archivo .env de la raíz
 * (ver .env.example). La API key web de Firebase es pública: identifica el proyecto, no da acceso por sí sola.
 */
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

/** Lee las variables VITE_FIREBASE_* del entorno de Vite. */
export function getFirebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  };
}

// Instancia única de Auth (se crea la primera vez que se necesita).
let auth = null;

/** Devuelve el servicio de Auth; falla con un mensaje claro si falta la configuración. */
export function getFirebaseAuth() {
  if (auth) return auth;
  const config = getFirebaseConfig();
  if (!config.apiKey || !config.projectId) {
    throw new Error("Falta la configuración de Firebase: crea el archivo .env (ver .env.example) y reinicia el servidor.");
  }
  auth = getAuth(getApps().length ? getApp() : initializeApp(config));
  return auth;
}

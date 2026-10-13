/** Operaciones de Firebase Authentication. No habla con la API (eso lo hace session.js). */
import {
  EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updatePassword,
} from "firebase/auth";
import { getFirebaseAuth } from "../config/firebase.js";

/** Resuelve con el usuario de Firebase (o null) cuando el SDK terminó de restaurar la sesión guardada. */
export function esperarUsuario() {
  return new Promise((resolve) => {
    const cancelar = onAuthStateChanged(getFirebaseAuth(), (usuario) => {
      cancelar();
      resolve(usuario);
    });
  });
}

/** Inicia sesión con correo y contraseña. */
export const iniciarSesionFirebase = (correo, contrasena) =>
  signInWithEmailAndPassword(getFirebaseAuth(), correo.trim(), contrasena);

/** Cierra la sesión de Firebase en este navegador. */
export const cerrarSesionFirebase = () => signOut(getFirebaseAuth());

/**
 * Cambia la contraseña de la persona con sesión iniciada: Firebase exige confirmar la contraseña actual.
 * Al cambiarla, Firebase invalida las sesiones de otros dispositivos; esta se renueva con un token nuevo.
 */
export async function cambiarContrasena(actual, nueva) {
  const usuario = getFirebaseAuth().currentUser ?? (await esperarUsuario());
  if (!usuario?.email) throw Object.assign(new Error("Sin sesión"), { code: "auth/requires-recent-login" });
  await reauthenticateWithCredential(usuario, EmailAuthProvider.credential(usuario.email, actual));
  await updatePassword(usuario, nueva);
  await usuario.getIdToken(true);
}

/** Mensaje claro para el usuario según el error de Firebase al cambiar la contraseña. */
export function mensajeDeCambioContrasena(error) {
  switch (error?.code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "La contraseña actual no es correcta.";
    case "auth/weak-password":
      return "La nueva contraseña es demasiado débil. Usa al menos 8 caracteres, una mayúscula y un número.";
    case "auth/too-many-requests":
      return "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.";
    case "auth/requires-recent-login":
      return "Por seguridad, cierra sesión, vuelve a ingresar e inténtalo de nuevo.";
    case "auth/network-request-failed":
      return "No hay conexión con el servicio de autenticación. Revisa tu internet e inténtalo de nuevo.";
    default:
      return "No fue posible cambiar la contraseña. Inténtalo de nuevo.";
  }
}

/** Envía el correo de recuperación de contraseña. */
export const enviarRecuperacion = (correo) => sendPasswordResetEmail(getFirebaseAuth(), correo.trim());

/** ID Token vigente (el SDK lo renueva solo cuando está por vencer). `forzar` lo pide de nuevo al servidor. */
export async function obtenerIdToken({ forzar = false } = {}) {
  const usuario = getFirebaseAuth().currentUser ?? (await esperarUsuario());
  return usuario ? usuario.getIdToken(forzar) : null;
}

/** Mensaje claro para el usuario según el código de error de Firebase. */
export function mensajeDeFirebase(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "El correo o la contraseña no son correctos.";
    case "auth/user-disabled":
      return "Tu cuenta está deshabilitada. Contacta a la Dirección del Programa.";
    case "auth/too-many-requests":
      return "Demasiados intentos fallidos. Espera unos minutos o restablece tu contraseña.";
    case "auth/network-request-failed":
      return "No hay conexión con el servicio de autenticación. Revisa tu internet e inténtalo de nuevo.";
    default:
      return error?.message?.startsWith("Falta la configuración") ? error.message : "No fue posible iniciar sesión. Inténtalo de nuevo.";
  }
}

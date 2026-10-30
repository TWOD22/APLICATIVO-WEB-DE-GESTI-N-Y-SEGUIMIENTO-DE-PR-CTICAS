/**
 * Controlador de la pantalla de inicio de sesión.
 * Autentica con Firebase (correo y contraseña), consulta al backend los roles de la persona y la lleva a su panel
 * (cada persona tiene un solo rol). También permite recuperar la contraseña.
 */
import { cerrarSesionFirebase, enviarRecuperacion, esperarUsuario, iniciarSesionFirebase, mensajeDeFirebase } from "../services/auth.js";
import { guardarRolActivo } from "../services/api.js";
import { cargarPerfil, dashboardDe, PAGINA_DE_ROL } from "../services/session.js";

// Elementos de la página que usa el controlador.
const formulario = document.querySelector("#login-form");
const campoCorreo = formulario?.elements.email;
const boton = formulario?.querySelector("button[type=submit]");
const error = document.querySelector("#login-error");

/** Muestra u oculta el mensaje de error del formulario. */
function mostrarError(texto) {
  error.textContent = texto;
  error.hidden = !texto;
}

/** Deshabilita el botón y muestra "Ingresando…" mientras se procesa el ingreso. */
function ocupado(activo) {
  boton.disabled = activo;
  boton.dataset.textoOriginal ??= boton.innerHTML;
  boton.innerHTML = activo ? "Ingresando…" : boton.dataset.textoOriginal;
}

// Redirige al panel principal del rol.
const irAlPanel = (rol) => window.location.assign(dashboardDe(PAGINA_DE_ROL[rol]));

/** Cada persona tiene un solo rol: entra directo a su panel. */
function continuarConPerfil(perfil) {
  if (perfil.roles.length !== 1) throw new Error("Tu cuenta no tiene un único rol asignado. Contacta a la Dirección del Programa.");
  guardarRolActivo(perfil.roles[0].codigo);
  irAlPanel(perfil.roles[0].codigo);
}

// Envío del formulario: 1) inicia sesión en Firebase; 2) consulta /me para saber si el sistema acepta la cuenta.
formulario?.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  mostrarError("");
  ocupado(true);
  try {
    await iniciarSesionFirebase(formulario.elements.email.value, formulario.elements.password.value);
  } catch (e) {
    mostrarError(mensajeDeFirebase(e));
    ocupado(false);
    return;
  }
  try {
    continuarConPerfil(await cargarPerfil(null));
  } catch (e) {
    // Autenticó en Firebase pero el sistema no la acepta (no registrada, deshabilitada, sin rol) o el servidor no responde.
    await cerrarSesionFirebase().catch(() => {});
    mostrarError(e.message);
    ocupado(false);
  }
});

// "Olvidé mi contraseña": envía el correo de recuperación (sin revelar si el correo existe).
document.querySelector("#forgot-password")?.addEventListener("click", async () => {
  mostrarError("");
  if (!campoCorreo.value.trim() || !campoCorreo.checkValidity()) {
    mostrarError("Escribe tu correo institucional para enviarte el enlace de recuperación.");
    campoCorreo.focus();
    return;
  }
  try {
    await enviarRecuperacion(campoCorreo.value);
  } catch (e) {
    if (e?.code === "auth/network-request-failed") return mostrarError(mensajeDeFirebase(e));
    // Por seguridad no se revela si el correo existe: se responde igual.
  }
  error.textContent = "Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña.";
  error.hidden = false;
});

// Mensaje dejado por la guardia de sesión (cuenta no registrada o deshabilitada).
try {
  const mensaje = sessionStorage.getItem("mensajeLogin");
  if (mensaje) {
    sessionStorage.removeItem("mensajeLogin");
    mostrarError(mensaje);
  }
} catch { /* sin almacenamiento */ }

// Si ya hay una sesión de Firebase válida, se continúa sin pedir la contraseña otra vez.
(async () => {
  try {
    if (!error.hidden) return; // vino por un rechazo: no reintentar
    const usuario = await esperarUsuario();
    if (usuario) continuarConPerfil(await cargarPerfil(null));
  } catch { /* se queda en el formulario */ }
})();

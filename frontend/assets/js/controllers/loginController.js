/**
 * Controlador de la pantalla de inicio de sesión.
 * Autentica con Firebase (correo y contraseña), consulta al backend los roles de la persona y la lleva a su panel
 * (o le pide elegir un rol si tiene varios). También permite recuperar la contraseña.
 */
import { cerrarSesionFirebase, enviarRecuperacion, esperarUsuario, iniciarSesionFirebase, mensajeDeFirebase } from "../services/auth.js";
import { guardarRolActivo } from "../services/api.js";
import { cargarPerfil, dashboardDe, elegirRol, NOMBRE_DE_ROL, PAGINA_DE_ROL } from "../services/session.js";

// Elementos de la página que usa el controlador.
const formulario = document.querySelector("#login-form");
const campoCorreo = formulario?.elements.email;
const boton = formulario?.querySelector("button[type=submit]");
const error = document.querySelector("#login-error");
const selector = document.querySelector("#role-picker");

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

/** Con un solo rol entra directo; con varios, pide elegir el contexto de trabajo. */
function continuarConPerfil(perfil) {
  if (perfil.roles.length === 1) {
    guardarRolActivo(perfil.roles[0].codigo);
    irAlPanel(perfil.roles[0].codigo);
    return;
  }
  formulario.hidden = true;
  selector.hidden = false;
  selector.querySelector("[data-opciones]").replaceChildren(
    ...perfil.roles.map(({ codigo }) => {
      const opcion = document.createElement("button");
      opcion.type = "button";
      opcion.className = "btn btn-secondary btn-block";
      opcion.textContent = NOMBRE_DE_ROL[PAGINA_DE_ROL[codigo]] ?? codigo;
      opcion.addEventListener("click", async () => {
        opcion.disabled = true;
        try {
          await elegirRol(codigo);
          irAlPanel(codigo);
        } catch (e) {
          opcion.disabled = false;
          selector.querySelector("[data-error]").textContent = e.message;
        }
      });
      return opcion;
    })
  );
  selector.querySelector("[data-nombre]").textContent = perfil.usuario.nombres;
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

// Botón "Volver" del selector de rol: cierra la sesión de Firebase y vuelve al formulario.
document.querySelector("#role-picker-back")?.addEventListener("click", async () => {
  await cerrarSesionFirebase().catch(() => {});
  guardarRolActivo(null);
  selector.hidden = true;
  formulario.hidden = false;
  ocupado(false);
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

/**
 * "Mi cuenta" (todos los roles) conectada al API real: edición de nombre y teléfono (PATCH /me) y cambio de
 * contraseña con Firebase Authentication. El correo y el documento no se pueden modificar desde aquí.
 */
import { api } from "../services/api.js";
import { cambiarContrasena, mensajeDeCambioContrasena } from "../services/auth.js";

// Une el mensaje del error con los detalles de validación del servidor.
const mensajeDeError = (error) => {
  const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => `${d.campo ? `${d.campo}: ` : ""}${d.mensaje}`) : [];
  return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
};

/**
 * Conecta la pantalla "Mi cuenta".
 * @param {object} opciones { session, initials, showToast }: sesión actual y utilidades de interfaz.
 */
export function montarCuenta({ session, initials, showToast }) {
  const formPerfil = document.querySelector("#account-profile-form");
  const formClave = document.querySelector("#password-form");

  // ───────────── Perfil ─────────────
  if (formPerfil) {
    const aviso = formPerfil.querySelector("[data-account-error]");
    formPerfil.addEventListener("submit", async (e) => {
      e.preventDefault();
      aviso.hidden = true;
      const f = new FormData(formPerfil);
      const nuevo = { nombres: f.get("nombres").trim(), apellidos: f.get("apellidos").trim(), telefono: f.get("telefono").trim() };
      const actual = { nombres: session.usuario.nombres, apellidos: session.usuario.apellidos, telefono: session.usuario.telefono || "" };
      const cambios = {};
      for (const [campo, valor] of Object.entries(nuevo)) if (valor !== actual[campo]) cambios[campo] = valor;
      if (!nuevo.nombres || !nuevo.apellidos) { aviso.textContent = "Escribe tus nombres y apellidos."; aviso.hidden = false; return; }
      if (!Object.keys(cambios).length) { showToast("No hay cambios para guardar"); return; }
      const boton = formPerfil.querySelector("[type=submit]");
      boton.disabled = true;
      try {
        const { data } = await api.patch("/me", cambios);
        Object.assign(session.usuario, {
          nombres: data.nombres ?? nuevo.nombres, apellidos: data.apellidos ?? nuevo.apellidos, telefono: data.telefono ?? (nuevo.telefono || null),
        });
        session.usuario.nombre_completo = `${session.usuario.nombres} ${session.usuario.apellidos}`;
        const lateral = document.querySelector(".sidebar-profile");
        if (lateral) {
          lateral.querySelector(".avatar").textContent = initials(session.usuario.nombre_completo).toUpperCase();
          lateral.querySelector("strong").textContent = session.usuario.nombre_completo;
        }
        showToast("Información personal actualizada correctamente");
      } catch (error) {
        aviso.textContent = mensajeDeError(error);
        aviso.hidden = false;
      } finally {
        boton.disabled = false;
      }
    });
  }

  // ───────────── Contraseña ─────────────
  if (formClave) {
    const aviso = formClave.querySelector("[data-password-error]");
    formClave.addEventListener("submit", async (e) => {
      e.preventDefault();
      aviso.hidden = true;
      const actual = formClave.elements.currentPassword.value;
      const nueva = formClave.elements.newPassword.value;
      if (nueva === actual) { aviso.textContent = "La nueva contraseña debe ser distinta de la actual."; aviso.hidden = false; return; }
      const boton = formClave.querySelector("[data-password-submit]");
      boton.disabled = true;
      try {
        await cambiarContrasena(actual, nueva);
        formClave.reset();
        formClave.dispatchEvent(new Event("input")); // refresca los indicadores de fortaleza
        showToast("Contraseña actualizada. Las sesiones en otros dispositivos se cerrarán.");
      } catch (error) {
        aviso.textContent = mensajeDeCambioContrasena(error);
        aviso.hidden = false;
        boton.disabled = false;
      }
    });
  }
}

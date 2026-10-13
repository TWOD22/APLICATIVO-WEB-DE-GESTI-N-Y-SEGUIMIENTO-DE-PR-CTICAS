/**
 * Sesión de la aplicación: une Firebase (quién eres) con la API (qué roles tienes en el sistema).
 * El rol que decide qué puedes hacer lo valida SIEMPRE el servidor; aquí solo se elige el contexto.
 */
import { api, guardarRolActivo, LOGIN_URL, rolActivoGuardado } from "./api.js";
import { cerrarSesionFirebase, esperarUsuario } from "./auth.js";

/** Código de rol del sistema ⇄ carpeta/nombre de página del frontend. */
export const PAGINA_DE_ROL = Object.freeze({
  DIRECTOR_PROGRAMA: "director",
  ESTUDIANTE: "estudiante",
  DOCENTE_SUPERVISOR: "docente",
  ASESOR_SITIO: "asesor",
});
export const ROL_DE_PAGINA = Object.freeze(Object.fromEntries(Object.entries(PAGINA_DE_ROL).map(([rol, pagina]) => [pagina, rol])));
export const NOMBRE_DE_ROL = Object.freeze({
  director: "Director de programa", estudiante: "Estudiante", asesor: "Asesor de sitio", docente: "Docente supervisor",
});

/** Ruta del panel principal de cada rol. */
export const dashboardDe = (pagina) => `/frontend/pages/${pagina}/dashboard.html`;

/** GET /me con el rol que se indique (o el guardado). Devuelve { usuario, roles, rol_activo, requiere_seleccion_rol }. */
export async function cargarPerfil(rol = rolActivoGuardado()) {
  const { data } = await api.get("/me", undefined, rol ? { headers: { "X-Active-Role": rol } } : undefined);
  return data;
}

/** Fija el rol activo (se envía en X-Active-Role) comprobándolo con el servidor. */
export async function elegirRol(rol) {
  await api.post("/me/active-role", { rol }); // 403 ROLE_NOT_ASSIGNED si no lo tiene
  guardarRolActivo(rol);
}

/** Cierra la sesión (Firebase y rol guardado) y vuelve al login. */
export async function cerrarSesion() {
  guardarRolActivo(null);
  try { await cerrarSesionFirebase(); } catch { /* ya no hay sesión */ }
  window.location.assign(LOGIN_URL);
}

/**
 * Guardia de página: exige sesión y que el usuario tenga el rol de la página (`pagina`: director, estudiante, ...).
 * Devuelve { usuario, roles, rolActivo, pagina } o null si redirigió (sin sesión, sin permiso o sin registro).
 */
export async function requerirSesion(pagina) {
  const usuarioFirebase = await esperarUsuario();
  if (!usuarioFirebase) {
    window.location.assign(LOGIN_URL);
    return null;
  }
  const rolPagina = ROL_DE_PAGINA[pagina];
  let perfil;
  try {
    perfil = await cargarPerfil(rolPagina);
  } catch (error) {
    if (error.code === "ROLE_NOT_ASSIGNED") {
      // Entró a una página de otro rol: se le lleva a su propio panel.
      guardarRolActivo(null);
      const propio = await cargarPerfil(null).catch(() => null);
      const destino = propio?.roles?.length === 1 ? PAGINA_DE_ROL[propio.roles[0].codigo] : null;
      window.location.assign(destino ? dashboardDe(destino) : LOGIN_URL);
      return null;
    }
    if (error.status === 403) {
      // Cuenta no registrada, deshabilitada o sin roles: se cierra la sesión y el login muestra el motivo.
      sessionStorage.setItem("mensajeLogin", error.message);
      await cerrarSesion();
      return null;
    }
    throw error;
  }
  guardarRolActivo(rolPagina);
  return { usuario: perfil.usuario, roles: perfil.roles, rolActivo: rolPagina, pagina };
}

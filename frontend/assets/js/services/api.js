/**
 * Cliente de la API REST (/api/v1). Agrega el ID Token de Firebase y el rol activo (X-Active-Role) a cada petición,
 * convierte los errores del contrato { error: { code, message, details, request_id } } en `ApiError` y, si el
 * servidor responde 401 aun con un token renovado, cierra la sesión local y vuelve al inicio de sesión.
 */
import { obtenerIdToken } from "./auth.js";

// URL base de la API (VITE_API_URL en el .env o, por defecto, el servidor local).
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000/api/v1").replace(/\/$/, "");
const CLAVE_ROL_ACTIVO = "rolActivo";
export const LOGIN_URL = "/frontend/pages/auth/login.html";

// El rol activo se guarda en sessionStorage (solo dura mientras la pestaña esté abierta).
export const rolActivoGuardado = () => {
  try { return sessionStorage.getItem(CLAVE_ROL_ACTIVO); } catch { return null; }
};
export const guardarRolActivo = (rol) => {
  try { rol ? sessionStorage.setItem(CLAVE_ROL_ACTIVO, rol) : sessionStorage.removeItem(CLAVE_ROL_ACTIVO); } catch { /* sin almacenamiento: se usa el rol único */ }
};

/** Error de la API con estado HTTP, código, mensaje, detalles e identificador de la solicitud. */
export class ApiError extends Error {
  constructor({ status = 0, code = "UNKNOWN", message, details = [], requestId = null }) {
    super(message || "No fue posible completar la solicitud.");
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

// Arma la URL completa con los parámetros de búsqueda (ignora los vacíos).
function armarUrl(path, query) {
  const url = new URL(`${API_URL}${path}`);
  for (const [clave, valor] of Object.entries(query ?? {})) {
    if (valor !== undefined && valor !== null && valor !== "") url.searchParams.set(clave, String(valor));
  }
  return url;
}

// Envía la petición con el token y el rol activo en las cabeceras.
async function enviar(url, { method, body, headers, signal }, forzarToken) {
  const token = await obtenerIdToken({ forzar: forzarToken });
  const rol = rolActivoGuardado();
  return fetch(url, {
    method,
    body,
    signal,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rol ? { "X-Active-Role": rol } : {}), ...headers },
  });
}

/**
 * Petición genérica. `body` puede ser un objeto (se envía como JSON) o un Blob/ArrayBuffer/File (se envía tal cual,
 * con las cabeceras que indiques). `tipo`: "json" (por defecto), "blob" o "texto".
 */
export async function apiRequest(path, { method = "GET", query, body, headers = {}, tipo = "json", signal } = {}) {
  const url = armarUrl(path, query);
  const binario = body instanceof Blob || body instanceof ArrayBuffer;
  const opciones = {
    method,
    signal,
    body: body === undefined ? undefined : binario ? body : JSON.stringify(body),
    headers: { ...(body !== undefined && !binario ? { "Content-Type": "application/json" } : {}), ...headers },
  };

  let respuesta;
  try {
    respuesta = await enviar(url, opciones, false);
    if (respuesta.status === 401) respuesta = await enviar(url, opciones, true); // el token pudo vencer: se pide uno nuevo una vez
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError({ code: "NETWORK_ERROR", message: "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo." });
  }

  if (respuesta.status === 401) {
    guardarRolActivo(null);
    window.location.assign(LOGIN_URL);
    throw new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "Tu sesión expiró. Ingresa de nuevo." });
  }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => null);
    const e = cuerpo?.error ?? {};
    throw new ApiError({ status: respuesta.status, code: e.code, message: e.message, details: e.details, requestId: e.request_id });
  }
  if (respuesta.status === 204) return null;
  if (tipo === "blob") {
    const disposicion = respuesta.headers.get("content-disposition") ?? "";
    const nombre = /filename\*=UTF-8''([^;]+)/i.exec(disposicion)?.[1];
    return { blob: await respuesta.blob(), nombre: nombre ? decodeURIComponent(nombre) : null };
  }
  return tipo === "texto" ? respuesta.text() : respuesta.json();
}

/** Atajos por método HTTP: api.get / post / put / patch / delete / descargar. */
export const api = {
  get: (path, query, extra) => apiRequest(path, { ...extra, query }),
  post: (path, body, extra) => apiRequest(path, { ...extra, method: "POST", body }),
  put: (path, body, extra) => apiRequest(path, { ...extra, method: "PUT", body }),
  patch: (path, body, extra) => apiRequest(path, { ...extra, method: "PATCH", body }),
  delete: (path, extra) => apiRequest(path, { ...extra, method: "DELETE" }),
  /** Descarga un archivo (p. ej. el PDF de una bitácora) y lo entrega al navegador. */
  async descargar(path, nombreSugerido = "archivo") {
    const { blob, nombre } = await apiRequest(path, { tipo: "blob" });
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = nombre || nombreSugerido;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000);
  },
};

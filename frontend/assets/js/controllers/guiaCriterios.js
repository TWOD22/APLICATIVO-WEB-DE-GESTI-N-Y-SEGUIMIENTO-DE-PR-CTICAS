/**
 * Botón "Guía de criterios" del estudiante: ver el PDF en otra pestaña o descargarlo.
 * Es de solo lectura y se muestra únicamente si el docente de su nivel ya subió la guía;
 * si no hay guía (o no hay acceso) no pinta nada.
 */
import { api } from "../services/api.js";

const escapar = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Agrega `download=<nombre>` a la URL firmada para que el navegador guarde el archivo en vez de abrirlo. */
function urlDeDescarga(url, nombre) {
  try {
    const u = new URL(url);
    u.searchParams.set("download", nombre || "guia-de-criterios.pdf");
    return u.toString();
  } catch {
    return url;
  }
}

/** Busca los contenedores `[data-guia-criterios]` de la página y los llena. */
export async function montarGuiaCriterios(nivelId, periodoId, raiz = document) {
  const contenedores = [...raiz.querySelectorAll("[data-guia-criterios]")];
  if (!contenedores.length || !nivelId || !periodoId) return;
  let guia;
  try {
    guia = (await api.get(`/levels/${nivelId}/periods/${periodoId}/criteria-guide`)).data?.guia;
  } catch {
    return; // sin guía o sin acceso: no se muestra nada
  }
  if (!guia?.url) return;
  const html = `<div class="notice guia-criterios"><span><strong>Guía de criterios.</strong> Con ella tu docente evalúa tu práctica. <small class="muted">${escapar(guia.archivo_nombre)}</small></span>
    <span class="guia-criterios-acciones"><a class="btn btn-secondary" href="${escapar(guia.url)}" target="_blank" rel="noopener">Ver guía</a><a class="btn btn-secondary" href="${escapar(urlDeDescarga(guia.url, guia.archivo_nombre))}" download>Descargar</a></span></div>`;
  contenedores.forEach((c) => { c.innerHTML = html; });
}

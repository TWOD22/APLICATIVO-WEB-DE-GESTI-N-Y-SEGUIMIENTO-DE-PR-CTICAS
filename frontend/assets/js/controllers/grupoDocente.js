/**
 * «Mi grupo de práctica» (Docente supervisor): lo que el docente configura para los niveles que atiende en el periodo.
 *  - Resumen: estudiantes del nivel y qué falta configurar.
 *  - Guía de criterios: PDF de solo lectura para el estudiante, con versiones.
 *  - Cuestionario: preguntas de la bitácora del nivel (el docente decide sin aprobación de la Dirección).
 * Los estudiantes y sus evaluaciones se trabajan en «Mis tutorías».
 */
import { api } from "../services/api.js";
import { montarCuestionarios } from "./cuestionariosAdmin.js";

const PESTANAS = ["resumen", "criterios", "cuestionario"];
const TAMANO_MAXIMO = 10 * 1024 * 1024;

/** Texto de error legible; añade los detalles de validación del servidor. */
const mensajeDeError = (error) => {
  const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => d.mensaje) : [];
  return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
};
/** Fecha corta en español (ej. 12 oct 2026); vacía si el valor no es una fecha. */
const fecha = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "";
};
/** Tamaño de archivo legible (KB o MB). */
const tamano = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Conecta la pantalla con la API. */
export function montarGrupoDocente(ui) {
  const { badge, escapar, icon, openModal, pathFor, showToast } = ui;
  const pagina = document.querySelector(".page");
  const parametros = new URLSearchParams(window.location.search);
  const estado = { periodo: null, niveles: [], nivelId: null, pestana: PESTANAS.includes(parametros.get("pestana")) ? parametros.get("pestana") : "resumen", turno: 0 };

  const nivel = () => estado.niveles.find((n) => n.id === estado.nivelId);

  // ───────────── Carga ─────────────
  /** Trae los niveles que dirige el docente en el periodo activo y los pinta. */
  async function cargar() {
    pagina.innerHTML = `<p class="muted" style="padding:32px;text-align:center">Cargando tu grupo…</p>`;
    try {
      const { data } = await api.get("/dashboard/levels");
      estado.periodo = data.periodo;
      estado.niveles = data.niveles;
      if (!estado.niveles.some((n) => n.id === estado.nivelId)) estado.nivelId = estado.niveles[0]?.id ?? null;
      pintar();
    } catch (error) {
      pagina.innerHTML = `<div style="padding:32px;text-align:center"><p class="form-error" role="alert">${escapar(mensajeDeError(error))}</p><button class="btn btn-secondary" type="button" data-gd-reintentar>Reintentar</button></div>`;
    }
  }

  // ───────────── Pintado ─────────────
  /** Dibuja la pantalla del grupo: selector de nivel y pestañas (resumen, guía de criterios y cuestionario). Avisa si aún no tiene nivel asignado. */
  function pintar() {
    if (!estado.niveles.length) {
      pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Periodo ${escapar(estado.periodo?.codigo || "")}</span><h2>Mi grupo de práctica</h2></div></header>
        <section class="panel"><div class="empty-state"><strong>Todavía no tienes un nivel asignado</strong><p>La Dirección del programa te asigna el nivel de práctica que supervisas. Cuando lo haga, aquí configurarás la guía de criterios y el cuestionario.</p></div></section>`;
      return;
    }
    const n = nivel();
    const falta = { criterios: !n.tiene_guia, cuestionario: !n.tiene_cuestionario };
    const pestana = (clave, texto) => `<button class="${estado.pestana === clave ? "active" : ""}" type="button" role="tab" data-gd-pestana="${clave}">${texto}${falta[clave] ? ' <span class="tab-dot" title="Falta configurar" aria-label="Falta configurar">●</span>' : ""}</button>`;
    const selector = estado.niveles.length > 1
      ? `<label class="field" style="max-width:320px"><span>Nivel</span><select data-gd-nivel>${estado.niveles.map((x) => `<option value="${escapar(x.id)}" ${x.id === n.id ? "selected" : ""}>${escapar(x.nombre)}</option>`).join("")}</select></label>`
      : "";
    pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Periodo ${escapar(estado.periodo?.codigo || "")}</span><h2>Mi grupo de práctica</h2><p>${escapar(n.nombre)} · ${n.estudiantes} ${n.estudiantes === 1 ? "estudiante" : "estudiantes"} matriculados en este nivel.</p></div><a class="btn btn-secondary" href="${pathFor("docente", "dashboard")}">Ver mis estudiantes y evaluar</a></header>
      ${selector ? `<section class="panel"><div class="content-block">${selector}</div></section>` : ""}
      <div class="tabs" role="tablist">${pestana("resumen", "Resumen")}${pestana("criterios", "Guía de criterios")}${pestana("cuestionario", "Cuestionario")}</div>
      <div id="gd-panel"></div>`;
    pintarPestana();
  }

  /** Muestra la pestaña elegida; el cuestionario usa un contenedor nuevo para no duplicar escuchadores. */
  function pintarPestana() {
    const panel = pagina.querySelector("#gd-panel");
    pagina.querySelectorAll("[data-gd-pestana]").forEach((b) => b.classList.toggle("active", b.dataset.gdPestana === estado.pestana));
    if (estado.pestana === "resumen") return pintarResumen(panel);
    if (estado.pestana === "criterios") return pintarCriterios(panel);
    // El cuestionario usa un contenedor nuevo cada vez para no repetir sus escuchadores.
    panel.innerHTML = "";
    const caja = document.createElement("div");
    panel.append(caja);
    montarCuestionarios(ui, { contenedor: caja, nivelIds: [estado.nivelId], puedeEditar: true });
  }

  /** Pestaña «Resumen»: estudiantes del nivel, estado de la guía y del cuestionario. */
  function pintarResumen(panel) {
    const n = nivel();
    const estadoCuestionario = n.tiene_cuestionario ? badge("Habilitado", "success") : n.tiene_borrador ? badge("Borrador sin publicar", "warning") : badge("Sin cuestionario", "neutral");
    panel.innerHTML = `<section class="stats-grid dashboard-stats">
        <article class="stat-card"><span class="stat-icon blue">${icon("users")}</span><div><span>Estudiantes del nivel</span><strong>${n.estudiantes}</strong><small>Matriculados este periodo</small></div></article>
        <article class="stat-card"><span class="stat-icon ${n.tiene_guia ? "green" : "orange"}">${icon("file")}</span><div><span>Guía de criterios</span><strong>${n.tiene_guia ? "Cargada" : "Falta"}</strong><small>${n.tiene_guia ? "Los estudiantes pueden consultarla" : "Sube el PDF para tus estudiantes"}</small></div></article>
        <article class="stat-card"><span class="stat-icon ${n.tiene_cuestionario ? "green" : "orange"}">${icon("clipboard")}</span><div><span>Cuestionario</span><strong>${n.tiene_cuestionario ? "Habilitado" : "Sin habilitar"}</strong><small>${n.tiene_cuestionario ? "Lo responden en su bitácora" : "Es opcional; la bitácora funciona sin él"}</small></div></article>
      </section>
      <section class="panel"><header class="panel-heading"><div><h3>Qué puedes hacer aquí</h3><p>Lo que configures aplica a todos los estudiantes de ${escapar(n.nombre)}.</p></div></header>
        <div class="content-block" style="display:grid;gap:12px">
          <div class="notice"><span><strong>Guía de criterios.</strong> Un PDF que los estudiantes de tu nivel consultan; no pueden modificarlo. Cada archivo nuevo queda como una versión y las anteriores se conservan.</span></div>
          <div class="notice"><span><strong>Cuestionario.</strong> Preguntas que acompañan la bitácora. Decides tú, sin aprobación de la Dirección; cada publicación afecta solo a las bitácoras nuevas. Estado actual: ${estadoCuestionario}</span></div>
          <div class="form-actions" style="justify-content:flex-start"><button class="btn btn-secondary" type="button" data-gd-pestana="criterios">Ir a la guía de criterios</button><button class="btn btn-secondary" type="button" data-gd-pestana="cuestionario">Ir al cuestionario</button></div>
        </div></section>`;
  }

  /** Pestaña «Guía de criterios»: guía vigente, historial de versiones y formulario para subir una nueva. */
  async function pintarCriterios(panel) {
    const turno = ++estado.turno;
    panel.innerHTML = `<section class="panel"><p class="muted" style="padding:24px;text-align:center">Cargando guía…</p></section>`;
    let datos;
    try {
      datos = (await api.get(`/levels/${estado.nivelId}/periods/${estado.periodo.id}/criteria-guide`)).data;
    } catch (error) {
      if (turno !== estado.turno) return;
      panel.innerHTML = `<section class="panel"><div style="padding:24px;text-align:center"><p class="form-error" role="alert">${escapar(mensajeDeError(error))}</p><button class="btn btn-secondary" type="button" data-gd-reintentar-guia>Reintentar</button></div></section>`;
      return;
    }
    if (turno !== estado.turno) return;
    const g = datos.guia;
    const versiones = (datos.versiones || []).filter((v) => !v.vigente);
    panel.innerHTML = `<section class="panel"><header class="panel-heading"><div><h3>Guía de criterios · ${escapar(nivel().nombre)}</h3><p>PDF de hasta 10 MB. Los estudiantes de este nivel lo ven en solo lectura.</p></div></header>
      <div class="content-block" style="display:grid;gap:16px">
        ${g ? `<div class="audit-document" style="margin:0"><span class="doc-icon green">${icon("file")}</span><div class="audit-document-copy"><div><h3>${escapar(g.archivo_nombre)}</h3>${badge(`Versión ${g.version} · vigente`, "success")}</div><p>${escapar(tamano(g.tamano_bytes))} · subida el ${escapar(fecha(g.subida_en))}</p></div><div class="audit-document-actions"><a class="btn btn-secondary" href="${escapar(g.url)}" target="_blank" rel="noopener">Ver PDF</a>${versiones.length === 0 ? `<button class="btn btn-secondary" type="button" data-gd-eliminar="${escapar(g.id)}" data-gd-version="${escapar(g.version)}">Eliminar</button>` : ""}</div></div>`
          : `<div class="empty-state"><strong>Aún no has subido la guía de criterios</strong><p>Sube el PDF con los criterios de evaluación de este nivel.</p></div>`}
        <form data-gd-subir novalidate style="display:grid;gap:10px;max-width:520px"><label class="field"><span>${g ? "Subir una versión nueva" : "Archivo PDF"}</span><input type="file" name="archivo" accept="application/pdf,.pdf" required /></label>
          <p class="form-error" role="alert" data-gd-error hidden></p>
          <div><button class="btn btn-primary" type="submit">${g ? "Subir nueva versión" : "Subir guía"}</button></div></form>
        ${versiones.length ? `<div><h4 style="margin:0 0 4px;font-size:14px">Versiones anteriores</h4><p class="muted" style="margin:0 0 10px">Puedes volver a una versión anterior (la verán los estudiantes) o eliminar la que ya no quieras.</p>
          <div style="display:grid;gap:8px">${versiones.map((v) => `<div class="audit-document" style="margin:0"><span class="doc-icon">${icon("file")}</span><div class="audit-document-copy"><div><h3>${escapar(v.archivo_nombre)}</h3>${badge(`Versión ${v.version}`, "neutral")}</div><p>${escapar(tamano(v.tamano_bytes))} · subida el ${escapar(fecha(v.subida_en))}</p></div><div class="audit-document-actions"><button class="btn btn-secondary" type="button" data-gd-activar="${escapar(v.id)}" data-gd-version="${escapar(v.version)}">Usar esta versión</button><button class="btn btn-secondary" type="button" data-gd-eliminar="${escapar(v.id)}" data-gd-version="${escapar(v.version)}">Eliminar</button></div></div>`).join("")}</div></div>` : ""}
      </div></section>`;
  }

  /** Valida que el archivo sea un PDF de hasta 10 MB y lo sube como nueva versión de la guía. */
  async function subirGuia(formulario) {
    const error = formulario.querySelector("[data-gd-error]");
    const archivo = formulario.archivo.files[0];
    error.hidden = true;
    const fallar = (texto) => { error.textContent = texto; error.hidden = false; };
    if (!archivo) return fallar("Elige un archivo PDF.");
    if (archivo.type !== "application/pdf" && !archivo.name.toLowerCase().endsWith(".pdf")) return fallar("El archivo debe ser un PDF.");
    if (archivo.size > TAMANO_MAXIMO) return fallar("El archivo supera el máximo de 10 MB.");
    const boton = formulario.querySelector("[type=submit]");
    boton.disabled = true;
    try {
      await api.post(`/levels/${estado.nivelId}/periods/${estado.periodo.id}/criteria-guide`, archivo, {
        headers: { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(archivo.name) },
      });
      showToast("Guía de criterios subida");
      const n = nivel(); n.tiene_guia = true;
      pintar();
    } catch (fallo) {
      fallar(mensajeDeError(fallo));
      boton.disabled = false;
    }
  }

  /** Pregunta antes de una acción sobre la guía. Resuelve true si el docente confirma. */
  /** Ventana de confirmación; devuelve una promesa con true (aceptó) o false (canceló). */
  function confirmarGuia({ titulo, texto, boton, peligro = false }) {
    return new Promise((resolver) => {
      const ventana = openModal(escapar(titulo), `<div><p>${escapar(texto)}</p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn ${peligro ? "btn-danger" : "btn-primary"}" type="button" data-gd-ok>${escapar(boton)}</button></div></div>`);
      ventana.addEventListener("click", (e) => {
        if (e.target.closest("[data-gd-ok]")) { ventana.remove(); resolver(true); }
        else if (e.target === ventana || e.target.closest("[data-close]")) resolver(false);
      });
    });
  }

  /** Deja como vigente una versión anterior de la guía o la elimina, previa confirmación. */
  async function cambiarVersion(accion, id, numero) {
    const base = `/levels/${estado.nivelId}/periods/${estado.periodo.id}/criteria-guide/versions/${id}`;
    const activar = accion === "activar";
    const ok = await confirmarGuia(activar
      ? { titulo: `Usar la versión ${numero}`, texto: `Los estudiantes de este nivel verán la versión ${numero} como guía vigente. Las demás versiones se conservan.`, boton: "Usar esta versión" }
      : { titulo: `Eliminar la versión ${numero}`, texto: `La versión ${numero} dejará de aparecer en la lista. Esta acción no se puede deshacer.`, boton: "Eliminar", peligro: true });
    if (!ok) return;
    try {
      const { data } = activar ? await api.post(`${base}/activate`) : await api.delete(base);
      nivel().tiene_guia = Boolean(data.guia);
      showToast(activar ? `Ahora la versión ${numero} es la vigente` : `Versión ${numero} eliminada`);
      pintar();
    } catch (fallo) { showToast(mensajeDeError(fallo)); }
  }

  // ───────────── Eventos ─────────────
  pagina.addEventListener("click", (e) => {
    const p = e.target.closest("[data-gd-pestana]");
    if (p) { estado.pestana = p.dataset.gdPestana; pintar(); return; }
    if (e.target.closest("[data-gd-reintentar]")) { cargar(); return; }
    if (e.target.closest("[data-gd-reintentar-guia]")) { pintarPestana(); return; }
    const activar = e.target.closest("[data-gd-activar]");
    if (activar) { cambiarVersion("activar", activar.dataset.gdActivar, activar.dataset.gdVersion); return; }
    const eliminar = e.target.closest("[data-gd-eliminar]");
    if (eliminar) cambiarVersion("eliminar", eliminar.dataset.gdEliminar, eliminar.dataset.gdVersion);
  });
  pagina.addEventListener("change", (e) => {
    if (e.target.matches("[data-gd-nivel]")) { estado.nivelId = e.target.value; pintar(); }
  });
  pagina.addEventListener("submit", (e) => {
    if (e.target.matches("[data-gd-subir]")) { e.preventDefault(); subirGuia(e.target); }
  });

  cargar();
}

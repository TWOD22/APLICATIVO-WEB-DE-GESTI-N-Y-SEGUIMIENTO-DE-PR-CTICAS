/**
 * Pantalla "Documentos legales" del Estudiante conectada al API real:
 * lista el expediente de su práctica, carga/reemplaza PDFs y abre los ya enviados.
 */
import { api } from "../services/api.js";

// Aspecto de cada estado del documento: texto, color de la insignia, color y nombre del icono.
const ESTADOS = {
  APROBADO: { texto: "Aprobado", tono: "success", iconoTono: "green", icono: "check" },
  EN_REVISION: { texto: "En revisión", tono: "info", iconoTono: "blue", icono: "file" },
  POR_CORREGIR: { texto: "Por corregir", tono: "danger", iconoTono: "red", icono: "file" },
  SIN_CARGAR: { texto: "Sin cargar", tono: "neutral", iconoTono: "orange", icono: "file" },
};

// Fecha corta en español (vacío si no hay fecha válida).
const fecha = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "";
};
// Tamaño en megabytes enteros.
const megas = (bytes) => `${Math.floor(bytes / 1024 / 1024)} MB`;

/**
 * Conecta la pantalla de documentos del estudiante con la API.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarDocumentosEstudiante(ui) {
  const { badge, escapar, icon, showToast } = ui;
  const pagina = document.querySelector(".page");
    // Estado local: asignación del estudiante, documentos por requisito y bandera de carga en curso.
  const estado = { asignacionId: null, documentos: new Map(), cargando: false };

    // Mensaje de error para mostrar al usuario.
  const mensajeDeError = (error) => error?.message || "Ocurrió un error inesperado.";
    // HTML del error con botón para reintentar.
  const errorHtml = (mensaje) => `<div style="padding:32px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" data-doc-retry>Reintentar</button></div>`;

    /** Busca la práctica del estudiante y trae el estado de cada documento legal. */
  async function cargar() {
    pagina.innerHTML = `<p class="muted" style="padding:32px;text-align:center">Cargando tus documentos…</p>`;
    try {
      const { data: resumen } = await api.get("/dashboard");
      const practica = resumen.practica;
      if (!practica) {
        pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Expediente</span><h2>Documentos de práctica</h2><p>Aún no tienes una práctica asignada en el periodo activo, por eso no hay documentos que cargar. Comunícate con la Dirección del Programa.</p></div></header>`;
        return;
      }
      estado.asignacionId = practica.id;
      const { data } = await api.get(`/practice-assignments/${practica.id}/legal-documents`);
      estado.documentos = new Map(data.documentos.map((d) => [d.requisito_id, d]));
      pintar(data);
    } catch (error) {
      pagina.innerHTML = errorHtml(mensajeDeError(error));
    }
  }

    /** Tarjeta de un documento: estado, observación del Director y botones según lo que se pueda hacer. */
  function tarjeta(doc) {
    const e = ESTADOS[doc.estado] || ESTADOS.SIN_CARGAR;
    const vacia = doc.estado === "SIN_CARGAR";
    const maximo = megas(doc.tipo.tamano_maximo_bytes);
    let accion = "";
    if (doc.estado === "APROBADO") accion = `<button class="btn btn-secondary" type="button" data-doc-view="${escapar(doc.documento_id)}">Ver PDF</button>`;
    else if (doc.puede_subir && doc.estado === "POR_CORREGIR") accion = `<button class="btn btn-primary" type="button" data-doc-upload="${escapar(doc.requisito_id)}">Reemplazar archivo</button>`;
    else if (doc.puede_subir && doc.estado === "EN_REVISION") accion = `<button class="btn btn-secondary" type="button" data-doc-upload="${escapar(doc.requisito_id)}">Reemplazar</button>`;
    const visor = doc.documento_id && doc.estado !== "APROBADO" ? `<button class="btn btn-ghost" type="button" data-doc-view="${escapar(doc.documento_id)}">Ver archivo</button>` : "";
    let detalle;
    if (doc.estado === "POR_CORREGIR") detalle = `Observación: ${escapar(doc.observacion || "Revisa el documento y vuelve a cargarlo.")}`;
    else if (doc.estado === "APROBADO") detalle = `Aprobado por Dirección${doc.revisado_en ? ` · ${fecha(doc.revisado_en)}` : ""}`;
    else detalle = `Enviado${doc.enviado_en ? ` el ${fecha(doc.enviado_en)}` : ""} · Pendiente de validación por Dirección`;
    const zona = vacia && doc.puede_subir
      ? `<button class="document-upload-zone" type="button" data-doc-upload="${escapar(doc.requisito_id)}">${icon("upload")}<span><strong>Arrastra tu archivo aquí o selecciónalo</strong><small>Formato PDF · Máx. ${maximo}</small></span></button>`
      : vacia
        ? `<div class="document-audit">${icon("clock")}<span>Este documento ya no admite carga.</span></div>`
        : `<div class="document-audit ${doc.estado === "POR_CORREGIR" ? "needs-correction" : ""}">${doc.estado === "POR_CORREGIR" ? icon("alert") : icon(doc.estado === "APROBADO" ? "check" : "clock")}<span>${detalle}</span></div>`;
    return `<article class="document-card document-${e.tono}" data-doc-card="${escapar(doc.requisito_id)}"><div class="document-main"><span class="doc-icon ${e.iconoTono}">${icon(e.icono)}</span><div><h3>${escapar(doc.tipo.nombre)}${doc.obligatorio ? "" : " <small>(opcional)</small>"}</h3><p>${escapar(doc.archivo?.nombre || "Aún no has cargado este documento")}${doc.total_versiones > 1 ? ` · versión ${doc.numero_version}` : ""}</p></div>${badge(e.texto, e.tono)}${visor}${accion}</div>${zona}</article>`;
  }

    /** Dibuja el encabezado, el aviso del expediente y todas las tarjetas. */
  function pintar({ asignacion, documentos, resumen }) {
    const completo = resumen.expediente_completo;
    pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Expediente · ${escapar(asignacion.nivel.nombre)} · ${escapar(asignacion.periodo.codigo)}</span><h2>Documentos de práctica</h2><p>Estos soportes pertenecen exclusivamente a tu ${escapar(asignacion.nivel.nombre)} en ${escapar(asignacion.institucion.nombre)}.</p></div>${badge(`${resumen.aprobados_obligatorios} de ${resumen.total_obligatorios} aprobados`, completo ? "success" : "warning")}</header>${completo
      ? `<div class="document-complete-banner">${icon("check")}<div><strong>Tu expediente documental está completo y verificado.</strong><span>Ya puedes continuar con el diligenciamiento de tu bitácora.</span></div></div>`
      : `<div class="notice">Tu bitácora se habilitará cuando Dirección apruebe los ${resumen.total_obligatorios} documentos obligatorios. Atiende primero los archivos marcados como “Por corregir” o “Sin cargar”.</div>`}<section class="document-list">${documentos.map(tarjeta).join("") || '<div class="empty-state">Tu práctica no tiene documentos requeridos.</div>'}</section>`;
  }

    /** Valida el PDF (formato, tamaño, no vacío) y lo sube como cuerpo binario; luego recarga la pantalla. */
  async function subir(requisitoId, archivo) {
    if (!archivo || estado.cargando) return;
    const doc = estado.documentos.get(requisitoId);
    if (!doc) return;
    if (archivo.type !== "application/pdf" && !archivo.name.toLowerCase().endsWith(".pdf")) { showToast("Selecciona un archivo en formato PDF"); return; }
    if (archivo.size > doc.tipo.tamano_maximo_bytes) { showToast(`El archivo supera el tamaño máximo de ${megas(doc.tipo.tamano_maximo_bytes)}`); return; }
    if (archivo.size === 0) { showToast("El archivo está vacío"); return; }
    estado.cargando = true;
    const tarjetaEl = pagina.querySelector(`[data-doc-card="${CSS.escape(requisitoId)}"]`);
    tarjetaEl?.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    showToast("Subiendo archivo…");
    try {
      await api.post(`/practice-assignments/${estado.asignacionId}/legal-documents/${doc.tipo.id}/upload`, new Blob([archivo], { type: "application/pdf" }), {
        headers: { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(archivo.name) },
      });
      showToast("Archivo enviado para revisión");
    } catch (error) {
      showToast(mensajeDeError(error));
    } finally {
      estado.cargando = false;
      await cargar();
    }
  }

    /** Abre el PDF en una pestaña nueva con una URL firmada temporal. */
  async function ver(documentoId) {
    const ventana = window.open("", "_blank");
    try {
      const { data } = await api.get(`/legal-documents/${documentoId}/download-url`);
      if (ventana) ventana.location.href = data.url;
      else window.location.assign(data.url);
    } catch (error) {
      ventana?.close();
      showToast(mensajeDeError(error));
    }
  }

  // ---------- Eventos ----------
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-doc-retry]")) { cargar(); return; }
    const subirBtn = e.target.closest("[data-doc-upload]");
    if (subirBtn) {
      const entrada = document.createElement("input");
      entrada.type = "file";
      entrada.accept = ".pdf,application/pdf";
      entrada.addEventListener("change", () => subir(subirBtn.dataset.docUpload, entrada.files[0]));
      entrada.click();
      return;
    }
    const verBtn = e.target.closest("[data-doc-view]");
    if (verBtn) ver(verBtn.dataset.docView);
  });
    // Permite arrastrar un PDF sobre la zona de carga.
  document.addEventListener("dragover", (e) => { if (e.target.closest("[data-doc-upload]")) e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    const zona = e.target.closest("[data-doc-upload]");
    if (!zona) return;
    e.preventDefault();
    subir(zona.dataset.docUpload, e.dataTransfer.files[0]);
  });

  cargar();
}

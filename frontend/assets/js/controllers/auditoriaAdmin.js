/**
 * Pantalla "Auditoría documental" (Director) conectada al API real:
 * lista de expedientes por estudiante + detalle con revisión de cada documento.
 */
import { api } from "../services/api.js";

// Expedientes por página en la lista.
const TAMANO_PAGINA = 15;
// Estado del expediente completo: [texto, color de la insignia].
const EXPEDIENTE = {
  EN_REVISION: ["Pendiente", "warning"],
  POR_CORREGIR: ["Por corregir", "danger"],
  INCOMPLETO: ["Incompleto", "neutral"],
  COMPLETO: ["Aprobado", "success"],
};
// Estado de cada documento: texto, color de la insignia y color del icono.
const DOCUMENTO = {
  EN_REVISION: { texto: "Pendiente", tono: "warning", color: "orange" },
  APROBADO: { texto: "Aprobado", tono: "success", color: "green" },
  POR_CORREGIR: { texto: "Rechazado", tono: "danger", color: "red" },
  SIN_CARGAR: { texto: "Sin cargar", tono: "neutral", color: "orange" },
};
// Motivos predefinidos para rechazar un documento.
const MOTIVOS = [
  "La institución no cuenta con convenio vigente",
  "El documento está vencido",
  "El archivo no es legible",
  "Faltan firmas o sellos requeridos",
  "Otro motivo",
];

// Fecha corta en español (vacío si no hay fecha válida).
const fecha = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "";
};

/**
 * Conecta la pantalla con la API: a la izquierda la lista de expedientes, a la derecha el detalle de documentos.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarAuditoria(ui) {
  const { badge, escapar, icon, initials, openModal, showToast } = ui;
  const lista = document.querySelector("#audit-student-list");
  const detalle = document.querySelector("#audit-detail");
  if (!lista || !detalle) return;
    // Estado local de la pantalla. `turno` y `turnoDetalle` descartan respuestas viejas.
  const estado = { periodos: [], periodoId: "", q: "", nivel: "", expediente: "", pagina: 1, filas: [], seleccion: new URLSearchParams(window.location.search).get("asignacion"), turno: 0, turnoDetalle: 0 };
  // Si se llega desde el perfil de un estudiante (?asignacion=…), se abre ese expediente aunque no esté en la primera página.
  let preseleccion = Boolean(estado.seleccion);

    // Une el mensaje del error con los detalles que devuelve el servidor.
  const mensajeDeError = (error) => {
    const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje || d?.tipo).map((d) => d.mensaje || d.tipo) : [];
    return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
  };
    // HTML del mensaje de error con botón para reintentar.
  const errorHtml = (mensaje, atributo) => `<div style="padding:24px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" ${atributo}>Reintentar</button></div>`;

  // ---------- Lista de expedientes ----------
    /** Pide la lista de expedientes con los filtros actuales y selecciona uno. */
  async function cargarLista({ conservarSeleccion = true } = {}) {
    const turno = ++estado.turno;
    lista.innerHTML = `<p class="muted" style="padding:24px;text-align:center">Cargando expedientes…</p>`;
    try {
      const consulta = { page: estado.pagina, page_size: TAMANO_PAGINA };
      if (estado.periodoId) consulta.periodo_id = estado.periodoId;
      if (estado.q) consulta.q = estado.q;
      if (estado.nivel) consulta.nivel = estado.nivel;
      if (estado.expediente) consulta.estado = estado.expediente;
      const { data, meta } = await api.get("/legal-documents/expedientes", consulta);
      if (turno !== estado.turno) return;
      estado.filas = data;
      pintarResumen(meta.resumen);
      pintarLista(data, meta);
      const sigueVisible = conservarSeleccion && (data.some((f) => f.asignacion_id === estado.seleccion) || (preseleccion && Boolean(estado.seleccion)));
      preseleccion = false;
      if (!sigueVisible) estado.seleccion = data[0]?.asignacion_id ?? null;
      if (estado.seleccion) cargarDetalle(); else detalle.innerHTML = `<div class="empty-state" style="padding:32px">No hay expedientes para los filtros seleccionados.</div>`;
    } catch (error) {
      if (turno !== estado.turno) return;
      lista.innerHTML = errorHtml(mensajeDeError(error), "data-au-retry-lista");
    }
  }

    /** Contadores superiores (pendientes, por corregir, aprobados) que también sirven de filtro rápido. */
  function pintarResumen(r = {}) {
    const caja = document.querySelector("#audit-summary");
    if (!caja) return;
    caja.innerHTML = `<button type="button" class="quick-filter warning" data-au-filtro="EN_REVISION"><span>${r.en_revision ?? 0}</span> pendientes</button><button type="button" class="quick-filter correction" data-au-filtro="POR_CORREGIR"><span>${r.por_corregir ?? 0}</span> por corregir</button><button type="button" class="quick-filter" data-au-filtro="INCOMPLETO"><span>${r.incompletos ?? 0}</span> incompletos</button><button type="button" class="quick-filter success" data-au-filtro="COMPLETO"><span>${r.completos ?? 0}</span> aprobados</button>`;
    caja.querySelectorAll("[data-au-filtro]").forEach((b) => b.classList.toggle("active", b.dataset.auFiltro === estado.expediente));
  }

    /** Dibuja la lista de estudiantes con el estado de su expediente y la paginación. */
  function pintarLista(filas, meta) {
    if (!filas.length) { lista.innerHTML = `<p class="muted" style="padding:24px;text-align:center">No hay expedientes con esos filtros.</p>`; return; }
    const items = filas.map((f) => {
      const [texto, tono] = EXPEDIENTE[f.expediente_estado] || [f.expediente_estado, "neutral"];
      const d = f.documentos;
      return `<button class="audit-student ${f.asignacion_id === estado.seleccion ? "active" : ""}" type="button" data-au-expediente="${escapar(f.asignacion_id)}"><span class="avatar">${escapar(initials(f.estudiante.nombre_completo))}</span><span class="audit-student-copy"><strong>${escapar(f.estudiante.nombre_completo)}</strong><small>${escapar(f.nivel.nombre)}</small><small>${escapar(f.institucion.nombre)}</small><span class="progress"><span style="width:${d.total ? Math.round((d.aprobados / d.total) * 100) : 0}%"></span></span></span><span class="audit-student-status">${badge(texto, tono)}<small>${escapar(f.periodo.codigo)}</small><small>${d.aprobados}/${d.total} válidos</small></span></button>`;
    }).join("");
    const paginacion = meta.total_pages > 1
      ? `<nav class="pagination" style="justify-content:center;gap:8px;padding:12px"><button type="button" data-au-pagina="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""}>‹</button><span>${meta.page} / ${meta.total_pages}</span><button type="button" data-au-pagina="${meta.page + 1}" ${meta.page >= meta.total_pages ? "disabled" : ""}>›</button></nav>`
      : "";
    lista.innerHTML = items + paginacion;
  }

  // ---------- Detalle del expediente ----------
    /** Pide los documentos del expediente seleccionado. */
  async function cargarDetalle() {
    const turno = ++estado.turnoDetalle;
    const id = estado.seleccion;
    detalle.innerHTML = `<p class="muted" style="padding:32px;text-align:center">Cargando documentos…</p>`;
    try {
      const { data } = await api.get(`/practice-assignments/${id}/legal-documents`);
      if (turno !== estado.turnoDetalle) return;
      pintarDetalle(data);
    } catch (error) {
      if (turno !== estado.turnoDetalle) return;
      detalle.innerHTML = errorHtml(mensajeDeError(error), "data-au-retry-detalle");
    }
  }

    /** HTML de un documento con su estado y las acciones disponibles (ver, aprobar, rechazar, devolver a revisión). */
  function filaDocumento(doc) {
    const e = DOCUMENTO[doc.estado] || DOCUMENTO.SIN_CARGAR;
    let texto;
    if (doc.estado === "SIN_CARGAR") texto = "El estudiante aún no ha cargado este documento.";
    else if (doc.estado === "POR_CORREGIR") texto = `${doc.observacion ? escapar(doc.observacion) : "Devuelto al estudiante."}`;
    else if (doc.estado === "APROBADO") texto = `${escapar(doc.archivo?.nombre || "")} · Validado${doc.revisado_en ? ` el ${fecha(doc.revisado_en)}` : ""}`;
    else texto = `${escapar(doc.archivo?.nombre || "")} · Enviado${doc.enviado_en ? ` el ${fecha(doc.enviado_en)}` : ""}${doc.total_versiones > 1 ? ` · versión ${doc.numero_version}` : ""}`;
    const id = escapar(doc.documento_id || "");
    let acciones = "";
    if (doc.documento_id) acciones += `<button class="btn btn-ghost" type="button" data-au-ver="${id}">Ver PDF</button>`;
    if (doc.estado === "EN_REVISION") acciones += `<button class="btn btn-secondary" type="button" data-au-aprobar="${id}">Aprobar</button><button class="btn btn-danger" type="button" data-au-rechazar="${id}" data-nombre="${escapar(doc.tipo.nombre)}">Rechazar</button>`;
    else if (doc.estado === "APROBADO") acciones += `<div class="document-more"><button class="more-button" type="button" data-au-menu aria-label="Más acciones">⋮</button><div class="document-more-menu" hidden><button type="button" data-au-pendiente="${id}">Cambiar a pendiente</button><button type="button" data-au-rechazar="${id}" data-nombre="${escapar(doc.tipo.nombre)}">Rechazar con motivo</button></div></div>`;
    else if (doc.estado === "POR_CORREGIR") acciones += `<button class="btn btn-secondary" type="button" data-au-pendiente="${id}">Devolver a revisión</button>`;
    return `<section class="audit-document"><span class="doc-icon ${e.color}">${icon("file")}</span><div class="audit-document-copy"><div><h3>${escapar(doc.tipo.nombre)}${doc.obligatorio ? "" : " <small>(opcional)</small>"}</h3>${badge(e.texto, e.tono)}</div><p>${texto}</p></div><div class="audit-document-actions">${acciones}</div></section>`;
  }

    /** Dibuja el detalle del expediente y el botón "Aprobar expediente completo" (solo activo si no hay rechazados ni faltantes). */
  function pintarDetalle({ asignacion, documentos, resumen }) {
    const completo = resumen.expediente_completo;
    const hayRechazados = resumen.por_corregir > 0;
    const faltan = documentos.some((d) => d.obligatorio && !d.documento_id);
    const [textoGlobal, tonoGlobal] = completo ? ["Aprobado", "success"] : hayRechazados ? ["Por corregir", "danger"] : faltan ? ["Incompleto", "neutral"] : ["Pendiente", "warning"];
    let textoBoton = "Aprobar expediente completo";
    if (completo) textoBoton = "Expediente totalmente aprobado ✓";
    else if (hayRechazados) textoBoton = "Hay documentos rechazados";
    else if (faltan) textoBoton = "Faltan documentos por cargar";
    const deshabilitado = completo || hayRechazados || faltan;
    detalle.innerHTML = `<header class="panel-heading audit-detail-heading"><div class="person"><span class="avatar">${escapar(initials(asignacion.estudiante.nombre_completo))}</span><span><h3>${escapar(asignacion.estudiante.nombre_completo)}</h3><p>${escapar(asignacion.nivel.nombre)} · ${escapar(asignacion.institucion.nombre)}</p></span></div>${badge(textoGlobal, tonoGlobal)}</header>
      <div class="audit-notice"><span class="doc-icon blue">${icon("shield")}</span><div><strong>Validación documental</strong><p>Verifica vigencia, legibilidad, firmas y convenio activo con la institución antes de aprobar.</p></div></div>
      <div class="audit-documents">${documentos.map(filaDocumento).join("")}</div>
      <footer class="audit-footer"><div><strong>Estado del expediente</strong><small>${resumen.aprobados_obligatorios} de ${resumen.total_obligatorios} documentos obligatorios aprobados</small></div><button class="btn ${completo ? "btn-secondary" : "btn-primary"}" type="button" data-au-aprobar-todo ${deshabilitado ? "disabled" : ""}>${textoBoton}</button></footer>`;
  }

  // ---------- Acciones ----------
    /** Envía la decisión del Director sobre un documento y refresca la pantalla. */
  async function revisar(documentoId, cuerpo, mensajeOk) {
    try {
      const { data } = await api.post(`/legal-documents/${documentoId}/review`, cuerpo);
      showToast(mensajeOk + (data.bitacora === "HABILITADA" ? " · Bitácora habilitada para el estudiante" : ""));
    } catch (error) {
      showToast(mensajeDeError(error));
    }
    await refrescarTodo();
  }
  const refrescarTodo = async () => { await cargarLista(); };

    /** Ventana para rechazar un documento: pide motivo y observación (mínimo 5 caracteres). */
  function abrirRechazo(documentoId, nombre) {
    const modal = openModal(`Rechazar ${escapar(nombre)}`, `<form id="reject-document-form" novalidate><p class="muted">El rechazo requiere una justificación. El estudiante la verá en su pantalla y recibirá una notificación en el aplicativo para cargar una corrección.</p><label class="field"><span>Motivo del rechazo</span><select name="motivo">${MOTIVOS.map((m) => `<option>${escapar(m)}</option>`).join("")}</select></label><label class="field"><span>Observación obligatoria</span><textarea name="observacion" rows="4" required placeholder="Indica qué debe corregir el estudiante."></textarea></label><p class="form-error" role="alert" data-form-error hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-danger" type="submit">Confirmar rechazo</button></div></form>`);
    const formulario = modal.querySelector("form");
    formulario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = formulario.querySelector("[data-form-error]");
      const observacion = formulario.observacion.value.trim();
      if (observacion.length < 5) { error.textContent = "Describe el motivo (mínimo 5 caracteres)."; error.hidden = false; return; }
      formulario.querySelector("[type=submit]").disabled = true;
      modal.remove();
      await revisar(documentoId, { decision: "RECHAZAR", motivo: formulario.motivo.value, observacion }, "Documento rechazado. Se notificará al estudiante");
    });
  }

    /** Abre el PDF en una pestaña nueva usando una URL firmada temporal. */
  async function verPdf(documentoId) {
    const ventana = window.open("", "_blank");
    try {
      const { data } = await api.get(`/legal-documents/${documentoId}/download-url`);
      if (ventana) ventana.location.href = data.url; else window.location.assign(data.url);
    } catch (error) {
      ventana?.close();
      showToast(mensajeDeError(error));
    }
  }

    /** Aprueba todos los documentos en revisión del expediente. */
  async function aprobarTodo(boton) {
    boton.disabled = true;
    try {
      const { data } = await api.post(`/practice-assignments/${estado.seleccion}/legal-documents/approve-all`);
      showToast(data.aprobados ? `Expediente aprobado (${data.aprobados} documento${data.aprobados === 1 ? "" : "s"})${data.bitacora === "HABILITADA" ? " · Bitácora habilitada" : ""}` : "No había documentos pendientes de aprobar");
    } catch (error) {
      showToast(mensajeDeError(error));
    }
    await refrescarTodo();
  }

  // ---------- Filtros ----------
  let temporizador;
  document.querySelector("#audit-search")?.addEventListener("input", (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { estado.q = e.target.value.trim(); estado.pagina = 1; cargarLista({ conservarSeleccion: false }); }, 300);
  });
  document.querySelector("#audit-practice-filter")?.addEventListener("change", (e) => { estado.nivel = e.target.value === "all" ? "" : e.target.value; estado.pagina = 1; cargarLista({ conservarSeleccion: false }); });
  document.querySelector("#audit-period-filter")?.addEventListener("change", (e) => { estado.periodoId = e.target.value; estado.pagina = 1; cargarLista({ conservarSeleccion: false }); });
  document.querySelector("#audit-filter")?.addEventListener("change", (e) => { estado.expediente = e.target.value === "all" ? "" : e.target.value; estado.pagina = 1; cargarLista({ conservarSeleccion: false }); });

  // ---------- Eventos ----------
    // Un solo escuchador de clics (delegación) para todos los botones de la pantalla.
  document.addEventListener("click", (e) => {
    const expediente = e.target.closest("[data-au-expediente]");
    if (expediente) {
      estado.seleccion = expediente.dataset.auExpediente;
      lista.querySelectorAll("[data-au-expediente]").forEach((b) => b.classList.toggle("active", b === expediente));
      cargarDetalle();
      return;
    }
    const filtro = e.target.closest("[data-au-filtro]");
    if (filtro) {
      estado.expediente = estado.expediente === filtro.dataset.auFiltro ? "" : filtro.dataset.auFiltro;
      const select = document.querySelector("#audit-filter");
      if (select) select.value = estado.expediente || "all";
      estado.pagina = 1;
      cargarLista({ conservarSeleccion: false });
      return;
    }
    const pagina = e.target.closest("[data-au-pagina]");
    if (pagina && !pagina.disabled) { estado.pagina = Number(pagina.dataset.auPagina); cargarLista({ conservarSeleccion: false }); return; }
    if (e.target.closest("[data-au-retry-lista]")) { cargarLista(); return; }
    if (e.target.closest("[data-au-retry-detalle]")) { cargarDetalle(); return; }
    const menu = e.target.closest("[data-au-menu]");
    if (menu) {
      const caja = menu.nextElementSibling;
      document.querySelectorAll(".document-more-menu").forEach((m) => { if (m !== caja) m.hidden = true; });
      caja.hidden = !caja.hidden;
      return;
    }
    const ver = e.target.closest("[data-au-ver]");
    if (ver) { verPdf(ver.dataset.auVer); return; }
    const aprobar = e.target.closest("[data-au-aprobar]");
    if (aprobar) { aprobar.disabled = true; revisar(aprobar.dataset.auAprobar, { decision: "APROBAR" }, "Documento aprobado correctamente"); return; }
    const pendiente = e.target.closest("[data-au-pendiente]");
    if (pendiente) { revisar(pendiente.dataset.auPendiente, { decision: "PENDIENTE" }, "Documento devuelto a revisión"); return; }
    const rechazar = e.target.closest("[data-au-rechazar]");
    if (rechazar) { abrirRechazo(rechazar.dataset.auRechazar, rechazar.dataset.nombre || "documento"); return; }
    const todo = e.target.closest("[data-au-aprobar-todo]");
    if (todo && !todo.disabled) aprobarTodo(todo);
  });

  // ---------- Inicio ----------
  (async () => {
    const selector = document.querySelector("#audit-period-filter");
    try { estado.periodos = (await api.get("/periods")).data; } catch (error) { showToast(mensajeDeError(error)); }
    const activo = estado.periodos.find((p) => p.es_activo) || estado.periodos[0];
    estado.periodoId = activo?.id ?? "";
    if (selector) selector.innerHTML = estado.periodos.length
      ? estado.periodos.map((p) => `<option value="${escapar(p.id)}" ${p.id === estado.periodoId ? "selected" : ""}>${escapar(p.codigo)}${p.es_activo ? " (activo)" : ""}</option>`).join("")
      : `<option value="">Sin periodos</option>`;
    cargarLista({ conservarSeleccion: false });
  })();
}

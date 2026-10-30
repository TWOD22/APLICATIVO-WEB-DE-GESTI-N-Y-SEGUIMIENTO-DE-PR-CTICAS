/**
 * "Solicitudes de práctica" del Director (flujo v2): bandeja de solicitudes en trámite y asistente de asignación.
 *
 * Bandeja: filtra por estado y texto; cada fila lleva al asistente.
 * Asistente (4 pasos): 1 Estudiante y trayectoria → 2 Documentos (aprobar / devolver) → 3 Plaza (validar o cambiar con motivo)
 *   → 4 Asesor y confirmar, con la «doble pantalla»: a la izquierda la solicitud y el docente del nivel, a la derecha los
 *   asesores de la institución con cuántos practicantes tiene cada uno. «Confirmar y asignar» deja la práctica ACTIVA.
 * También permite rechazar la solicitud con motivo.
 */
import { api } from "../services/api.js";

const TAMANO_PAGINA = 10;

const ESTADOS = {
  ENVIADA: ["Enviada", "info"],
  DEVUELTA: ["Devuelta al estudiante", "warning"],
  // Estados de solicitudes anteriores al flujo v2.1: se muestran como las demás enviadas.
  DOCUMENTOS_APROBADOS: ["Enviada", "info"],
  PLAZA_SELECCIONADA: ["Enviada", "info"],
  RECHAZADA: ["Rechazada", "danger"],
};
const ESTADO_DOC = {
  APROBADO: ["Aprobado", "success"],
  EN_REVISION: ["En revisión", "info"],
  POR_CORREGIR: ["Por corregir", "danger"],
  SIN_CARGAR: ["Sin cargar", "neutral"],
};
const MOTIVOS_RECHAZO_DOC = [
  "El documento está vencido",
  "El archivo no es legible",
  "Faltan firmas o sellos requeridos",
  "El documento no corresponde al requisito",
  "Otro motivo",
];
const PASOS = [
  { id: 1, titulo: "Estudiante", ayuda: "Quién solicita" },
  { id: 2, titulo: "Documentos", ayuda: "Aprobar o devolver" },
  { id: 3, titulo: "Plaza", ayuda: "Validar institución" },
  { id: 4, titulo: "Asesor", ayuda: "Confirmar y asignar" },
];

const fecha = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "";
};
const diasDesde = (valor) => {
  const d = valor ? new Date(valor) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
};
const textoEspera = (dias) => (dias === null ? "" : dias === 0 ? "Hoy" : dias === 1 ? "Hace 1 día" : `Hace ${dias} días`);

/**
 * @param {object} ui Utilidades compartidas: badge, escapar, icon, initials, openModal, pathFor, showToast.
 */
export function montarSolicitudes(ui) {
  const { badge, escapar, icon, initials, openModal, showToast } = ui;
  const pagina = document.querySelector(".page");

  const mensaje = (error) => {
    const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje || d?.nombre).map((d) => d.mensaje ?? d.nombre) : [];
    return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
  };
  const errorHtml = (texto, accion = "reintentar") => `<div class="practice-empty"><p class="form-error" role="alert">${escapar(texto)}</p><button class="btn btn-secondary" type="button" data-sd="${accion}">Reintentar</button></div>`;

  const lista = { q: "", estado: "", pagina: 1, turno: 0 };
  const asistente = { id: null, solicitud: null, documentos: null, historial: null, asesores: null, plazas: null, paso: 2, plazaFinal: null, motivoCambio: "", asesorId: null, inicio: "", fin: "", ocupado: false };

  function confirmar({ titulo, texto, boton, peligro = false }) {
    return new Promise((resolver) => {
      const ventana = openModal(escapar(titulo), `<div class="practice-confirm"><p>${escapar(texto)}</p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn ${peligro ? "btn-danger" : "btn-primary"}" type="button" data-sd-ok>${escapar(boton)}</button></div></div>`);
      ventana.addEventListener("click", (e) => {
        if (e.target.closest("[data-sd-ok]")) { ventana.remove(); resolver(true); }
        else if (e.target === ventana || e.target.closest("[data-close]")) resolver(false);
      });
    });
  }

  // ═════════════════════ Bandeja ═════════════════════
  function cabeceraBandeja() {
    return `<header class="page-title"><div><span class="eyebrow">Flujo de prácticas</span><h2>Solicitudes de práctica</h2><p>Revisa los documentos y la plaza que pidió cada estudiante, y asígnale su asesor. Puedes cambiar la plaza dejando el motivo.</p></div></header>
      <section class="panel"><div class="toolbar assignment-toolbar">
        <label class="search"><span class="sr-only">Buscar solicitud</span><input id="sd-buscar" placeholder="Buscar estudiante, cédula o institución…" value="${escapar(lista.q)}" /></label>
        <select id="sd-estado" aria-label="Filtrar por estado"><option value="">Todas las abiertas</option>${[["ENVIADA", "Enviadas (por revisar o asignar)"], ["DEVUELTA", "Devueltas al estudiante"]].map(([e, t]) => `<option value="${e}" ${lista.estado === e ? "selected" : ""}>${t}</option>`).join("")}</select>
      </div><div id="sd-tabla"></div></section>`;
  }

  async function cargarBandeja() {
    const contenedor = pagina.querySelector("#sd-tabla");
    if (!contenedor) return;
    const turno = ++lista.turno;
    contenedor.innerHTML = `<p class="muted practice-empty">Cargando solicitudes…</p>`;
    try {
      const consulta = { page: lista.pagina, page_size: TAMANO_PAGINA };
      if (lista.q) consulta.q = lista.q;
      if (lista.estado) consulta.estado = lista.estado;
      const { data, meta } = await api.get("/practice-requests", consulta);
      if (turno !== lista.turno) return;
      pintarBandeja(contenedor, data, meta);
    } catch (error) {
      if (turno === lista.turno) contenedor.innerHTML = errorHtml(mensaje(error));
    }
  }

  function pintarBandeja(contenedor, filas, meta) {
    const cuerpo = filas.map((s) => {
      const paraAsignar = Boolean(s.expediente?.expediente_completo) && s.estado !== "DEVUELTA";
      const [texto, tono] = paraAsignar ? ["Lista para asignar", "success"] : s.estado === "ENVIADA" ? ["Documentos por revisar", "info"] : (ESTADOS[s.estado] || [s.estado, "neutral"]);
      const espera = textoEspera(diasDesde(s.enviada_en));
      const avance = s.expediente ? `<small>${s.expediente.aprobados_obligatorios}/${s.expediente.total_obligatorios} documentos aprobados</small>` : "";
      return `<tr><td><div class="person"><span class="avatar">${escapar(initials(s.estudiante.nombre_completo))}</span><span><strong>${escapar(s.estudiante.nombre_completo)}</strong><small>${escapar(s.estudiante.documento || "")}</small></span></div></td>
        <td><strong>${escapar(s.nivel.nombre)}</strong><small>${escapar(s.periodo.codigo)}</small></td>
        <td>${badge(texto, tono)}${avance}${espera ? `<small>${escapar(espera)}</small>` : ""}</td>
        <td>${s.institucion_solicitada ? `<strong>${escapar(s.institucion_solicitada.nombre)}</strong><small>${escapar(s.institucion_solicitada.ciudad || "")}</small>` : '<small>Sin plaza pedida</small>'}</td>
        <td><button class="btn ${paraAsignar ? "btn-primary" : "btn-secondary"}" type="button" data-sd="abrir" data-id="${escapar(s.id)}">${paraAsignar ? "Asignar" : "Revisar"}</button></td></tr>`;
    }).join("") || `<tr><td colspan="5"><div class="empty-state">No hay solicitudes con estos filtros.</div></td></tr>`;
    const botones = [`<button type="button" data-sd="pagina" data-n="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>`];
    for (let n = 1; n <= meta.total_pages; n++) botones.push(`<button type="button" class="${n === meta.page ? "active" : ""}" data-sd="pagina" data-n="${n}">${n}</button>`);
    botones.push(`<button type="button" data-sd="pagina" data-n="${meta.page + 1}" ${meta.page >= meta.total_pages ? "disabled" : ""} aria-label="Página siguiente">›</button>`);
    const desde = meta.total ? (meta.page - 1) * meta.page_size + 1 : 0;
    contenedor.innerHTML = `<div class="table-wrap"><table class="assignment-table"><thead><tr><th>Estudiante</th><th>Práctica</th><th>Estado</th><th>Plaza pedida</th><th>Acción</th></tr></thead><tbody>${cuerpo}</tbody></table></div>
      <footer class="pagination"><span>Mostrando ${desde} - ${Math.min(meta.page * meta.page_size, meta.total)} de ${meta.total} solicitudes</span><nav aria-label="Paginación">${botones.join("")}</nav></footer>`;
  }

  function verBandeja() {
    asistente.id = null;
    history.replaceState(null, "", window.location.pathname);
    pagina.innerHTML = cabeceraBandeja();
    cargarBandeja();
  }

  // ═════════════════════ Asistente ═════════════════════
  async function abrirAsistente(id) {
    Object.assign(asistente, { id, solicitud: null, documentos: null, historial: null, asesores: null, plazas: null, plazaFinal: null, motivoCambio: "", asesorId: null, inicio: "", fin: "", ocupado: false });
    history.replaceState(null, "", `${window.location.pathname}?id=${encodeURIComponent(id)}`);
    pagina.innerHTML = `<p class="muted practice-empty">Cargando solicitud…</p>`;
    try {
      await recargarSolicitud();
    } catch (error) {
      pagina.innerHTML = `${errorHtml(mensaje(error), "reintentar-asistente")}<div class="practice-empty"><button class="btn-link" type="button" data-sd="volver">← Volver a solicitudes</button></div>`;
      return;
    }
    // Una solicitud que ya no está abierta (asignada, rechazada…) no se gestiona aquí: se muestra su detalle o se vuelve a la bandeja.
    const abierta = ["ENVIADA", "DEVUELTA", "DOCUMENTOS_APROBADOS", "PLAZA_SELECCIONADA"].includes(asistente.solicitud.estado);
    if (!abierta) {
      if (asistente.solicitud.institucion) {
        window.location.replace(`${ui.pathFor("director", "practica")}?id=${encodeURIComponent(id)}`);
        return;
      }
      showToast("Esa solicitud ya no está abierta.");
      verBandeja();
      return;
    }
    // Con el expediente aprobado se abre en la plaza (siguiente decisión); si no, en los documentos.
    asistente.paso = pasoMaximo(asistente.solicitud) >= 3 ? 3 : 2;
    pintarAsistente();
  }

  /** Trae la solicitud, sus documentos y el historial del estudiante (y los asesores si ya hay plaza). */
  async function recargarSolicitud() {
    const { data: solicitud } = await api.get(`/practice-assignments/${asistente.id}`);
    asistente.solicitud = solicitud;
    const [docs, historial] = await Promise.all([
      api.get(`/practice-assignments/${asistente.id}/legal-documents`).then((r) => r.data).catch(() => null),
      api.get(`/users/${solicitud.estudiante.id}/practices`).then((r) => r.data).catch(() => []),
    ]);
    asistente.documentos = docs;
    asistente.historial = historial;
    if (pasoMaximo(solicitud, docs) >= 4) {
      asistente.plazaFinal ??= solicitud.institucion_solicitada?.id ?? null;
      await cargarAsesores();
    }
  }

  async function cargarAsesores() {
    asistente.asesores = null;
    try {
      const consulta = asistente.plazaFinal && asistente.plazaFinal !== asistente.solicitud.institucion_solicitada?.id ? { institucion_id: asistente.plazaFinal } : undefined;
      const { data } = await api.get(`/practice-requests/${asistente.id}/advisors`, consulta);
      asistente.asesores = data;
      if (data.asesor_unico) asistente.asesorId = data.asesor_unico;
      else if (!data.asesores.some((a) => a.id === asistente.asesorId)) asistente.asesorId = null;
    } catch (error) {
      asistente.asesores = { error: mensaje(error), asesores: [] };
    }
  }

  // ¿Hasta qué paso puede llegar el Director con el estado actual?
  // Con todos los documentos obligatorios aprobados se puede validar la plaza y asignar; si no, solo revisar documentos.
  const pasoMaximo = (solicitud, docs = asistente.documentos) => {
    if (solicitud.estado === "DEVUELTA") return 2;
    return docs?.resumen?.expediente_completo ? 4 : 2;
  };

  function stepper() {
    const s = asistente.solicitud;
    const maximo = pasoMaximo(s);
    return `<ol class="practice-steps steps-4" aria-label="Pasos de la asignación">${PASOS.map((p) => {
      const clase = p.id < asistente.paso ? "done" : p.id === asistente.paso ? "current" : "todo";
      const bloqueado = p.id > maximo;
      return `<li class="${clase}" ${p.id === asistente.paso ? 'aria-current="step"' : ""}><button type="button" class="step-btn" data-sd="paso" data-n="${p.id}" ${bloqueado ? "disabled" : ""}><span class="step-dot">${p.id < asistente.paso ? icon("check") : p.id}</span><span class="step-text"><strong>${p.titulo}</strong><small>${p.ayuda}</small></span></button></li>`;
    }).join("")}</ol>`;
  }

  function pintarAsistente() {
    const s = asistente.solicitud;
    const [texto, tono] = ESTADOS[s.estado] || [s.estado, "neutral"];
    const cuerpo = [null, paso1, paso2, paso3, paso4][asistente.paso]();
    const cerrada = !["ENVIADA", "DEVUELTA", "DOCUMENTOS_APROBADOS", "PLAZA_SELECCIONADA"].includes(s.estado);
    pagina.innerHTML = `<button class="btn-link sd-back" type="button" data-sd="volver">← Volver a solicitudes</button>
      <section class="welcome"><div><span class="eyebrow">Solicitud de práctica · ${escapar(s.periodo.codigo)}</span><h2>${escapar(s.estudiante.nombre_completo)}</h2><p>${escapar(s.nivel.nombre)}${s.enviada_en ? ` · enviada el ${escapar(fecha(s.enviada_en))}` : ""}</p></div><div class="sd-head-actions">${badge(texto, tono)}${cerrada ? "" : '<button class="btn btn-danger" type="button" data-sd="rechazar">Rechazar solicitud</button>'}</div></section>
      <section class="practice-panel panel content-block">${stepper()}</section>
      ${cerrada ? `<div class="notice notice-warning" role="status">${icon("alert")}<span>Esta solicitud ya no está abierta (${escapar(texto)}).</span></div>` : ""}
      ${cuerpo}`;
  }

  const pie = ({ anterior, siguiente, siguienteEtiqueta = "Continuar →", siguienteOff = false }) =>
    `<div class="form-actions sd-footer">${anterior ? `<button class="btn btn-secondary" type="button" data-sd="paso" data-n="${anterior}">← Anterior</button>` : "<span></span>"}${siguiente ? `<button class="btn btn-primary" type="button" data-sd="paso" data-n="${siguiente}" ${siguienteOff ? "disabled" : ""}>${siguienteEtiqueta}</button>` : ""}</div>`;

  // ── Paso 1: estudiante y trayectoria ──
  function paso1() {
    const s = asistente.solicitud;
    const est = s.estudiante;
    const historial = (asistente.historial ?? []).filter((h) => h.asignacion_id !== s.id);
    const estadoHist = { FINALIZADA: ["Finalizada", "success"], ACTIVA: ["En curso", "info"], PENDIENTE_EVALUACION: ["Por evaluar", "warning"], CANCELADA: ["Cancelada", "neutral"], RECHAZADA: ["Rechazada", "danger"] };
    return `<section class="dashboard-grid practice-main">
      <article class="panel content-block"><span class="eyebrow">Paso 1 · Estudiante</span><h3>${escapar(est.nombre_completo)}</h3>
        <div class="practice-facts sd-facts"><div><span>Documento</span><strong>${escapar(est.documento || "—")}</strong></div><div><span>Semestre</span><strong>${escapar(String(est.semestre ?? "—"))}</strong></div><div><span>Nivel solicitado</span><strong>${escapar(s.nivel.nombre)}</strong></div></div>
        <p class="muted">${est.correo ? `Correo: ${escapar(est.correo)}` : ""}</p>
        ${pie({ siguiente: 2 })}</article>
      <article class="panel content-block"><span class="eyebrow">Prácticas anteriores</span>
        ${historial.length ? `<ul class="trajectory">${historial.map((h) => { const [t, tn] = estadoHist[h.estado] || [h.estado, "neutral"]; return `<li class="${h.estado === "FINALIZADA" ? "done" : "current"}"><strong>${escapar(h.nivel_nombre)}</strong><small>${escapar(h.periodo_codigo)}${h.institucion_nombre ? ` · ${escapar(h.institucion_nombre)}` : ""}</small>${badge(t, tn)}</li>`; }).join("")}</ul>` : '<p class="muted">Es su primera práctica: no tiene prácticas anteriores.</p>'}</article></section>`;
  }

  // ── Paso 2: documentos ──
  function filaDocumento(d, editable) {
    const [texto, tono] = ESTADO_DOC[d.estado] || ESTADO_DOC.SIN_CARGAR;
    const detalle = d.estado === "POR_CORREGIR" ? `Devuelto: ${escapar(d.observacion || "")}` : d.estado === "SIN_CARGAR" ? "El estudiante aún no lo carga" : `${escapar(d.archivo?.nombre || "Archivo")}${d.enviado_en ? ` · enviado el ${escapar(fecha(d.enviado_en))}` : ""}`;
    const ver = d.documento_id ? `<button class="btn btn-ghost" type="button" data-sd="ver" data-doc="${escapar(d.documento_id)}">Ver PDF</button>` : "";
    const aprobar = editable && d.estado === "EN_REVISION" ? `<button class="btn btn-secondary" type="button" data-sd="aprobar-doc" data-doc="${escapar(d.documento_id)}">Aprobar</button>` : "";
    const devolver = editable && ["EN_REVISION", "APROBADO"].includes(d.estado) ? `<button class="btn btn-danger" type="button" data-sd="devolver-doc" data-doc="${escapar(d.documento_id)}" data-nombre="${escapar(d.tipo.nombre)}">Devolver</button>` : "";
    return `<article class="req-doc req-${tono}"><div class="req-doc-info"><strong>${escapar(d.tipo.nombre)}${d.obligatorio ? "" : " <small>(opcional)</small>"}</strong><p>${detalle}</p></div><div class="req-doc-actions">${badge(texto, tono)}${ver}${aprobar}${devolver}</div></article>`;
  }

  function paso2() {
    const s = asistente.solicitud;
    const docs = asistente.documentos;
    if (!docs) return `<article class="panel content-block"><span class="eyebrow">Paso 2 · Documentos</span>${errorHtml("No se pudieron cargar los documentos del expediente.")}</article>`;
    const editable = ["ENVIADA", "DEVUELTA", "DOCUMENTOS_APROBADOS", "PLAZA_SELECCIONADA"].includes(s.estado);
    const r = docs.resumen;
    const obligatorios = docs.documentos.filter((d) => d.obligatorio);
    const todosCargados = obligatorios.every((d) => ["EN_REVISION", "APROBADO"].includes(d.estado));
    const porRevisar = docs.documentos.filter((d) => d.estado === "EN_REVISION").length;
    const puedeAprobarTodo = editable && todosCargados && r.por_corregir === 0 && porRevisar > 0;
    const aviso = s.estado === "DEVUELTA"
      ? `<div class="notice notice-warning" role="status">${icon("alert")}<span>Devolviste esta solicitud: el estudiante corregirá los documentos marcados y la reenviará.</span></div>`
      : r.expediente_completo ? `<div class="document-complete-banner">${icon("check")}<div><strong>Expediente aprobado.</strong><span>Continúa para validar la plaza y asignar el asesor.</span></div></div>` : "";
    return `<article class="panel content-block"><header class="practice-block-head"><div><span class="eyebrow">Paso 2 · Documentos</span><h3>Expediente del estudiante</h3></div><span class="practice-count">${r.aprobados_obligatorios} de ${r.total_obligatorios} obligatorios aprobados</span></header>
      ${aviso}
      <div class="req-doc-list">${docs.documentos.map((d) => filaDocumento(d, editable)).join("")}</div>
      <div class="form-actions sd-footer"><button class="btn btn-secondary" type="button" data-sd="paso" data-n="1">← Anterior</button><span class="sd-spacer"></span>
        ${puedeAprobarTodo ? '<button class="btn btn-primary" type="button" data-sd="aprobar-todo">Aprobar expediente completo</button>' : ""}
        ${pasoMaximo(s) >= 3 ? '<button class="btn btn-primary" type="button" data-sd="paso" data-n="3">Continuar →</button>' : ""}</div>
      ${!editable || puedeAprobarTodo ? "" : `<small class="muted practice-hint">${r.por_corregir ? "Hay documentos devueltos: espera la corrección del estudiante." : todosCargados ? "" : "Aún faltan documentos obligatorios por cargar."}</small>`}
    </article>`;
  }

  // ── Paso 3: plaza ──
  function paso3() {
    const s = asistente.solicitud;
    const elegida = s.institucion_solicitada;
    const cambia = asistente.plazaFinal && asistente.plazaFinal !== elegida?.id;
    const plazaNueva = asistente.plazas?.find((p) => p.id === asistente.plazaFinal);
    return `<article class="panel content-block"><span class="eyebrow">Paso 3 · Plaza</span><h3>Validar la plaza pedida</h3>
      <p class="muted">Confirma que la institución tiene cupo y te sirve. Si no, cámbiala dejando el motivo: el estudiante será avisado.</p>
      <div class="site-chosen">${icon("building")}<div><strong>${escapar(elegida?.nombre || "—")}</strong><small>${escapar(elegida?.ciudad || "")} · plaza que pidió el estudiante</small></div></div>
      ${cambia ? `<div class="notice notice-warning" role="status">${icon("alert")}<span>Vas a cambiar la plaza a <strong>${escapar(plazaNueva?.nombre || "otra institución")}</strong>. Debes dejar el motivo; el estudiante será avisado.</span></div>
        <label class="field"><span>Motivo del cambio de plaza (obligatorio)</span><textarea data-sd-motivo rows="3" placeholder="Explica por qué cambias la plaza…">${escapar(asistente.motivoCambio)}</textarea></label>` : ""}
      <div class="form-actions sd-footer"><button class="btn btn-secondary" type="button" data-sd="paso" data-n="2">← Anterior</button><span class="sd-spacer"></span>
        <button class="btn btn-secondary" type="button" data-sd="cambiar-plaza">${cambia ? "Elegir otra institución" : "Cambiar plaza"}</button>
        ${cambia ? '<button class="btn btn-secondary" type="button" data-sd="mantener-plaza">Mantener la del estudiante</button>' : ""}
        <button class="btn btn-primary" type="button" data-sd="paso" data-n="4" ${cambia && asistente.motivoCambio.trim().length < 5 ? "disabled" : ""}>Validar y continuar →</button></div></article>`;
  }

  // ── Paso 4: asesor y confirmar (doble pantalla) ──
  function paso4() {
    const s = asistente.solicitud;
    const a = asistente.asesores;
    if (!a) return `<p class="muted practice-empty">Cargando asesores…</p>`;
    const plazaFinal = a.institucion;
    const sinDocente = !a.error && !a.docente;
    const sinAsesores = !a.error && a.asesores.length === 0;
    const listo = !a.error && !sinDocente && !sinAsesores && asistente.asesorId;
    const izquierda = `<article class="panel content-block sd-screen"><span class="eyebrow">Pantalla 1 · La solicitud</span><h3>${escapar(s.estudiante.nombre_completo)}</h3>
        <dl class="sd-dl"><div><dt>Práctica</dt><dd>${escapar(s.nivel.nombre)} · ${escapar(s.periodo.codigo)}</dd></div>
        <div><dt>Plaza</dt><dd>${escapar(plazaFinal?.nombre || "—")}</dd></div>
        <div><dt>Docente del nivel</dt><dd>${a.docente ? escapar(`${a.docente.nombres} ${a.docente.apellidos}`) : '<span class="sd-missing">Sin docente configurado</span>'}</dd></div></dl>
        ${sinDocente ? `<div class="notice notice-warning" role="alert">${icon("alert")}<span>Este nivel no tiene docente en el periodo. <a href="${ui.pathFor("director", "docentes")}">Configura el docente del nivel</a> y vuelve aquí.</span></div>` : ""}
        <div class="form-grid sd-dates"><label class="field"><span>Inicio de la práctica (opcional)</span><input type="date" data-sd-inicio value="${escapar(asistente.inicio)}" /></label><label class="field"><span>Fin de la práctica (opcional)</span><input type="date" data-sd-fin value="${escapar(asistente.fin)}" /></label></div>
      </article>`;
    const tarjetas = a.asesores.map((x) => `<label class="site-card ${asistente.asesorId === x.id ? "selected" : ""}"><input type="radio" name="asesor" value="${escapar(x.id)}" ${asistente.asesorId === x.id ? "checked" : ""} ${a.asesor_unico ? "disabled" : ""} /><span class="site-icon">${icon("users")}</span><span class="site-info"><strong>${escapar(`${x.nombres} ${x.apellidos}`)}</strong><small>${escapar(x.cargo || x.correo || "Asesor de sitio")}</small></span><span class="sd-load ${x.practicantes === 0 ? "free" : ""}"><strong>${x.practicantes}</strong><small>${x.practicantes === 1 ? "practicante" : "practicantes"}</small></span></label>`).join("");
    const derecha = `<article class="panel content-block sd-screen"><span class="eyebrow">Pantalla 2 · Asesores de la institución</span><h3>${escapar(plazaFinal?.nombre || "Institución")}</h3>
        ${a.error ? errorHtml(a.error, "recargar-asesores") : sinAsesores ? `<div class="notice notice-warning" role="alert">${icon("alert")}<span>Esta institución no tiene asesores activos en el periodo. Vincula uno desde Gestión de Usuarios e Instituciones.</span></div>`
          : `<p class="muted">${a.asesor_unico ? "Es la única asesora disponible: se asignará automáticamente." : "Elige el asesor. El número indica cuántos practicantes tiene ya en este periodo."}</p><div class="site-list" role="radiogroup" aria-label="Asesores disponibles">${tarjetas}</div>`}
      </article>`;
    return `<section class="sd-double">${izquierda}${derecha}</section>
      <div class="form-actions sd-footer"><button class="btn btn-secondary" type="button" data-sd="paso" data-n="3">← Anterior</button><span class="sd-spacer"></span><button class="btn btn-primary" type="button" data-sd="confirmar" ${listo ? "" : "disabled"}>Confirmar y asignar →</button></div>`;
  }

  // ═════════════════════ Acciones ═════════════════════
  async function ejecutar(tarea, exito, { recargar = true } = {}) {
    if (asistente.ocupado) return false;
    asistente.ocupado = true;
    try {
      await tarea();
      if (exito) showToast(exito);
      if (recargar) await recargarSolicitud();
      return true;
    } catch (error) {
      showToast(mensaje(error));
      return false;
    } finally {
      asistente.ocupado = false;
    }
  }

  function abrirModalDevolver(documentoId, nombre) {
    const ventana = openModal(`Devolver ${escapar(nombre)}`, `<form id="sd-devolver" novalidate><p class="muted">El estudiante recibirá esta observación y deberá cargar el documento corregido. Tu solicitud quedará devuelta.</p>
      <label class="field"><span>Motivo</span><select name="motivo">${MOTIVOS_RECHAZO_DOC.map((m) => `<option>${escapar(m)}</option>`).join("")}</select></label>
      <label class="field"><span>Observación (obligatoria)</span><textarea name="observacion" rows="3" required placeholder="Indica qué debe corregir…"></textarea></label>
      <p class="form-error" role="alert" data-error hidden></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-danger" type="submit">Devolver documento</button></div></form>`);
    ventana.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const observacion = f.observacion.value.trim();
      const error = ventana.querySelector("[data-error]");
      if (observacion.length < 5) { error.textContent = "Describe el motivo (mínimo 5 caracteres)."; error.hidden = false; return; }
      ventana.remove();
      const ok = await ejecutar(() => api.post(`/legal-documents/${documentoId}/review`, { decision: "RECHAZAR", motivo: f.motivo.value, observacion }), "Documento devuelto al estudiante");
      if (ok) { if (asistente.solicitud.estado === "DEVUELTA") asistente.paso = 2; pintarAsistente(); }
    });
  }

  function abrirModalRechazo() {
    const ventana = openModal("Rechazar solicitud", `<form id="sd-rechazo" novalidate><p class="muted">La solicitud se cierra y el estudiante podrá solicitar de nuevo. Recibirá tu motivo.</p>
      <label class="field"><span>Motivo (obligatorio)</span><textarea name="motivo" rows="3" required placeholder="Explica por qué se rechaza…"></textarea></label>
      <p class="form-error" role="alert" data-error hidden></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Volver</button><button class="btn btn-danger" type="submit">Rechazar solicitud</button></div></form>`);
    ventana.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const motivo = e.target.motivo.value.trim();
      const error = ventana.querySelector("[data-error]");
      if (motivo.length < 5) { error.textContent = "Describe el motivo (mínimo 5 caracteres)."; error.hidden = false; return; }
      ventana.remove();
      const ok = await ejecutar(() => api.post(`/practice-requests/${asistente.id}/reject`, { motivo }), "Solicitud rechazada", { recargar: false });
      if (ok) verBandeja();
    });
  }

  async function elegirOtraPlaza() {
    if (!asistente.plazas) {
      try {
        ({ data: asistente.plazas } = await api.get("/practice-requests/available-sites"));
      } catch (error) {
        showToast(mensaje(error));
        return;
      }
    }
    const actual = asistente.solicitud.institucion_solicitada?.id;
    const ventana = openModal("Elegir otra institución", `<div><p class="muted">Solo instituciones activas con convenio vigente.</p><div class="site-list" role="radiogroup">${asistente.plazas.map((p) => `<label class="site-card ${p.id === asistente.plazaFinal ? "selected" : ""}"><input type="radio" name="otra" value="${escapar(p.id)}" ${p.id === asistente.plazaFinal ? "checked" : ""} /><span class="site-icon">${icon("building")}</span><span class="site-info"><strong>${escapar(p.nombre)}</strong><small>${escapar([p.ciudad, p.direccion].filter(Boolean).join(" · "))}</small></span>${p.id === actual ? badge("Elección del estudiante", "info") : ""}</label>`).join("")}</div><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="button" data-sd-usar>Usar esta institución</button></div></div>`);
    ventana.addEventListener("click", async (e) => {
      if (!e.target.closest("[data-sd-usar]")) return;
      const marcada = ventana.querySelector('input[name="otra"]:checked');
      if (!marcada) return showToast("Selecciona una institución");
      ventana.remove();
      asistente.plazaFinal = marcada.value;
      if (asistente.plazaFinal === actual) asistente.motivoCambio = "";
      await cargarAsesores();
      pintarAsistente();
    });
  }

  async function confirmarAsignacion() {
    const s = asistente.solicitud;
    const a = asistente.asesores;
    const cambia = asistente.plazaFinal !== s.institucion_solicitada?.id;
    const nombreAsesor = a.asesores.find((x) => x.id === asistente.asesorId);
    const ok = await confirmar({
      titulo: "Confirmar y asignar",
      texto: `Se asignará a ${s.estudiante.nombre_completo} a ${a.institucion.nombre} con ${nombreAsesor ? `${nombreAsesor.nombres} ${nombreAsesor.apellidos}` : "el asesor elegido"} y docente ${a.docente.nombres} ${a.docente.apellidos}. La práctica quedará activa y se avisará a los tres. ¿Confirmas?`,
      boton: "Sí, asignar",
    });
    if (!ok) return;
    const cuerpo = { asesor_sitio_id: asistente.asesorId };
    if (cambia) { cuerpo.institucion_id = asistente.plazaFinal; cuerpo.motivo_cambio_plaza = asistente.motivoCambio.trim(); }
    if (asistente.inicio) cuerpo.fecha_inicio = asistente.inicio;
    if (asistente.fin) cuerpo.fecha_fin = asistente.fin;
    const hecho = await ejecutar(() => api.post(`/practice-requests/${asistente.id}/assign`, cuerpo), "Práctica asignada: ya está activa", { recargar: false });
    if (hecho) verBandeja();
  }

  async function ver(documentoId) {
    const ventana = window.open("", "_blank");
    try {
      const { data } = await api.get(`/legal-documents/${documentoId}/download-url`);
      if (ventana) ventana.location.href = data.url; else window.location.assign(data.url);
    } catch (error) {
      ventana?.close();
      showToast(mensaje(error));
    }
  }

  // ═════════════════════ Eventos ═════════════════════
  pagina.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-sd]");
    if (!el) return;
    const accion = el.dataset.sd;
    if (accion === "abrir") return abrirAsistente(el.dataset.id);
    if (accion === "volver") return verBandeja();
    if (accion === "reintentar") return asistente.id ? abrirAsistente(asistente.id) : cargarBandeja();
    if (accion === "reintentar-asistente") return abrirAsistente(asistente.id);
    if (accion === "pagina") { lista.pagina = Number(el.dataset.n); return cargarBandeja(); }
    if (!asistente.id || !asistente.solicitud) return;

    if (accion === "paso") {
      const n = Number(el.dataset.n);
      if (n > pasoMaximo(asistente.solicitud)) return;
      asistente.paso = n;
      return pintarAsistente();
    }
    if (accion === "ver") return ver(el.dataset.doc);
    if (accion === "aprobar-doc") {
      const ok = await ejecutar(() => api.post(`/legal-documents/${el.dataset.doc}/review`, { decision: "APROBAR" }), "Documento aprobado");
      return ok && pintarAsistente();
    }
    if (accion === "devolver-doc") return abrirModalDevolver(el.dataset.doc, el.dataset.nombre);
    if (accion === "aprobar-todo") {
      const ok = await confirmar({ titulo: "Aprobar expediente", texto: "Se aprobarán todos los documentos en revisión y el estudiante podrá elegir su plaza. ¿Confirmas?", boton: "Sí, aprobar todo" });
      if (!ok) return;
      const hecho = await ejecutar(() => api.post(`/practice-assignments/${asistente.id}/legal-documents/approve-all`), "Expediente aprobado: el estudiante ya puede elegir plaza");
      return hecho && pintarAsistente();
    }
    if (accion === "rechazar") return abrirModalRechazo();
    if (accion === "cambiar-plaza") return elegirOtraPlaza();
    if (accion === "mantener-plaza") {
      asistente.plazaFinal = asistente.solicitud.institucion_solicitada?.id ?? null;
      asistente.motivoCambio = "";
      await cargarAsesores();
      return pintarAsistente();
    }
    if (accion === "recargar-asesores") { await cargarAsesores(); return pintarAsistente(); }
    if (accion === "confirmar") return confirmarAsignacion();
  });

  pagina.addEventListener("change", (e) => {
    if (e.target.id === "sd-estado") { lista.estado = e.target.value; lista.pagina = 1; cargarBandeja(); }
    if (e.target.matches('input[name="asesor"]')) {
      asistente.asesorId = e.target.value;
      pagina.querySelectorAll(".site-card").forEach((c) => c.classList.toggle("selected", c.contains(e.target)));
      pagina.querySelector('[data-sd="confirmar"]')?.removeAttribute("disabled");
      if (asistente.asesores?.docente === null) pagina.querySelector('[data-sd="confirmar"]')?.setAttribute("disabled", "");
    }
    if (e.target.matches("[data-sd-inicio]")) asistente.inicio = e.target.value;
    if (e.target.matches("[data-sd-fin]")) asistente.fin = e.target.value;
  });

  let temporizador;
  pagina.addEventListener("input", (e) => {
    if (e.target.id === "sd-buscar") {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => { lista.q = e.target.value.trim(); lista.pagina = 1; cargarBandeja(); }, 300);
    }
    if (e.target.matches("[data-sd-motivo]")) {
      asistente.motivoCambio = e.target.value;
      const sigue = [...pagina.querySelectorAll('[data-sd="paso"][data-n="4"]')].pop();
      sigue?.toggleAttribute("disabled", asistente.motivoCambio.trim().length < 5);
    }
  });

  // Arranque: con ?id=… abre directamente el asistente (por ejemplo desde un aviso o el panel).
  const parametros = new URLSearchParams(window.location.search);
  const idInicial = parametros.get("id");
  if (["ENVIADA", "DEVUELTA"].includes(parametros.get("estado"))) lista.estado = parametros.get("estado"); // desde las tarjetas del tablero
  if (idInicial) abrirAsistente(idInicial);
  else verBandeja();
}

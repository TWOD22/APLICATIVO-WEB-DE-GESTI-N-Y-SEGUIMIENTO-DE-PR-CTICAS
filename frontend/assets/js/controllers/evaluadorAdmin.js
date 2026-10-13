/**
 * Panel del Docente supervisor y del Asesor de sitio conectado al API real:
 *  - montarDashboardEvaluador: indicadores y tabla de estudiantes asignados.
 *  - montarEvaluacion: lectura de la bitácora entregada y registro de la nota global (borrador / publicación).
 * Cada evaluador solo ve y registra su propia evaluación (el backend lo garantiza y la interfaz no mezcla la del otro).
 */
import { api } from "../services/api.js";

// Filas por página en la tabla de estudiantes.
const TAMANO_PAGINA = 10;
// Espera (ms) tras dejar de escribir antes de autoguardar el borrador de la evaluación.
const ESPERA_BORRADOR = 1500;
// Textos de los tipos de pregunta, estados de la bitácora y estados de la práctica.
const TIPO_PREGUNTA = { ABIERTA: "Respuesta abierta", CERRADA_UNICA: "Selección única", CERRADA_MULTIPLE: "Selección múltiple" };
const ESTADOS_BITACORA = {
  EN_DESARROLLO: ["En desarrollo", "neutral"], ENVIADA: ["Entregada", "info"], EN_EVALUACION: ["En evaluación", "info"], EVALUADA: ["Evaluada", "success"],
};
const ESTADOS_PRACTICA = { ACTIVA: "En desarrollo", PENDIENTE_EVALUACION: "En evaluación", FINALIZADA: "Finalizada" };

// Utilidades de formato: fecha con hora, plural y mensaje de error.
const fechaHora = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
};
const nota2 = (n) => Number(n).toFixed(2);
const pluralizar = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const mensajeDeError = (error) => {
  const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => d.mensaje) : [];
  return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
};

/** Estado de "mi evaluación" mostrado en tablas e insignias. */
function etiquetaEvaluacion(miEvaluacion) {
  switch (miEvaluacion?.estado) {
    case "PUBLICADA": return [`Calificado · ${nota2(miEvaluacion.nota)}`, "success"];
    case "BORRADOR": return ["En borrador", "info"];
    case "PENDIENTE": return ["Por calificar", "warning"];
    default: return ["Sin entrega", "neutral"];
  }
}

// ═════════════════════════ Dashboard ═════════════════════════

/**
 * Dashboard del Docente supervisor o Asesor de sitio: indicadores y tabla de sus estudiantes.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarDashboardEvaluador(ui) {
  const { badge, escapar, icon, initials, pathFor, role } = ui;
    // Texto de la "contraparte": al asesor se le muestra el docente supervisor y al docente, el asesor de sitio.
  const contraparte = role === "asesor" ? (f) => (f.docente ? `Supervisor UDI: ${f.docente.nombre_completo}` : "Sin docente asignado") : (f) => (f.asesor ? `Asesor: ${f.asesor.nombre_completo}` : "Sin asesor asignado");
  const pagina = document.querySelector(".page");
    // Estado local: página, búsqueda, filtros y `turno` para descartar respuestas viejas.
  const estado = { pagina: 1, q: "", periodo: "", estado: "", turno: 0, periodos: [] };

    // HTML de una tarjeta de indicador.
  const tarjeta = (iconName, valor, rotulo, detalle, tono, atributo) =>
    `<article class="stat-card"><span class="stat-icon ${tono}">${icon(iconName)}</span><div><span>${rotulo}</span><strong ${atributo}>${valor}</strong><small>${detalle}</small></div></article>`;

  pagina.innerHTML = `<header class="welcome"><div><span class="eyebrow" data-ev-periodo>Periodo académico</span><h2>${role === "asesor" ? "Mis practicantes" : "Tutorías asignadas"}</h2><p>${role === "asesor" ? "Acompaña y evalúa a los practicantes asignados a tu institución." : "Realiza seguimiento académico a los estudiantes que tienes asignados."}</p></div></header>
    <section class="stats-grid dashboard-stats">
      ${tarjeta("users", "…", "Estudiantes asignados", "En el periodo seleccionado", "blue", "data-ev-metrica=\"estudiantes\"")}
      ${tarjeta("clipboard", "…", "Por calificar", "Esperan tu evaluación", "orange", "data-ev-metrica=\"pendientes\"")}
      ${tarjeta("edit", "…", "En borrador", "Evaluaciones sin publicar", "purple", "data-ev-metrica=\"en_borrador\"")}
      ${tarjeta("check", "…", "Evaluaciones listas", "Publicadas", "green", "data-ev-metrica=\"evaluados\"")}
    </section>
    <section class="panel"><header class="panel-heading"><div><h3>Seguimiento de estudiantes</h3><p>${role === "asesor" ? "Consulta las bitácoras y el estado de tu valoración de sitio." : "Consulta las bitácoras y el estado de tu evaluación académica."}</p></div></header>
      <div class="filters" style="display:flex;gap:12px;flex-wrap:wrap;padding:0 20px 16px">
        <input type="search" id="ev-buscar" placeholder="Buscar por nombre o documento…" style="flex:1;min-width:220px" aria-label="Buscar estudiante" />
        <select id="ev-periodo" aria-label="Periodo"><option value="">Periodo activo</option></select>
        <select id="ev-estado" aria-label="Estado de la práctica"><option value="">Todas las prácticas</option><option value="ACTIVA">En desarrollo</option><option value="PENDIENTE_EVALUACION">En evaluación</option><option value="FINALIZADA">Finalizadas</option></select>
      </div>
      <div id="ev-tabla"></div>
      <footer class="pagination"><span id="ev-resumen"></span><nav aria-label="Paginación" id="ev-paginas"></nav></footer>
    </section>`;

  const cargando = (texto) => `<p class="muted" style="padding:24px 20px;text-align:center">${texto}</p>`;
  const errorHtml = (mensaje) => `<div style="padding:24px 20px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" data-ev-retry>Reintentar</button></div>`;

    /** Dibuja las tarjetas de indicadores (estudiantes, en desarrollo, pendientes, borradores, evaluados). */
  function pintarIndicadores(resultado) {
    const valores = resultado.status === "fulfilled" ? resultado.value.data.indicadores : null;
    pagina.querySelectorAll("[data-ev-metrica]").forEach((el) => { el.textContent = valores ? valores[el.dataset.evMetrica] ?? 0 : "—"; });
    if (resultado.status === "fulfilled") {
      const periodo = resultado.value.data.periodo;
      pagina.querySelector("[data-ev-periodo]").textContent = periodo ? `Periodo académico ${periodo.codigo}` : "Sin periodo activo";
    }
  }

    /** Fila de la tabla de un estudiante con el estado de su bitácora y de su evaluación. */
  function filaTabla(f) {
    const [textoB, tonoB] = ESTADOS_BITACORA[f.bitacora.estado] || [f.bitacora.estado, "neutral"];
    const [textoE, tonoE] = etiquetaEvaluacion(f.mi_evaluacion);
    const entregada = Boolean(f.bitacora.id);
    const porCalificar = entregada && f.estado === "PENDIENTE_EVALUACION" && ["PENDIENTE", "BORRADOR"].includes(f.mi_evaluacion.estado);
    const accion = entregada
      ? `<a class="btn ${porCalificar ? "btn-primary" : "btn-secondary"}" href="${pathFor(role, "evaluacion")}?asignacion=${escapar(f.id)}">${porCalificar ? "Evaluar" : "Ver bitácora"}</a>`
      : `<small class="muted">Esperando entrega</small>`;
    return `<tr><td><div class="person"><span class="avatar">${escapar(initials(f.estudiante.nombre_completo))}</span><span><strong>${escapar(f.estudiante.nombre_completo)}</strong><small>${escapar(f.estudiante.documento)}</small></span></div></td><td><strong>${escapar(f.nivel.nombre)}</strong><small>${escapar(f.institucion.nombre)} · ${escapar(contraparte(f))}</small></td><td>${badge(textoB, tonoB)}<small>${escapar(ESTADOS_PRACTICA[f.estado] || f.estado)}</small></td><td>${badge(textoE, tonoE)}</td><td>${accion}</td></tr>`;
  }

    /** Dibuja la tabla de estudiantes y la paginación. */
  function pintarTabla(resultado) {
    const tabla = pagina.querySelector("#ev-tabla");
    const resumen = pagina.querySelector("#ev-resumen");
    const botones = pagina.querySelector("#ev-paginas");
    if (resultado.status === "rejected") {
      tabla.innerHTML = errorHtml(resultado.reason?.message || "No se pudo cargar el seguimiento.");
      resumen.textContent = ""; botones.innerHTML = "";
      return;
    }
    const { data, meta } = resultado.value;
    if (!data.length) {
      tabla.innerHTML = cargando("No hay estudiantes asignados con esos filtros.");
      resumen.textContent = "0 estudiantes"; botones.innerHTML = "";
      return;
    }
    tabla.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>Práctica / institución</th><th>Bitácora</th><th>Mi evaluación</th><th>Acción</th></tr></thead><tbody>${data.map(filaTabla).join("")}</tbody></table></div>`;
    const desde = (meta.page - 1) * meta.page_size + 1;
    resumen.textContent = `Mostrando ${desde} - ${desde + data.length - 1} de ${meta.total} estudiantes`;
    const total = meta.total_pages;
    const visibles = [...new Set([1, meta.page - 1, meta.page, meta.page + 1, total])].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    let html = `<button type="button" data-ev-pagina="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>`;
    visibles.forEach((n, i) => {
      if (i && n - visibles[i - 1] > 1) html += '<button type="button" disabled>…</button>';
      html += `<button type="button" data-ev-pagina="${n}" class="${n === meta.page ? "active" : ""}">${n}</button>`;
    });
    html += `<button type="button" data-ev-pagina="${meta.page + 1}" ${meta.page >= total ? "disabled" : ""} aria-label="Página siguiente">›</button>`;
    botones.innerHTML = html;
  }

    /** Pide indicadores y tabla en paralelo (con el periodo y filtros elegidos). */
  async function cargar() {
    const turno = ++estado.turno;
    pagina.querySelector("#ev-tabla").innerHTML = cargando("Cargando estudiantes…");
    const consultaPeriodo = estado.periodo ? { periodo_id: estado.periodo } : {};
    const [indicadores, practicas] = await Promise.allSettled([
      api.get("/dashboard", consultaPeriodo),
      api.get("/dashboard/practices", { ...consultaPeriodo, q: estado.q, estado: estado.estado, page: estado.pagina, page_size: TAMANO_PAGINA }),
    ]);
    if (turno !== estado.turno) return;
    pintarIndicadores(indicadores);
    pintarTabla(practicas);
  }

    /** Llena el selector de periodos académicos. */
  async function cargarPeriodos() {
    try {
      const { data } = await api.get("/periods");
      estado.periodos = data;
      pagina.querySelector("#ev-periodo").innerHTML = `<option value="">Periodo activo${data.find((p) => p.es_activo) ? ` (${escapar(data.find((p) => p.es_activo).codigo)})` : ""}</option>${data.filter((p) => !p.es_activo).map((p) => `<option value="${escapar(p.id)}">${escapar(p.codigo)}</option>`).join("")}`;
    } catch { /* el selector queda solo con el periodo activo */ }
  }

    // Búsqueda con espera de 300 ms y filtros de periodo y estado.
  let temporizador;
  pagina.querySelector("#ev-buscar").addEventListener("input", (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { estado.q = e.target.value.trim(); estado.pagina = 1; cargar(); }, 300);
  });
  pagina.querySelector("#ev-periodo").addEventListener("change", (e) => { estado.periodo = e.target.value; estado.pagina = 1; cargar(); });
  pagina.querySelector("#ev-estado").addEventListener("change", (e) => { estado.estado = e.target.value; estado.pagina = 1; cargar(); });
    // Clics: reintentar, ver evidencia, guardar borrador y publicar.
  pagina.addEventListener("click", (e) => {
    if (e.target.closest("[data-ev-retry]")) { cargar(); return; }
    const pag = e.target.closest("[data-ev-pagina]");
    if (pag && !pag.disabled) { estado.pagina = Number(pag.dataset.evPagina); cargar(); }
  });

  cargarPeriodos();
  cargar();
}

// ═════════════════════════ Evaluación ═════════════════════════

/**
 * Pantalla de evaluación: muestra la bitácora entregada en solo lectura y permite registrar la nota (0.00 a 5.00)
 * y la retroalimentación como borrador (autoguardado) o publicarlas. No se calcula promedio con el otro evaluador.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarEvaluacion(ui) {
  const { badge, escapar, icon, openModal, pathFor, role, showToast } = ui;
  const pagina = document.querySelector(".page");
  const asignacionId = new URLSearchParams(window.location.search).get("asignacion");
    // Estado local: evaluación, datos de la entrega, banderas de guardado y temporizador del autoguardado.
  const estado = { ev: null, datos: null, cola: [], temporizador: null, sucio: false, guardando: false, errorGuardado: false, urls: new Map() };
  let ciclo = null;

  const errorHtml = (mensaje) => `<div style="padding:32px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" data-evl-retry>Reintentar</button> <a class="btn btn-ghost" href="${pathFor(role, "dashboard")}">Volver al listado</a></div>`;

  // ───────────── Carga ─────────────
  async function cargar() {
    clearTimeout(estado.temporizador);
    estado.sucio = false; estado.errorGuardado = false;
    pagina.innerHTML = `<p class="muted" style="padding:32px;text-align:center">Cargando la evaluación…</p>`;
    if (!asignacionId) {
      pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Evaluación de bitácora</span><h2>Selecciona un estudiante</h2><p>Elige a quién evaluar desde tu listado.</p></div></header><a class="btn btn-primary" href="${pathFor(role, "dashboard")}">Ir a ${role === "asesor" ? "Mis practicantes" : "Mis tutorías"}</a>`;
      return;
    }
    try {
      const [cola, propia] = await Promise.all([
        api.get("/evaluations", { page_size: 100 }),
        api.get("/evaluations", { asignacion_id: asignacionId, page_size: 1 }),
      ]);
      estado.cola = cola.data;
      const fila = propia.data[0];
      if (!fila) {
        pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Evaluación de bitácora</span><h2>Aún no hay bitácora para evaluar</h2><p>El estudiante todavía no ha enviado su bitácora definitiva.</p></div></header><a class="btn btn-primary" href="${pathFor(role, "dashboard")}">Volver al listado</a>`;
        return;
      }
      const { data } = await api.get(`/evaluations/${fila.id}`);
      estado.ev = data.evaluacion;
      estado.datos = data;
      pintar();
    } catch (error) {
      pagina.innerHTML = errorHtml(mensajeDeError(error));
    }
  }

  // ───────────── Pintado ─────────────
    // Texto y color de la insignia según el estado de la evaluación.
  const etiquetaEstado = () => {
    const e = estado.ev;
    if (e.estado === "PUBLICADA") return ["Calificado", "success"];
    return e.estado === "BORRADOR" ? ["En borrador", "info"] : ["Por calificar", "warning"];
  };

    /** Barra superior: enlace para volver al panel y selector para pasar al estudiante anterior o siguiente de la cola. */
  function navegacion() {
    const { cola } = estado;
    const indice = cola.findIndex((f) => f.asignacion.id === estado.datos.asignacion.id);
    const enlace = (f) => `${pathFor(role, "evaluacion")}?asignacion=${escapar(f.asignacion.id)}`;
    const anterior = cola.length > 1 && indice >= 0 ? cola[(indice - 1 + cola.length) % cola.length] : null;
    const siguiente = cola.length > 1 && indice >= 0 ? cola[(indice + 1) % cola.length] : null;
    return `<nav class="evaluation-context" aria-label="Navegación de evaluación">
      <a class="back-link" href="${pathFor(role, "dashboard")}">← Volver a ${role === "asesor" ? "Mis practicantes" : "Mis tutorías"}</a>
      ${cola.length > 1 ? `<div class="student-switcher">${anterior ? `<a href="${enlace(anterior)}" aria-label="Estudiante anterior">‹</a>` : ""}<label><span>Estudiante</span><select id="evl-cambiar">${cola.map((f) => `<option value="${escapar(f.asignacion.id)}" ${f.asignacion.id === estado.datos.asignacion.id ? "selected" : ""}>${escapar(f.asignacion.estudiante.nombre_completo)}</option>`).join("")}</select></label>${siguiente ? `<a href="${enlace(siguiente)}" aria-label="Estudiante siguiente">›</a>` : ""}</div>` : ""}
    </nav>`;
  }

    /** Tarjeta de una evidencia de la bitácora (solo lectura). */
  function tarjetaEvidencia(e, bitacoraId) {
    const vista = e.es_imagen ? `<img data-evl-img="${escapar(e.id)}" alt="Vista previa de ${escapar(e.nombre)}" />` : `<span>${icon("file")}<small>PDF</small></span>`;
    const tam = e.tamano_bytes < 1048576 ? `${Math.max(1, Math.round(e.tamano_bytes / 1024))} KB` : `${(e.tamano_bytes / 1048576).toFixed(1)} MB`;
    return `<article class="evidence-card"><button class="evidence-preview" type="button" data-evl-ver="${escapar(e.id)}" title="Abrir en una pestaña nueva" style="border:0;cursor:pointer">${vista}</button><div class="evidence-details"><div class="evidence-file-row"><div><strong title="${escapar(e.nombre)}">${escapar(e.nombre)}</strong><small>${e.es_imagen ? "Imagen" : "PDF"} · ${tam}</small></div></div><p class="evidence-caption">${escapar(e.descripcion || "Sin descripción")}</p></div></article>`;
  }

    /** Pregunta con la respuesta del estudiante (solo lectura). */
  function tarjetaPregunta(p, i, respuesta) {
    const marcadas = new Set(respuesta?.opciones_ids ?? []);
    const cuerpo = p.tipo === "ABIERTA"
      ? `<label class="field"><span class="sr-only">Respuesta registrada</span><textarea readonly>${escapar(respuesta?.texto || "Sin respuesta.")}</textarea></label>`
      : `<div class="student-answer-options readonly-options">${p.opciones.map((o) => `<label><input type="${p.tipo === "CERRADA_UNICA" ? "radio" : "checkbox"}" ${marcadas.has(o.id) ? "checked" : ""} disabled /><span>${escapar(o.etiqueta)}</span></label>`).join("")}</div>`;
    return `<fieldset class="student-question"><legend><span class="student-question-number">${String(i + 1).padStart(2, "0")}</span><span><small>${TIPO_PREGUNTA[p.tipo] || p.tipo}</small>${escapar(p.enunciado)}</span></legend>${cuerpo}</fieldset>`;
  }

    /** Dibuja la entrega del estudiante y el formulario de nota y retroalimentación. */
  function pintar() {
    const { evaluacion: ev, asignacion: a, bitacora: b } = estado.datos;
    const [textoEstado, tonoEstado] = etiquetaEstado();
    const contraparte = role === "asesor" ? (a.docente ? `Supervisor UDI: ${a.docente.nombre_completo}` : "Sin docente asignado") : (a.asesor ? `Asesor de sitio: ${a.asesor.nombre_completo}` : "Sin asesor asignado");
    const preguntas = b.cuestionario?.preguntas ?? [];
    const respuestas = new Map((b.contenido.respuestas || []).map((r) => [r.pregunta_id, r]));
    const respondidas = preguntas.filter((p) => respuestas.has(p.id)).length;
    const editable = ev.editable;
    const publicada = ev.estado === "PUBLICADA";
    const rotuloNota = role === "asesor" ? "Nota global de sitio" : "Nota global académica";

    const aviso = editable && ev.reabierta_en
      ? `<div class="notice"><strong>Dirección reabrió tu evaluación.</strong><br>${escapar(ev.motivo_reapertura || "Revisa la nota y vuelve a publicarla.")}</div>`
      : "";
    const bloqueo = !editable && !publicada
      ? `<div class="notice">Esta evaluación no se puede modificar en este momento${a.estado === "FINALIZADA" ? ": la práctica ya fue finalizada" : ""}.</div>`
      : "";

    pagina.innerHTML = `${navegacion()}
      <header class="page-title evaluation-title"><div><span class="eyebrow">Evaluación de bitácora</span><h2>${escapar(a.estudiante.nombre_completo)}</h2><p>${escapar(a.nivel.nombre)} · ${escapar(a.institucion.nombre)} · ${escapar(contraparte)}</p></div><span class="badge badge-${tonoEstado}" data-evl-estado>${textoEstado}</span></header>
      ${aviso}${bloqueo}
      <section class="two-column site-evaluation-layout">
        <div class="evaluation-submission">
          <article class="panel content-block journal-editor">
            <span class="eyebrow">01 · Bitácora continua</span>
            <h3>Actividades y reflexión</h3>
            <label class="field journal-field"><span>Descripción registrada por el estudiante${b.enviada_en ? ` · Entregada el ${escapar(fechaHora(b.enviada_en))}` : ""}</span><textarea readonly>${escapar(b.contenido.reflexion || "")}</textarea></label>
            <div class="evidence-heading"><div><strong>Evidencias adjuntas</strong><small>${pluralizar(b.evidencias.length, "archivo enviado", "archivos enviados")} junto con la bitácora definitiva.</small></div>${badge(pluralizar(b.evidencias.length, "archivo", "archivos"), b.evidencias.length ? "info" : "neutral")}</div>
            <div class="evidence-gallery submitted-evidence-gallery">${b.evidencias.length ? b.evidencias.map((e) => tarjetaEvidencia(e, b.id)).join("") : `<div class="evidence-empty"><div><strong>El estudiante no adjuntó evidencias</strong></div></div>`}</div>
          </article>
          <article class="panel student-questionnaire submitted-questionnaire">
            <header class="panel-heading student-questionnaire-heading"><div><span class="eyebrow">02 · Preguntas de nivel</span><h3>${escapar(b.cuestionario?.titulo || `Respuestas de ${a.nivel.nombre}`)}</h3><p>Cuestionario diligenciado por el estudiante al enviar la bitácora.</p></div>${preguntas.length ? badge(`${respondidas} de ${preguntas.length} respondidas`, respondidas === preguntas.length ? "success" : "warning") : badge("Sin cuestionario", "neutral")}</header>
            <div class="student-question-list">${preguntas.length ? preguntas.map((p, i) => tarjetaPregunta(p, i, respuestas.get(p.id))).join("") : `<div class="empty-state">Esta bitácora no tiene preguntas de nivel.</div>`}</div>
          </article>
        </div>
        <aside class="panel sticky site-rubric">
          <header><span class="eyebrow">Tu evaluación</span><h3>${role === "asesor" ? "Valoración del sitio" : "Valoración académica"}</h3><p>Registra una única nota global según el desempeño ${role === "asesor" ? "observado en la institución" : "académico del estudiante"}. Es independiente de la del ${role === "asesor" ? "docente supervisor" : "asesor de sitio"}.</p></header>
          <label class="field single-site-grade"><span>${rotuloNota}</span><input type="number" id="evl-nota" min="0" max="5" step=".01" inputmode="decimal" value="${ev.nota != null ? nota2(ev.nota) : ""}" ${editable ? "" : "readonly"} required /><small data-evl-nota-ayuda>Ingresa una calificación entre 0.00 y 5.00.</small></label>
          <label class="field rubric-comment"><span>Retroalimentación para el estudiante</span><textarea id="evl-retro" maxlength="3000" ${editable ? "" : "readonly"} placeholder="${editable ? "Destaca fortalezas y escribe recomendaciones concretas..." : ""}">${escapar(ev.retroalimentacion || "")}</textarea></label>
          <p class="autosave-note">${icon("clock")} <span data-evl-guardado>${publicada ? `Publicada el ${escapar(fechaHora(ev.publicada_en))}. Para modificarla, Dirección debe reabrirla.` : editable ? "Tus cambios se guardan automáticamente como borrador." : ""}</span></p>
          <p class="form-error" role="alert" data-evl-error hidden></p>
          <div class="rubric-actions">
            ${editable ? `<button class="btn btn-secondary btn-block" type="button" data-evl-borrador>Guardar borrador</button><button class="btn btn-primary btn-block" type="button" data-evl-publicar>Guardar evaluación</button>` : ""}
            <button class="btn btn-ghost btn-block" type="button" data-export-logbook="${escapar(b.id)}">${icon("file")} Exportar a PDF</button>
          </div>
        </aside>
      </section>`;
    pagina.querySelectorAll("img[data-evl-img]").forEach((img) => {
      urlEvidencia(img.dataset.evlImg).then((url) => { img.src = url; }).catch(() => img.replaceWith(Object.assign(document.createElement("small"), { textContent: "Sin vista previa" })));
    });
  }

  // ───────────── Evidencias ─────────────
  async function urlEvidencia(id) {
    const guardada = estado.urls.get(id);
    if (guardada && guardada.vence > Date.now() + 30_000) return guardada.url;
    const { data } = await api.get(`/logbooks/${estado.datos.bitacora.id}/evidences/${id}/download-url`);
    estado.urls.set(id, { url: data.url, vence: Date.now() + (data.expira_en_segundos || 60) * 1000 });
    return data.url;
  }

  async function verEvidencia(id) {
    const ventana = window.open("", "_blank");
    try {
      const url = await urlEvidencia(id);
      if (ventana) ventana.location.href = url; else window.location.assign(url);
    } catch (error) {
      ventana?.close();
      showToast(mensajeDeError(error));
    }
  }

  // ───────────── Formulario de nota ─────────────
  const campoNota = () => pagina.querySelector("#evl-nota");
  const campoRetro = () => pagina.querySelector("#evl-retro");
  const avisoError = () => pagina.querySelector("[data-evl-error]");

  /** Nota como número (o null si está vacía). Devuelve { valor, error }. */
  function leerNota() {
    const texto = campoNota().value.trim().replace(",", ".");
    if (texto === "") return { valor: null, error: null };
    const valor = Number(texto);
    if (!Number.isFinite(valor) || valor < 0 || valor > 5) return { valor: null, error: "La nota debe estar entre 0.00 y 5.00." };
    if (Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-9) return { valor: null, error: "La nota admite máximo dos decimales." };
    return { valor, error: null };
  }

    /** Muestra el estado del autoguardado. */
  function marcar(texto, error = false) {
    const nota = pagina.querySelector("[data-evl-guardado]");
    if (nota) nota.textContent = texto;
    nota?.closest(".autosave-note")?.classList.toggle("is-error", error);
  }

    /** Actualiza la insignia de estado de la evaluación. */
  function marcarEstado(estadoNuevo) {
    estado.ev = { ...estado.ev, estado: estadoNuevo };
    const [texto, tono] = etiquetaEstado();
    const insignia = pagina.querySelector("[data-evl-estado]");
    insignia.className = `badge badge-${tono}`;
    insignia.textContent = texto;
  }

    /** Valida la nota al escribir y agenda el autoguardado del borrador. */
  function programarBorrador() {
    const { error } = leerNota();
    pagina.querySelector("[data-evl-nota-ayuda]").textContent = error || "Ingresa una calificación entre 0.00 y 5.00.";
    pagina.querySelector("[data-evl-nota-ayuda]").style.color = error ? "var(--danger, #c0392b)" : "";
    estado.sucio = true;
    clearTimeout(estado.temporizador);
    marcar("Cambios sin guardar…");
    if (!error) estado.temporizador = setTimeout(guardarBorrador, ESPERA_BORRADOR);
  }

  /** Un solo guardado a la vez; si se sigue escribiendo, se vuelve a guardar al terminar. */
  function guardarBorrador() {
    clearTimeout(estado.temporizador);
    if (ciclo) return ciclo;
    ciclo = (async () => {
      try {
        while (estado.sucio && estado.ev.editable) {
          const { valor, error } = leerNota();
          if (error) break;
          estado.sucio = false;
          marcar("Guardando…");
          try {
            const { data } = await api.put(`/evaluations/${estado.ev.id}/draft`, { nota: valor, retroalimentacion: campoRetro().value.trim() || null });
            estado.errorGuardado = false;
            marcarEstado(data.evaluacion.estado);
            marcar(`Borrador guardado a las ${new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" }).format(new Date())}.`);
            avisoError().hidden = true;
          } catch (fallo) {
            estado.sucio = true; estado.errorGuardado = true;
            marcar("No se pudo guardar el borrador. Revisa tu conexión.", true);
            avisoError().textContent = mensajeDeError(fallo);
            avisoError().hidden = false;
            break;
          }
        }
      } finally {
        ciclo = null;
      }
    })();
    return ciclo;
  }

    /** Valida la nota y pide confirmación antes de publicar (la publicación solo la puede reabrir el Director). */
  function confirmarPublicacion() {
    const { valor, error } = leerNota();
    avisoError().hidden = true;
    if (error || valor === null) {
      avisoError().textContent = error || "Ingresa la nota (entre 0.00 y 5.00) para publicar la evaluación.";
      avisoError().hidden = false;
      campoNota().focus();
      return;
    }
    const modal = openModal("Publicar evaluación", `<form data-evl-form-publicar><p>Vas a publicar tu nota de <strong>${nota2(valor)}</strong> para ${escapar(estado.datos.asignacion.estudiante.nombre_completo)}.</p><div class="notice">Una vez publicada, el estudiante la verá y no podrás modificarla: solo la Dirección del programa puede reabrirla.</div><p class="form-error" role="alert" data-evl-error-modal hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Volver y revisar</button><button class="btn btn-primary" type="submit">Publicar evaluación</button></div></form>`);
    modal.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const boton = modal.querySelector("[type=submit]");
      const errorModal = modal.querySelector("[data-evl-error-modal]");
      errorModal.hidden = true; boton.disabled = true; boton.textContent = "Publicando…";
      try {
        await guardarBorrador(); // deja el ciclo de autoguardado en reposo antes de publicar
        await api.post(`/evaluations/${estado.ev.id}/publish`, { nota: valor, retroalimentacion: campoRetro().value.trim() || null });
        modal.remove();
        showToast("Evaluación guardada y publicada correctamente");
        await cargar();
      } catch (fallo) {
        errorModal.textContent = mensajeDeError(fallo); errorModal.hidden = false;
        boton.disabled = false; boton.textContent = "Publicar evaluación";
      }
    });
  }

  // ───────────── Eventos ─────────────
    // Entradas de nota y retroalimentación: agendan el autoguardado.
  pagina.addEventListener("input", (e) => {
    if (estado.ev?.editable && e.target.closest("#evl-nota, #evl-retro")) programarBorrador();
  });
  pagina.addEventListener("change", (e) => {
    if (e.target.id === "evl-cambiar") window.location.assign(`${pathFor(role, "evaluacion")}?asignacion=${e.target.value}`);
  });
  pagina.addEventListener("click", (e) => {
    if (e.target.closest("[data-evl-retry]")) { cargar(); return; }
    const ver = e.target.closest("[data-evl-ver]");
    if (ver) { verEvidencia(ver.dataset.evlVer); return; }
    if (e.target.closest("[data-evl-borrador]")) {
      const { error } = leerNota();
      if (error) { avisoError().textContent = error; avisoError().hidden = false; return; }
      estado.sucio = true;
      guardarBorrador().then(() => { if (!estado.sucio) showToast("Borrador de evaluación guardado"); });
      return;
    }
    if (e.target.closest("[data-evl-publicar]")) confirmarPublicacion();
  });
    // Advierte si hay cambios sin guardar al salir.
  window.addEventListener("beforeunload", (e) => {
    if (estado.sucio || ciclo) { e.preventDefault(); e.returnValue = ""; }
  });

  cargar();
}

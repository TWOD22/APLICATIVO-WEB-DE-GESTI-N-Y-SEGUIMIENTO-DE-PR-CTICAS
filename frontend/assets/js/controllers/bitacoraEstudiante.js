/**
 * Pantalla "Bitácora" del Estudiante conectada al API real:
 * autoguardado del borrador, evidencias (JPG/PNG/PDF), cuestionario del nivel y envío definitivo.
 */
import { api } from "../services/api.js";

// Tipos de archivo permitidos como evidencia según su extensión.
const MIME_POR_EXTENSION = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf" };
// Tamaño máximo por evidencia (10 MB) y cantidad máxima por bitácora.
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EVIDENCIAS = 20;
// Tiempos de espera (ms): autoguardado del borrador y de la descripción de una evidencia tras dejar de escribir.
const ESPERA_GUARDADO = 1500;
const ESPERA_DESCRIPCION = 800;

// Utilidades de formato: contar palabras, tamaño legible, hora, fecha y plural.
const palabras = (texto) => (String(texto ?? "").match(/\S+/g) ?? []).length;
const tamano = (bytes) => (bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
const hora = () => new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" }).format(new Date());
const fechaHora = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
};
const pluralizar = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
// Textos de los tipos de pregunta.
const TIPO_PREGUNTA = { ABIERTA: "Respuesta abierta", CERRADA_UNICA: "Selección única", CERRADA_MULTIPLE: "Selección múltiple" };
// Estado de la bitácora: [texto, color de la insignia].
const ESTADOS = {
  BLOQUEADA: ["Bloqueada", "neutral"],
  BORRADOR: ["Borrador", "warning"],
  DEVUELTA: ["Devuelta para corregir", "danger"],
  ENVIADA: ["Enviada", "success"],
  EN_EVALUACION: ["En evaluación", "info"],
  EVALUADA: ["Evaluada", "success"],
};

/**
 * Conecta la pantalla de la bitácora del estudiante con la API.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarBitacoraEstudiante(ui) {
  const { badge, escapar, icon, openModal, pathFor, showToast } = ui;
  const pagina = document.querySelector(".page");
    // Estado local: bitácora, evidencias, revisión del borrador (para detectar conflictos), banderas de guardado y llave de idempotencia del envío.
  const estado = {
    bit: null, evidencias: [], revision: 0,
    sucio: false, errorGuardado: false, conflicto: false, temporizador: null,
    subiendo: 0, llaveEnvio: null, urls: new Map(), temporizadoresDescripcion: new Map(),
  };
    // Guarda la operación de autoguardado en curso (solo se permite una a la vez).
  let ciclo = null;

    // Une el mensaje del error con los detalles de validación del servidor.
  const mensajeDeError = (error) => {
    const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => d.mensaje) : [];
    return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
  };
  const errorHtml = (mensaje) => `<div style="padding:32px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" data-bt-retry>Reintentar</button></div>`;

  // ───────────── Carga ─────────────
    /** Busca la práctica del estudiante y trae su bitácora (la crea la primera vez). */
  async function cargar() {
    clearTimeout(estado.temporizador);
    estado.sucio = false; estado.errorGuardado = false; estado.conflicto = false;
    pagina.innerHTML = `<p class="muted" style="padding:32px;text-align:center">Cargando tu bitácora…</p>`;
    try {
      const { data: resumen } = await api.get("/dashboard");
      const practica = resumen.practica;
      if (!practica) {
        pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Bitácora</span><h2>Bitácora de práctica</h2><p>Aún no tienes una práctica asignada en el periodo activo. Comunícate con la Dirección del Programa.</p></div></header>`;
        return;
      }
      const { data } = await api.get(`/practice-assignments/${practica.id}/logbook`);
      estado.bit = data;
      estado.evidencias = data.evidencias.map((e) => ({ ...e }));
      estado.revision = data.contenido.revision ?? 0;
      pintar();
    } catch (error) {
      pagina.innerHTML = error?.code === "LOGBOOK_NOT_FOUND"
        ? `<header class="page-title"><div><span class="eyebrow">Bitácora</span><h2>Bitácora de práctica</h2><p>${escapar(error.message)}</p></div></header>`
        : errorHtml(mensajeDeError(error));
    }
  }

  // ───────────── Pintado ─────────────
    /** Encabezado de la página con el estado de la bitácora. */
  function encabezado(extra = "") {
    const a = estado.bit.asignacion;
    const [texto, tono] = ESTADOS[estado.bit.estado] || [estado.bit.estado, "info"];
    return `<header class="page-title"><div><span class="eyebrow">${escapar(a.nivel.nombre)} · ${escapar(a.periodo.codigo)}</span><h2>Bitácora de práctica</h2><p>${escapar(a.institucion.nombre)} · Documenta tus actividades, aprendizajes y evidencias.</p></div>${extra || badge(texto, tono)}</header>`;
  }

    /** Elige la vista: bloqueada (faltan documentos), editable o solo lectura. */
  function pintar() {
    const b = estado.bit;
    if (b.estado === "BLOQUEADA" || (!b.editable && ["BORRADOR", "DEVUELTA"].includes(b.estado))) pintarBloqueada();
    else if (b.editable) pintarEditable();
    else pintarSoloLectura();
  }

    /** Aviso de que la bitácora se habilita cuando Dirección aprueba los documentos legales. */
  function pintarBloqueada() {
    pagina.innerHTML = `${encabezado()}<article class="panel content-block"><span class="eyebrow">Bitácora no habilitada</span><h3>Primero completa tu expediente documental</h3><p>Tu bitácora se habilita cuando la Dirección apruebe todos tus documentos legales obligatorios.</p><br><a class="btn btn-primary" href="${pathFor("estudiante", "documentos")}">Ir a Documentos legales</a></article>`;
  }

    /** Una pregunta del cuestionario (texto libre u opciones únicas/múltiples). */
  function tarjetaPregunta(p, i, respuesta, soloLectura) {
    const numero = String(i + 1).padStart(2, "0");
    const rotulo = `${TIPO_PREGUNTA[p.tipo] || p.tipo}${p.obligatoria ? " · Obligatoria" : " · Opcional"}`;
    const legend = `<legend><span class="student-question-number">${numero}</span><span><small>${rotulo}</small>${escapar(p.enunciado)}</span></legend>`;
    const marcadas = new Set(respuesta?.opciones_ids ?? []);
    let cuerpo;
    if (p.tipo === "ABIERTA") {
      cuerpo = `<label class="field"><span class="sr-only">Respuesta a la pregunta ${i + 1}</span><textarea rows="4" maxlength="5000" ${soloLectura ? "readonly" : ""} data-bt-respuesta placeholder="${soloLectura ? "" : "Escribe una respuesta reflexiva y relaciona tu experiencia con la práctica..."}">${escapar(respuesta?.texto || "")}</textarea></label>`;
    } else {
      const tipoInput = p.tipo === "CERRADA_UNICA" ? "radio" : "checkbox";
      cuerpo = `<div class="student-answer-options ${soloLectura ? "readonly-options" : ""}">${p.opciones.map((o) => `<label><input type="${tipoInput}" name="bt-p-${escapar(p.id)}" value="${escapar(o.id)}" ${marcadas.has(o.id) ? "checked" : ""} ${soloLectura ? "disabled" : ""} /><span>${escapar(o.etiqueta)}</span></label>`).join("")}</div>`;
    }
    return `<fieldset class="student-question" data-bt-pregunta="${escapar(p.id)}" data-tipo="${escapar(p.tipo)}" data-obligatoria="${p.obligatoria}">${legend}${cuerpo}</fieldset>`;
  }

    /** Panel con todas las preguntas del cuestionario del nivel. */
  function bloquePreguntas(soloLectura) {
    const b = estado.bit;
    const preguntas = b.cuestionario?.preguntas ?? [];
    const porId = new Map(b.contenido.respuestas.map((r) => [r.pregunta_id, r]));
    const titulo = escapar(b.cuestionario?.titulo || `Reflexión de ${b.asignacion.nivel.nombre}`);
    const cuerpo = preguntas.length
      ? `<div class="student-question-list">${preguntas.map((p, i) => tarjetaPregunta(p, i, porId.get(p.id), soloLectura)).join("")}</div>`
      : `<div class="empty-state">${b.cuestionario ? "El cuestionario de tu nivel no tiene preguntas." : "La Dirección aún no ha habilitado un cuestionario para tu nivel. Por ahora no tienes preguntas por responder."}</div>`;
    return `<article class="panel student-questionnaire"><header class="panel-heading student-questionnaire-heading"><div><span class="eyebrow">02 · Preguntas de nivel</span><h3>${titulo}</h3><p>${soloLectura ? "Respuestas registradas en tu entrega." : "Responde las preguntas definidas por la Dirección del programa."}</p></div>${preguntas.length ? badge(`${preguntas.length} ${preguntas.length === 1 ? "pregunta" : "preguntas"}`, "info") : ""}</header>${soloLectura ? "" : `<div class="questionnaire-notice">${icon("clipboard")}<p><strong>Antes de enviar</strong><span>Debes responder las preguntas marcadas como obligatorias. Tus respuestas se guardan automáticamente.</span></p></div>`}${cuerpo}</article>`;
  }

    /** Tarjeta de una evidencia con vista previa y descripción. */
  function tarjetaEvidencia(e, soloLectura) {
    const vista = e.es_imagen
      ? `<img data-bt-img="${escapar(e.id)}" alt="Vista previa de ${escapar(e.nombre)}" />`
      : `<span>${icon("file")}<small>PDF</small></span>`;
    const descripcion = soloLectura
      ? `<small>${escapar(e.descripcion || "Sin descripción")}</small>`
      : `<label><span class="sr-only">Descripción de ${escapar(e.nombre)}</span><input type="text" maxlength="500" placeholder="Escribe una breve descripción de la evidencia..." data-bt-descripcion="${escapar(e.id)}" value="${escapar(e.descripcion || "")}" /></label>`;
    return `<article class="evidence-card" data-bt-evidencia="${escapar(e.id)}"><button class="evidence-preview" type="button" data-bt-ver="${escapar(e.id)}" title="Abrir en una pestaña nueva" style="border:0;cursor:pointer">${vista}</button><div class="evidence-details"><div class="evidence-file-row"><div><strong title="${escapar(e.nombre)}">${escapar(e.nombre)}</strong><small>${e.es_imagen ? "Imagen" : "PDF"} · ${tamano(e.tamano_bytes)}</small></div>${soloLectura ? "" : `<button class="evidence-remove" type="button" data-bt-quitar="${escapar(e.id)}" aria-label="Eliminar ${escapar(e.nombre)}">${icon("trash")}</button>`}</div>${descripcion}</div></article>`;
  }

    /** Contenido de la galería de evidencias. */
  function contenidoGaleria(soloLectura) {
    const tarjetas = estado.evidencias.map((e) => tarjetaEvidencia(e, soloLectura)).join("");
    const subiendo = estado.subiendo ? `<div class="evidence-empty"><span class="doc-icon blue">${icon("upload")}</span><div><strong>Subiendo ${pluralizar(estado.subiendo, "archivo", "archivos")}…</strong><small>No cierres esta página hasta que termine.</small></div></div>` : "";
    if (!tarjetas && !subiendo) {
      return `<div class="evidence-empty"><span class="doc-icon blue">${icon("upload")}</span><div><strong>${soloLectura ? "No adjuntaste evidencias" : "Aún no has adjuntado evidencias"}</strong><small>${soloLectura ? "" : "Las fotos y PDFs aparecerán aquí para que puedas revisarlos."}</small></div></div>`;
    }
    return tarjetas + subiendo;
  }

    /** Redibuja la galería y el resumen de requisitos. */
  function pintarGaleria() {
    const galeria = pagina.querySelector("[data-bt-galeria]");
    if (!galeria) return;
    galeria.innerHTML = contenidoGaleria(!estado.bit.editable);
    cargarMiniaturas();
    actualizarResumen();
  }

    /** Vista editable: reflexión, evidencias, preguntas y resumen de entrega con el botón de envío. */
  function pintarEditable() {
    const b = estado.bit;
    const devuelta = b.estado === "DEVUELTA";
    pagina.innerHTML = `${encabezado(`<span class="badge badge-success journal-save-status" data-bt-estado-guardado>${b.contenido.guardado_en ? "Borrador guardado" : "Borrador nuevo"}</span>`)}
      ${devuelta ? `<div class="notice" style="border-color:var(--danger,#d93d4a)"><strong>La Dirección devolvió tu bitácora para corregirla.</strong><br>${escapar(b.motivo_devolucion || "Revisa el contenido y vuelve a enviarla.")}</div>` : ""}
      <div class="notice" data-bt-conflicto style="display:none"></div>
      <section class="two-column journal-layout">
        <div class="journal-main">
          <article class="panel content-block journal-editor">
            <span class="eyebrow">01 · Bitácora continua</span>
            <h3>Actividades y reflexión</h3>
            <label class="field journal-field">
              <span>Describe las actividades realizadas</span>
              <textarea id="bt-reflexion" maxlength="20000" placeholder="Describe las actividades realizadas, la metodología aplicada, los aprendizajes logrados y los retos encontrados durante la semana...">${escapar(b.contenido.reflexion || "")}</textarea>
              <small class="writing-counter" aria-live="polite"><strong data-bt-palabras>0 palabras</strong><span>Mínimo ${b.requisitos.minimo_palabras} palabras. Una reflexión detallada facilita tu evaluación.</span></small>
            </label>
            <div class="evidence-heading"><div><strong>Evidencias de la práctica</strong><small>Fotografías (JPG o PNG) o documentos PDF. Máximo 10 MB por archivo y ${MAX_EVIDENCIAS} evidencias.</small></div><button class="btn btn-secondary" type="button" data-bt-adjuntar>${icon("paperclip")} Adjuntar evidencias</button></div>
            <div class="evidence-gallery" data-bt-galeria aria-live="polite">${contenidoGaleria(false)}</div>
          </article>
          ${bloquePreguntas(false)}
        </div>
        <aside class="panel grade-card sticky journal-summary">
          <span class="eyebrow">Estado del borrador</span>
          <h3>Resumen de entrega</h3>
          <span class="badge badge-warning" data-bt-badge>Borrador en progreso</span>
          <div class="quality-checklist">
            <div class="quality-item" data-bt-q-texto><span>${icon("check")}</span><div><strong>Descripción y reflexión</strong><small></small></div></div>
            <div class="quality-item" data-bt-q-evidencias><span>${icon("paperclip")}</span><div><strong>Evidencias adjuntas</strong><small></small></div></div>
            <div class="quality-item" data-bt-q-preguntas><span>${icon("clipboard")}</span><div><strong>Preguntas de nivel</strong><small></small></div></div>
          </div>
          <p class="autosave-note">${icon("clock")} <span data-bt-autoguardado>Tus cambios se guardan automáticamente.</span></p>
          <div class="summary-actions">
            <button class="btn btn-secondary btn-block" type="button" data-bt-guardar>Guardar borrador</button>
            <button class="btn btn-primary btn-block" type="button" data-bt-enviar disabled>Enviar bitácora definitiva</button>
          </div>
        </aside>
      </section>`;
    cargarMiniaturas();
    actualizarResumen();
  }

    /** Vista de solo lectura (bitácora ya enviada o evaluada). */
  function pintarSoloLectura() {
    const b = estado.bit;
    const detalle = b.enviada_en ? `Entregada el ${fechaHora(b.enviada_en)}` : "";
    pagina.innerHTML = `${encabezado()}
      <section class="two-column journal-layout">
        <div class="journal-main">
          <article class="panel content-block journal-editor">
            <span class="eyebrow">01 · Bitácora continua</span>
            <h3>Actividades y reflexión</h3>
            <label class="field journal-field"><span>Descripción registrada</span><textarea readonly>${escapar(b.contenido.reflexion || "")}</textarea></label>
            <div class="evidence-heading"><div><strong>Evidencias adjuntas</strong><small>Archivos que enviaste con tu entrega.</small></div>${badge(pluralizar(estado.evidencias.length, "archivo", "archivos"), "info")}</div>
            <div class="evidence-gallery" data-bt-galeria>${contenidoGaleria(true)}</div>
          </article>
          ${bloquePreguntas(true)}
        </div>
        <aside class="panel grade-card sticky journal-summary">
          <span class="eyebrow">Estado de la entrega</span>
          <h3>${b.estado === "EVALUADA" ? "Bitácora evaluada" : "Bitácora entregada"}</h3>
          ${badge(ESTADOS[b.estado]?.[0] || b.estado, ESTADOS[b.estado]?.[1] || "info")}
          <p class="muted">${escapar(detalle)}</p>
          <p class="muted">${b.estado === "EVALUADA" ? "Tus evaluaciones ya están publicadas. Consúltalas en «Mi práctica»." : "Tu docente supervisor y tu asesor de sitio la evaluarán de forma independiente. Ya no puedes modificarla."}</p>
          <div class="summary-actions">
            <a class="btn btn-secondary btn-block" href="${pathFor("estudiante", "dashboard")}">Ir a Mi práctica</a>
            <button class="btn btn-ghost btn-block" type="button" data-export-logbook="${escapar(b.id)}">Descargar bitácora (PDF)</button>
          </div>
        </aside>
      </section>`;
    cargarMiniaturas();
  }

  // ───────────── Requisitos y resumen ─────────────
    /** Lee del formulario las respuestas dadas (texto u opciones marcadas). */
  function leerRespuestas() {
    const lista = [];
    pagina.querySelectorAll("[data-bt-pregunta]").forEach((campo) => {
      const preguntaId = campo.dataset.btPregunta;
      if (campo.dataset.tipo === "ABIERTA") {
        const texto = campo.querySelector("textarea").value.trim();
        if (texto) lista.push({ pregunta_id: preguntaId, texto });
      } else {
        const ids = [...campo.querySelectorAll("input:checked")].map((i) => i.value);
        if (ids.length) lista.push({ pregunta_id: preguntaId, opciones_ids: ids });
      }
    });
    return lista;
  }

    /** Calcula en vivo qué falta para enviar: palabras mínimas, evidencias y preguntas obligatorias. */
  function requisitos() {
    const reflexion = pagina.querySelector("#bt-reflexion")?.value ?? "";
    const respondidas = new Set(leerRespuestas().map((r) => r.pregunta_id));
    const obligatorias = (estado.bit.cuestionario?.preguntas ?? []).filter((p) => p.obligatoria);
    const minimo = estado.bit.requisitos.minimo_palabras;
    const total = palabras(reflexion);
    const pendientes = obligatorias.filter((p) => !respondidas.has(p.id)).length;
    return {
      palabras: total, minimo, cumpleReflexion: total >= minimo,
      evidencias: estado.evidencias.length, cumpleEvidencias: estado.evidencias.length >= 1,
      obligatorias: obligatorias.length, pendientes,
      listo: total >= minimo && estado.evidencias.length >= 1 && pendientes === 0,
    };
  }

    /** Actualiza la lista de requisitos y habilita el botón de envío solo cuando todo se cumple. */
  function actualizarResumen() {
    if (!estado.bit?.editable) return;
    const r = requisitos();
    const set = (selector, completo, texto) => {
      const item = pagina.querySelector(selector);
      if (!item) return;
      item.classList.toggle("is-complete", completo);
      item.querySelector("small").textContent = texto;
    };
    const contador = pagina.querySelector("[data-bt-palabras]");
    if (contador) contador.textContent = pluralizar(r.palabras, "palabra", "palabras");
    set("[data-bt-q-texto]", r.cumpleReflexion, r.cumpleReflexion ? `${pluralizar(r.palabras, "palabra", "palabras")} · Registrada` : `${r.palabras} de ${r.minimo} palabras`);
    set("[data-bt-q-evidencias]", r.cumpleEvidencias, `${pluralizar(r.evidencias, "archivo cargado", "archivos cargados")}${r.cumpleEvidencias ? "" : " · Adjunta al menos 1"}`);
    set("[data-bt-q-preguntas]", r.pendientes === 0, r.obligatorias === 0 ? "Sin preguntas obligatorias" : r.pendientes === 0 ? "Obligatorias respondidas" : `${r.obligatorias - r.pendientes} de ${r.obligatorias} obligatorias respondidas`);
    const insignia = pagina.querySelector("[data-bt-badge]");
    insignia.className = `badge ${r.listo ? "badge-success" : "badge-warning"}`;
    insignia.textContent = r.listo ? "Listo para enviar" : "Borrador en progreso";
    pagina.querySelector("[data-bt-enviar]").disabled = !r.listo || estado.conflicto || estado.subiendo > 0;
    const adjuntar = pagina.querySelector("[data-bt-adjuntar]");
    if (adjuntar) adjuntar.disabled = estado.subiendo > 0 || estado.conflicto;
  }

  // ───────────── Autoguardado ─────────────
    /** Muestra el estado del autoguardado (guardando, guardado, sin guardar). */
  function marcarGuardado(texto, clase = "badge-success") {
    const insignia = pagina.querySelector("[data-bt-estado-guardado]");
    if (insignia) { insignia.className = `badge ${clase} journal-save-status`; insignia.textContent = texto; }
    const nota = pagina.querySelector("[data-bt-autoguardado]");
    if (nota) nota.textContent = texto === "Guardando…" ? "Guardando cambios…" : texto === "Borrador guardado" ? `Borrador guardado automáticamente a las ${hora()}.` : texto === "Sin guardar" ? "No se pudo guardar. Revisa tu conexión y vuelve a intentarlo." : "Tus cambios se guardan automáticamente.";
  }

    /** Avisa que la bitácora cambió en otra pestaña o ya no es editable, y ofrece recargarla. */
  function mostrarConflicto(mensaje) {
    estado.conflicto = true;
    const aviso = pagina.querySelector("[data-bt-conflicto]");
    if (aviso) {
      aviso.innerHTML = `<strong>${escapar(mensaje)}</strong> <button class="btn btn-secondary" type="button" data-bt-recargar>Recargar bitácora</button>`;
      aviso.style.display = "block";
    }
    marcarGuardado("Sin guardar", "badge-danger");
    actualizarResumen();
  }

    /** Agenda el autoguardado unos segundos después del último cambio. */
  function programarGuardado() {
    estado.sucio = true;
    clearTimeout(estado.temporizador);
    marcarGuardado("Cambios sin guardar", "badge-warning");
    estado.temporizador = setTimeout(guardar, ESPERA_GUARDADO);
  }

  /** Un solo ciclo de guardado a la vez: si el usuario sigue escribiendo, se vuelve a guardar al terminar. */
  function guardar() {
    clearTimeout(estado.temporizador);
    if (ciclo) return ciclo;
    ciclo = (async () => {
      try {
        while (estado.sucio && !estado.conflicto && estado.bit?.editable) {
          estado.sucio = false;
          marcarGuardado("Guardando…", "badge-info");
          const cuerpo = { revision_base: estado.revision, reflexion: pagina.querySelector("#bt-reflexion").value, respuestas: leerRespuestas() };
          try {
            const { data } = await api.put(`/logbooks/${estado.bit.id}/draft`, cuerpo);
            estado.revision = data.revision;
            estado.errorGuardado = false;
            marcarGuardado("Borrador guardado");
          } catch (error) {
            if (["DRAFT_CONFLICT", "DRAFT_LOCKED", "LOGBOOK_ALREADY_SUBMITTED", "LOGBOOK_LOCKED"].includes(error.code)) {
              mostrarConflicto(error.message);
            } else {
              estado.sucio = true; estado.errorGuardado = true;
              marcarGuardado("Sin guardar", "badge-danger");
              showToast(mensajeDeError(error));
              break;
            }
          }
        }
      } finally {
        ciclo = null;
      }
    })();
    return ciclo;
  }

  // ───────────── Evidencias ─────────────
    /** Deduce el tipo MIME del archivo por su extensión (null si no se permite). */
  const mimeDe = (archivo) => {
    const ext = archivo.name.split(".").pop().toLowerCase();
    const porExt = MIME_POR_EXTENSION[ext];
    if (!porExt) return null;
    return !archivo.type || archivo.type === porExt || (porExt === "image/jpeg" && archivo.type === "image/jpg") ? porExt : null;
  };

    /** Valida y sube cada archivo como evidencia (cuerpo binario con el nombre en X-File-Name). */
  async function subirArchivos(archivos) {
    if (!estado.bit?.editable || estado.conflicto) return;
    for (const archivo of archivos) {
      if (estado.evidencias.length + estado.subiendo >= MAX_EVIDENCIAS) { showToast(`Máximo ${MAX_EVIDENCIAS} evidencias por bitácora`); break; }
      const mime = mimeDe(archivo);
      if (!mime) { showToast(`«${archivo.name}»: solo se permiten imágenes JPG o PNG y archivos PDF`); continue; }
      if (archivo.size === 0) { showToast(`«${archivo.name}» está vacío`); continue; }
      if (archivo.size > MAX_BYTES) { showToast(`«${archivo.name}» supera los 10 MB`); continue; }
      estado.subiendo += 1;
      pintarGaleria();
      try {
        const { data } = await api.post(`/logbooks/${estado.bit.id}/evidences`, new Blob([archivo], { type: mime }), {
          headers: { "Content-Type": mime, "X-File-Name": encodeURIComponent(archivo.name) },
        });
        estado.evidencias.push(data);
        showToast("Evidencia cargada correctamente");
      } catch (error) {
        showToast(mensajeDeError(error));
      } finally {
        estado.subiendo -= 1;
        pintarGaleria();
      }
    }
  }

    /** Guarda la descripción de una evidencia tras una pausa al escribir. */
  function guardarDescripcion(id) {
    const evidencia = estado.evidencias.find((e) => e.id === id);
    if (!evidencia) return;
    clearTimeout(estado.temporizadoresDescripcion.get(id));
    estado.temporizadoresDescripcion.set(id, setTimeout(async () => {
      estado.temporizadoresDescripcion.delete(id);
      try {
        await api.patch(`/logbooks/${estado.bit.id}/evidences/${id}`, { descripcion: evidencia.descripcion || "" });
      } catch (error) {
        showToast(mensajeDeError(error));
      }
    }, ESPERA_DESCRIPCION));
  }

    /** Pide confirmación antes de quitar una evidencia. */
  function confirmarQuitar(id) {
    const evidencia = estado.evidencias.find((e) => e.id === id);
    if (!evidencia) return;
    const modal = openModal("Eliminar evidencia", `<div><p>¿Quieres eliminar «${escapar(evidencia.nombre)}» de tu bitácora?</p><p class="form-error" role="alert" data-bt-error hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-danger" type="button" data-bt-confirmar-quitar>Eliminar</button></div></div>`);
    modal.querySelector("[data-bt-confirmar-quitar]").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api.delete(`/logbooks/${estado.bit.id}/evidences/${id}`);
        estado.evidencias = estado.evidencias.filter((x) => x.id !== id);
        estado.urls.delete(id);
        modal.remove();
        pintarGaleria();
        showToast("Evidencia eliminada");
      } catch (error) {
        const aviso = modal.querySelector("[data-bt-error]");
        aviso.textContent = mensajeDeError(error); aviso.hidden = false;
        e.currentTarget.disabled = false;
      }
    });
  }

    /** URL firmada temporal de la evidencia; se reutiliza mientras no esté por vencer. */
  async function urlDeEvidencia(id) {
    const guardada = estado.urls.get(id);
    if (guardada && guardada.vence > Date.now() + 30_000) return guardada.url;
    const { data } = await api.get(`/logbooks/${estado.bit.id}/evidences/${id}/download-url`);
    estado.urls.set(id, { url: data.url, vence: Date.now() + (data.expira_en_segundos || 60) * 1000 });
    return data.url;
  }

    /** Carga las miniaturas de las imágenes. */
  function cargarMiniaturas() {
    pagina.querySelectorAll("img[data-bt-img]").forEach((img) => {
      urlDeEvidencia(img.dataset.btImg).then((url) => { img.src = url; }).catch(() => { img.replaceWith(Object.assign(document.createElement("small"), { textContent: "Sin vista previa" })); });
    });
  }

    /** Abre la evidencia en una pestaña nueva. */
  async function verEvidencia(id) {
    const ventana = window.open("", "_blank");
    try {
      const url = await urlDeEvidencia(id);
      if (ventana) ventana.location.href = url; else window.location.assign(url);
    } catch (error) {
      ventana?.close();
      showToast(mensajeDeError(error));
    }
  }

  // ───────────── Envío definitivo ─────────────
    /** Ventana de confirmación del envío definitivo: guarda el borrador y envía con una llave de idempotencia para no duplicar el envío si se repite. */
  async function abrirEnvio() {
    const modal = openModal("Confirmar envío de bitácora", `<form data-bt-form-envio><p class="muted">Tu bitácora quedará enviada para evaluación. Verifica que la reflexión y las evidencias estén completas antes de continuar.</p><div class="notice">Después del envío no podrás modificar el contenido.</div><p class="form-error" role="alert" data-bt-error hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Volver y revisar</button><button class="btn btn-primary" type="submit">Confirmar envío</button></div></form>`);
    modal.querySelector("[data-bt-form-envio]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const boton = modal.querySelector("[type=submit]");
      const aviso = modal.querySelector("[data-bt-error]");
      aviso.hidden = true;
      boton.disabled = true; boton.textContent = "Enviando…";
      try {
        await guardar();
        if (estado.sucio || estado.conflicto) throw new Error("No se pudo guardar tu borrador antes de enviar. Revisa tu conexión e inténtalo de nuevo.");
        estado.llaveEnvio ??= `envio-${crypto.randomUUID()}`;
        await api.post(`/logbooks/${estado.bit.id}/submit`, { revision_base: estado.revision }, { headers: { "Idempotency-Key": estado.llaveEnvio } });
        estado.llaveEnvio = null;
        modal.remove();
        showToast("Bitácora enviada para evaluación");
        await cargar();
      } catch (error) {
        // Un error de negocio descarta la llave; un fallo de red la conserva para reintentar sin duplicar el envío.
        if (error?.status && error.status < 500) estado.llaveEnvio = null;
        if (error?.code === "DRAFT_CONFLICT") { modal.remove(); mostrarConflicto(error.message); return; }
        aviso.textContent = mensajeDeError(error); aviso.hidden = false;
        boton.disabled = false; boton.textContent = "Confirmar envío";
      }
    });
  }

  // ───────────── Eventos ─────────────
    // Cambios en el formulario: marcan el borrador como sin guardar y actualizan el resumen.
  pagina.addEventListener("input", (e) => {
    if (!estado.bit?.editable) return;
    const descripcion = e.target.closest("[data-bt-descripcion]");
    if (descripcion) {
      const evidencia = estado.evidencias.find((x) => x.id === descripcion.dataset.btDescripcion);
      if (evidencia) { evidencia.descripcion = descripcion.value; guardarDescripcion(evidencia.id); }
      return;
    }
    if (e.target.closest("#bt-reflexion, [data-bt-pregunta]")) {
      actualizarResumen();
      if (!estado.conflicto) programarGuardado();
    }
  });

    // Clics (delegación): guardar, enviar, subir/ver/quitar evidencias y recargar.
  pagina.addEventListener("click", (e) => {
    if (e.target.closest("[data-bt-retry]")) { cargar(); return; }
    if (e.target.closest("[data-bt-recargar]")) { cargar(); return; }
    if (e.target.closest("[data-bt-adjuntar]")) {
      const entrada = document.createElement("input");
      entrada.type = "file";
      entrada.multiple = true;
      entrada.accept = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";
      entrada.addEventListener("change", () => subirArchivos([...entrada.files]));
      entrada.click();
      return;
    }
    const ver = e.target.closest("[data-bt-ver]");
    if (ver) { verEvidencia(ver.dataset.btVer); return; }
    const quitar = e.target.closest("[data-bt-quitar]");
    if (quitar) { confirmarQuitar(quitar.dataset.btQuitar); return; }
    if (e.target.closest("[data-bt-guardar]")) {
      if (!estado.sucio && !ciclo) { showToast("Tu borrador ya está al día"); return; }
      guardar().then(() => { if (!estado.sucio && !estado.conflicto) showToast("Borrador guardado correctamente"); });
      return;
    }
    if (e.target.closest("[data-bt-enviar]")) abrirEnvio();
  });

    // Arrastrar y soltar archivos sobre la galería de evidencias.
  pagina.addEventListener("dragover", (e) => { if (estado.bit?.editable && e.target.closest("[data-bt-galeria]")) e.preventDefault(); });
  pagina.addEventListener("drop", (e) => {
    if (!estado.bit?.editable || !e.target.closest("[data-bt-galeria]")) return;
    e.preventDefault();
    subirArchivos([...e.dataTransfer.files]);
  });

    // Advierte si el usuario intenta salir con cambios sin guardar.
  window.addEventListener("beforeunload", (e) => {
    if (estado.sucio || ciclo || estado.subiendo) { e.preventDefault(); e.returnValue = ""; }
  });

  cargar();
}

/**
 * "Mi práctica" del Estudiante, antes de que la práctica esté activa (flujo v2.1).
 * Guía a la persona según el estado de su solicitud. Los documentos y la plaza viajan juntos:
 *   sin solicitud → solicitar el nivel que propone el sistema
 *   BORRADOR / DEVUELTA → cargar (o corregir) documentos, elegir la plaza y enviar todo a Dirección
 *   ENVIADA → esperar: Dirección revisa documentos y plaza, y asigna (puede cambiar la plaza con un motivo)
 * Cuando la práctica ya está ACTIVA (o terminó) esta pantalla no interviene: `montarMiPractica` devuelve false y el
 * panel de siempre (notas, bitácora) se dibuja.
 */
import { api } from "../services/api.js";
import { montarGuiaCriterios } from "./guiaCriterios.js";

// Estados de la solicitud que atiende esta pantalla. Los dos últimos son de solicitudes anteriores al flujo v2.1.
const ESTADOS_PREVIOS = ["BORRADOR", "DEVUELTA", "ENVIADA", "DOCUMENTOS_APROBADOS", "PLAZA_SELECCIONADA"];

// Pasos de la línea de tiempo: título y ayuda de cada uno.
const PASOS = [
  { titulo: "Solicitud", ayuda: "Confirmas tu nivel" },
  { titulo: "Documentos y plaza", ayuda: "Cargas tu expediente y eliges institución" },
  { titulo: "Revisión", ayuda: "Dirección valida" },
  { titulo: "Asignación", ayuda: "Dirección confirma tu plaza y asesor" },
  { titulo: "En curso", ayuda: "Inicia tu práctica" },
];

// Paso (0 a 4) en el que está cada estado; ENVIADA con todo aprobado pasa al paso 3 (ver `pasoActual`).
const PASO_DE_ESTADO = { BORRADOR: 1, DEVUELTA: 1, ENVIADA: 2, DOCUMENTOS_APROBADOS: 2, PLAZA_SELECCIONADA: 2 };

// Aspecto de cada estado del documento.
const ESTADO_DOC = {
  APROBADO: { texto: "Aprobado", tono: "success" },
  EN_REVISION: { texto: "En revisión", tono: "info" },
  POR_CORREGIR: { texto: "Por corregir", tono: "danger" },
  SIN_CARGAR: { texto: "Sin cargar", tono: "neutral" },
};

/** Fecha larga en español (ej. 12 de octubre de 2026); vacía si el valor no es una fecha. */
const fechaLarga = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" }) : "";
};

/**
 * Dibuja "Mi práctica" si la persona está en la etapa de solicitud. Devuelve true si la pantalla quedó dibujada
 * (y es esta pantalla quien la maneja) o false si debe usarse el panel de siempre.
 * @param {object} ui Utilidades compartidas: badge, escapar, icon, openModal, pathFor, showToast.
 */
export async function montarMiPractica(ui) {
  const { badge, escapar, icon, openModal, pathFor, showToast } = ui;
  const pagina = document.querySelector(".page");
  if (new URLSearchParams(window.location.search).has("historial")) return false;

  const estado = { trayectoria: null, documentos: null, plazas: null, ocupado: false };
  /** Texto de error legible para mostrar al usuario. */
  const mensaje = (error) => error?.message || "Ocurrió un error inesperado. Inténtalo de nuevo.";
  /** HTML de un mensaje de error con botón para reintentar. */
  const errorHtml = (texto) => `<div class="practice-empty"><p class="form-error" role="alert">${escapar(texto)}</p><button class="btn btn-secondary" type="button" data-mp="reintentar">Reintentar</button></div>`;

  /** Pregunta antes de una acción. Devuelve una promesa con true (confirmó) o false (canceló). */
  function confirmar({ titulo, texto, boton, peligro = false }) {
    return new Promise((resolver) => {
      const ventana = openModal(
        escapar(titulo),
        `<div class="practice-confirm"><p>${escapar(texto)}</p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn ${peligro ? "btn-danger" : "btn-primary"}" type="button" data-mp-ok>${escapar(boton)}</button></div></div>`
      );
      ventana.addEventListener("click", (e) => {
        if (e.target.closest("[data-mp-ok]")) { ventana.remove(); resolver(true); }
        else if (e.target === ventana || e.target.closest("[data-close]")) resolver(false);
      });
    });
  }

  // ───────────── Piezas de la pantalla ─────────────

  // Paso actual: una solicitud enviada con todos los documentos aprobados ya espera la asignación.
  function pasoActual(solicitud, docs) {
    if (!solicitud) return 0;
    const paso = PASO_DE_ESTADO[solicitud.estado];
    return paso === 2 && docs?.resumen?.expediente_completo ? 3 : paso;
  }

  /** Línea de tiempo de los 5 pasos de la práctica, con el paso actual resaltado. */
  function lineaDeTiempo(solicitud, docs) {
    const actual = pasoActual(solicitud, docs);
    return `<ol class="practice-steps" aria-label="Avance de tu práctica">${PASOS.map((p, i) => {
      const clase = i < actual ? "done" : i === actual ? "current" : "todo";
      return `<li class="${clase}" ${i === actual ? 'aria-current="step"' : ""}><span class="step-dot">${i < actual ? icon("check") : i + 1}</span><span class="step-text"><strong>${p.titulo}</strong><small>${p.ayuda}</small></span></li>`;
    }).join("")}</ol>`;
  }

  /** Tarjeta con el recorrido del estudiante por los niveles de práctica (finalizado, en curso, en solicitud o pendiente). */
  function trayectoriaHtml(t) {
    const etiqueta = { FINALIZADA: ["Finalizada", "success"], EN_CURSO: ["En curso", "info"], EN_SOLICITUD: ["En solicitud", "info"], PENDIENTE: ["Pendiente", "neutral"] };
    const hayFinalizadas = t.niveles.some((n) => n.estado === "FINALIZADA");
    return `<article class="panel content-block practice-trajectory"><span class="eyebrow">Tu trayectoria de prácticas</span>
      <ul class="trajectory">${t.niveles.map((n) => {
        const [texto, tono] = etiqueta[n.estado] || etiqueta.PENDIENTE;
        const propuesto = t.nivel_propuesto?.id === n.id;
        return `<li class="${n.estado === "FINALIZADA" ? "done" : n.estado === "PENDIENTE" ? "todo" : "current"} ${propuesto ? "next" : ""}"><strong>${escapar(n.nombre)}</strong><small>${escapar(n.semestre ? `Semestre ${n.semestre}` : "")}${n.periodo_codigo ? ` · ${escapar(n.periodo_codigo)}` : ""}</small>${badge(propuesto ? "Siguiente" : texto, propuesto ? "warning" : tono)}</li>`;
      }).join("")}</ul>
      ${hayFinalizadas ? `<a class="btn-link" href="${pathFor("estudiante", "dashboard")}?historial=1">Ver mis prácticas anteriores y calificaciones →</a>` : ""}</article>`;
  }

  /** Encabezado de la pantalla con título, texto y el periodo de la solicitud. */
  function encabezado(titulo, texto, solicitud) {
    return `<section class="welcome"><div><span class="eyebrow">Mi práctica</span><h2>${escapar(titulo)}</h2><p>${texto}</p></div>${solicitud ? badge(solicitud.periodo.codigo, "info") : ""}</section>${solicitud ? '<div data-guia-criterios></div>' : ""}`;
  }

  // ───────────── Pantalla A: todavía no solicitó ─────────────
  function pantallaSinSolicitud(t) {
    const n = t.nivel_propuesto;
    pagina.innerHTML = `${encabezado("Solicita tu práctica", "Aquí empieza el proceso: confirmas tu nivel, cargas tus documentos y eliges tu plaza.", null)}
      <section class="practice-panel panel content-block">${lineaDeTiempo(null)}</section>
      <section class="dashboard-grid">
        <article class="panel content-block practice-next"><span class="eyebrow">Tu siguiente práctica</span><h3>${escapar(n.nombre)}</h3>
          <p>${n.semestre ? `Corresponde al semestre ${escapar(String(n.semestre))}. ` : ""}El sistema calcula este nivel con las prácticas que ya terminaste: no es posible saltarse niveles.</p>
          <div class="notice">Al solicitar, se crea tu borrador. Podrás cargar tus documentos con calma y enviarlos a Dirección cuando estén completos.</div>
          <div class="form-actions"><button class="btn btn-primary" type="button" data-mp="solicitar" data-nivel="${escapar(n.id)}">Solicitar ${escapar(n.nombre)} →</button></div>
        </article>
        ${trayectoriaHtml(t)}
      </section>`;
  }

  // ───────────── Pantalla B: documentos (BORRADOR / DEVUELTA) ─────────────
  function filaDocumento(doc) {
    const e = ESTADO_DOC[doc.estado] || ESTADO_DOC.SIN_CARGAR;
    let detalle;
    if (doc.estado === "POR_CORREGIR") detalle = `Observación de Dirección: ${escapar(doc.observacion || "Revisa el documento y vuelve a cargarlo.")}`;
    else if (doc.estado === "APROBADO") detalle = `Aprobado${doc.revisado_en ? ` el ${escapar(fechaLarga(doc.revisado_en))}` : ""}`;
    else if (doc.estado === "EN_REVISION") detalle = `${escapar(doc.archivo?.nombre || "Archivo cargado")} · enviado${doc.enviado_en ? ` el ${escapar(fechaLarga(doc.enviado_en))}` : ""}`;
    else detalle = "Aún no has cargado este documento · PDF";
    let boton = "";
    if (doc.puede_subir) {
      const etiqueta = doc.estado === "SIN_CARGAR" ? "Cargar PDF" : "Reemplazar";
      boton = `<button class="btn ${doc.estado === "POR_CORREGIR" || doc.estado === "SIN_CARGAR" ? "btn-primary" : "btn-secondary"}" type="button" data-mp="subir" data-tipo="${escapar(doc.tipo.id)}" data-req="${escapar(doc.requisito_id)}">${icon("upload")}${etiqueta}</button>`;
    }
    const ver = doc.documento_id ? `<button class="btn btn-ghost" type="button" data-mp="ver" data-doc="${escapar(doc.documento_id)}">Ver archivo</button>` : "";
    return `<article class="req-doc req-${e.tono}" data-doc-card="${escapar(doc.requisito_id)}"><div class="req-doc-info"><strong>${escapar(doc.tipo.nombre)}${doc.obligatorio ? "" : " <small>(opcional)</small>"}</strong><p>${detalle}</p></div><div class="req-doc-actions">${badge(e.texto, e.tono)}${ver}${boton}</div></article>`;
  }

  // ¿Se puede enviar ya? Todo obligatorio cargado y nada por corregir.
  function listoParaEnviar(documentos) {
    return documentos.filter((d) => d.obligatorio).every((d) => d.estado === "EN_REVISION" || d.estado === "APROBADO")
      && !documentos.some((d) => d.estado === "POR_CORREGIR");
  }

  // ¿Dónde hará la práctica? Tarjeta con la institución elegida y el botón para elegir o cambiar.
  function bloquePlaza(solicitud, editable) {
    const elegida = solicitud.institucion_solicitada;
    const cuerpo = elegida
      ? `<div class="site-chosen">${icon("building")}<div><strong>${escapar(elegida.nombre)}</strong><small>${escapar(elegida.ciudad || "")}</small></div></div>`
      : `<p class="muted">Aún no has elegido la institución donde quieres hacer tu práctica.</p>`;
    const boton = editable ? `<button class="btn ${elegida ? "btn-secondary" : "btn-primary"}" type="button" data-mp="elegir-plaza">${elegida ? "Cambiar institución" : "Elegir institución"}</button>` : "";
    return `<article class="panel content-block practice-site"><header class="practice-block-head"><div><span class="eyebrow">Paso 2 · Plaza</span><h3>Institución donde quieres hacer tu práctica</h3></div></header>
      ${cuerpo}${boton ? `<div class="form-actions">${boton}</div>` : ""}
      <small class="muted practice-hint">Dirección valida tu elección. Si no hay cupo o debe cambiarla, te avisará con el motivo.</small></article>`;
  }

  /** Pantalla del paso «Documentos y plaza»: cuántos documentos obligatorios lleva cargados, la institución elegida y, si Dirección devolvió la solicitud, qué debe corregir. */
  function pantallaDocumentos(t, solicitud, docs) {
    const devuelta = solicitud.estado === "DEVUELTA";
    const obligatorios = docs.documentos.filter((d) => d.obligatorio);
    const cargados = obligatorios.filter((d) => d.estado === "EN_REVISION" || d.estado === "APROBADO").length;
    const conPlaza = Boolean(solicitud.institucion_solicitada);
    const listo = listoParaEnviar(docs.documentos) && conPlaza;
    const porcentaje = obligatorios.length ? Math.round((cargados / obligatorios.length) * 100) : 0;
    let pista = "";
    if (!listo) {
      const faltas = [];
      if (!conPlaza) faltas.push("elegir tu institución");
      if (!listoParaEnviar(docs.documentos)) faltas.push(devuelta ? "reemplazar los documentos por corregir" : "cargar todos los documentos obligatorios");
      pista = `<small class="muted practice-hint">Para enviar te falta ${faltas.join(" y ")}.</small>`;
    }
    pagina.innerHTML = `${encabezado(solicitud.nivel.nombre, devuelta ? "Dirección devolvió tu solicitud: corrige lo marcado y vuelve a enviarla." : "Carga tus documentos, elige tu institución y envía todo a Dirección.", solicitud)}
      <section class="practice-panel panel content-block">${lineaDeTiempo(solicitud, docs)}</section>
      ${devuelta ? `<div class="notice notice-warning" role="status">${icon("alert")}<span><strong>Solicitud devuelta.</strong> Corrige solo los documentos marcados como «Por corregir»; los demás se conservan. Aún puedes cambiar tu institución.</span></div>` : ""}
      <section class="dashboard-grid practice-main">
        <div class="practice-stack">
          ${bloquePlaza(solicitud, true)}
          <article class="panel content-block"><header class="practice-block-head"><div><span class="eyebrow">Paso 2 · Documentos</span><h3>Tu expediente</h3></div><span class="practice-count">${cargados} de ${obligatorios.length} obligatorios</span></header>
            <div class="progress" role="progressbar" aria-valuenow="${porcentaje}" aria-valuemin="0" aria-valuemax="100"><span style="width:${porcentaje}%"></span></div>
            <div class="req-doc-list">${docs.documentos.map(filaDocumento).join("") || '<p class="muted">Aún no hay documentos configurados.</p>'}</div>
            <div class="form-actions practice-send">
              ${solicitud.estado === "BORRADOR" ? '<button class="btn-link" type="button" data-mp="descartar">Descartar borrador</button>' : ""}
              <button class="btn btn-primary" type="button" data-mp="enviar" ${listo ? "" : "disabled"}>${devuelta ? "Reenviar a Dirección" : "Enviar a Dirección"} →</button>
            </div>
            ${pista}
          </article>
        </div>
        ${trayectoriaHtml(t)}
      </section>`;
  }

  // ───────────── Pantalla C: enviada, en manos de Dirección ─────────────
  function pantallaEnRevision(t, solicitud, docs) {
    const r = docs?.resumen;
    const aprobada = Boolean(r?.expediente_completo);
    const titulo = aprobada ? "Tus documentos están aprobados" : "Dirección está revisando tu solicitud";
    const texto = aprobada
      ? "Dirección valida tu plaza y te asignará un asesor de sitio. Te avisaremos con una notificación en cuanto tu práctica quede asignada."
      : `Enviaste tu solicitud${solicitud.enviada_en ? ` el ${escapar(fechaLarga(solicitud.enviada_en))}` : ""}. Dirección revisa tus documentos y la institución que pediste. Te avisaremos si algo necesita corrección o cuando tu práctica quede asignada.`;
    pagina.innerHTML = `${encabezado(solicitud.nivel.nombre, "Tu solicitud está en manos de Dirección del Programa.", solicitud)}
      <section class="practice-panel panel content-block">${lineaDeTiempo(solicitud, docs)}</section>
      <section class="dashboard-grid practice-main">
        <div class="practice-stack">
          <article class="panel content-block"><span class="eyebrow">${aprobada ? "Paso 4 · Asignación" : "Paso 3 · Revisión"}</span><h3>${titulo}</h3>
            <p>${texto}</p>
            ${r ? `<div class="practice-facts"><div><span>Aprobados</span><strong>${r.aprobados_obligatorios}/${r.total_obligatorios}</strong></div><div><span>En revisión</span><strong>${r.en_revision}</strong></div><div><span>Por corregir</span><strong>${r.por_corregir}</strong></div></div>` : ""}
          </article>
          ${bloquePlaza(solicitud, false)}
          ${docs ? `<article class="panel content-block"><header class="practice-block-head"><div><span class="eyebrow">Tu expediente</span><h3>Documentos enviados</h3></div></header><div class="req-doc-list">${docs.documentos.map(filaDocumento).join("")}</div></article>` : ""}
        </div>
        ${trayectoriaHtml(t)}
      </section>`;
  }

  // ───────────── Elegir plaza (ventana) ─────────────
  function tarjetaPlaza(p, elegida, marcada) {
    return `<label class="site-card ${marcada ? "selected" : ""}" data-site-text="${escapar(`${p.nombre} ${p.ciudad || ""} ${p.direccion || ""}`.toLowerCase())}"><input type="radio" name="plaza" value="${escapar(p.id)}" ${marcada ? "checked" : ""} /><span class="site-icon">${icon("building")}</span><span class="site-info"><strong>${escapar(p.nombre)}</strong><small>${escapar([p.ciudad, p.direccion].filter(Boolean).join(" · ") || "Sin dirección registrada")}</small></span>${elegida === p.id ? badge("Tu elección actual", "info") : ""}</label>`;
  }

  /** Ventana con las instituciones activas y con convenio vigente para que el estudiante elija su plaza; Dirección la valida después. */
  async function abrirElegirPlaza() {
    const solicitud = estado.trayectoria?.solicitud_abierta;
    if (!solicitud) return;
    const actual = solicitud.institucion_solicitada?.id ?? null;
    let seleccion = actual;
    const ventana = openModal("Elige tu institución", `<div><p class="muted">Solo aparecen instituciones activas con convenio vigente. Dirección validará tu elección.</p>
      <label class="search site-search"><span class="sr-only">Buscar institución</span><input type="search" data-mp-buscar placeholder="Buscar por nombre o ciudad…" /></label>
      <div class="site-list" role="radiogroup" aria-label="Instituciones disponibles" data-mp-lista><p class="muted">Cargando instituciones…</p></div>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="button" data-mp-guardar-plaza disabled>Guardar institución</button></div></div>`);
    const lista = ventana.querySelector("[data-mp-lista]");
    const guardar = ventana.querySelector("[data-mp-guardar-plaza]");
    try {
      if (estado.plazas === null) ({ data: estado.plazas } = await api.get("/practice-requests/available-sites"));
    } catch (error) {
      lista.innerHTML = `<p class="form-error" role="alert">${escapar(mensaje(error))}</p>`;
      return;
    }
    lista.innerHTML = estado.plazas.map((p) => tarjetaPlaza(p, actual, p.id === actual)).join("") || '<p class="muted">Por ahora no hay instituciones con convenio vigente. Comunícate con Dirección.</p>';
    ventana.addEventListener("change", (e) => {
      if (!e.target.matches('input[name="plaza"]')) return;
      seleccion = e.target.value;
      lista.querySelectorAll(".site-card").forEach((c) => c.classList.toggle("selected", c.contains(e.target)));
      guardar.toggleAttribute("disabled", seleccion === actual);
    });
    ventana.addEventListener("input", (e) => {
      if (!e.target.matches("[data-mp-buscar]")) return;
      const q = e.target.value.trim().toLowerCase();
      lista.querySelectorAll(".site-card").forEach((c) => { c.hidden = q !== "" && !c.dataset.siteText.includes(q); });
    });
    guardar.addEventListener("click", async () => {
      if (!seleccion || seleccion === actual) return;
      ventana.remove();
      await ejecutar(null, () => api.patch(`/practice-requests/${solicitud.id}/site`, { institucion_id: seleccion }), "Institución guardada");
    });
  }

  // ───────────── Carga y decisión de pantalla ─────────────
  async function cargar() {
    pagina.innerHTML = `<p class="muted practice-empty">Cargando tu práctica…</p>`;
    let t;
    try {
      ({ data: t } = await api.get("/me/practice-trajectory"));
    } catch (error) {
      pagina.innerHTML = errorHtml(mensaje(error));
      return;
    }
    estado.trayectoria = t;
    const solicitud = t.solicitud_abierta;
    if (!solicitud) return t.nivel_propuesto ? pantallaSinSolicitud(t) : window.location.reload();
    if (!ESTADOS_PREVIOS.includes(solicitud.estado)) return window.location.reload(); // ya está activa: panel de siempre

    // Documentos del expediente (la carga y el resumen de revisión los necesitan).
    let docs = null;
    try {
      ({ data: docs } = await api.get(`/practice-assignments/${solicitud.id}/legal-documents`));
    } catch (error) {
      if (["BORRADOR", "DEVUELTA"].includes(solicitud.estado)) { pagina.innerHTML = errorHtml(mensaje(error)); return; }
    }
    estado.documentos = docs;
    const pantalla = (solicitud.estado === "BORRADOR" || solicitud.estado === "DEVUELTA") ? pantallaDocumentos(t, solicitud, docs) : pantallaEnRevision(t, solicitud, docs);
    montarGuiaCriterios(solicitud.nivel?.id, solicitud.periodo?.id, pagina);
    return pantalla;
  }

  // ───────────── Acciones ─────────────
  async function ejecutar(boton, tarea, exito) {
    if (estado.ocupado) return;
    estado.ocupado = true;
    boton?.setAttribute("disabled", "");
    try {
      await tarea();
      if (exito) showToast(exito);
    } catch (error) {
      showToast(mensaje(error));
    } finally {
      estado.ocupado = false;
    }
    await cargar();
  }

  /** Abre el selector de archivos y sube el PDF del documento. Valida formato PDF, que no esté vacío y el tamaño máximo del tipo. */
  async function subir(tipoId, requisitoId) {
    const solicitud = estado.trayectoria?.solicitud_abierta;
    const doc = estado.documentos?.documentos.find((d) => d.requisito_id === requisitoId);
    if (!solicitud || !doc) return;
    const entrada = document.createElement("input");
    entrada.type = "file";
    entrada.accept = ".pdf,application/pdf";
    entrada.addEventListener("change", async () => {
      const archivo = entrada.files[0];
      if (!archivo) return;
      if (archivo.type !== "application/pdf" && !archivo.name.toLowerCase().endsWith(".pdf")) return showToast("Selecciona un archivo en formato PDF");
      if (archivo.size === 0) return showToast("El archivo está vacío");
      if (archivo.size > doc.tipo.tamano_maximo_bytes) return showToast(`El archivo supera el tamaño máximo de ${Math.floor(doc.tipo.tamano_maximo_bytes / 1024 / 1024)} MB`);
      showToast("Subiendo archivo…");
      await ejecutar(null, () => api.post(`/practice-assignments/${solicitud.id}/legal-documents/${tipoId}/upload`, new Blob([archivo], { type: "application/pdf" }), {
        headers: { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(archivo.name) },
      }), "Archivo cargado");
    });
    entrada.click();
  }

  /** Abre el PDF de un documento en una pestaña nueva mediante una URL firmada y temporal. */
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

  pagina.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-mp]");
    if (!el) return;
    const accion = el.dataset.mp;
    const solicitud = estado.trayectoria?.solicitud_abierta;
    if (accion === "reintentar") return cargar();
    if (accion === "solicitar") {
      return ejecutar(el, () => api.post("/practice-requests", { nivel_practica_id: el.dataset.nivel }), "Solicitud creada: ahora carga tus documentos");
    }
    if (accion === "subir") return subir(el.dataset.tipo, el.dataset.req);
    if (accion === "ver") return ver(el.dataset.doc);
    if (accion === "enviar" && solicitud) {
      const ok = await confirmar({ titulo: "Enviar a Dirección", texto: "Dirección revisará tus documentos y la institución que elegiste. Mientras esté en revisión no podrás cambiarlos, salvo que te los devuelva. ¿Quieres enviarlos?", boton: "Sí, enviar" });
      if (ok) await ejecutar(el, () => api.post(`/practice-requests/${solicitud.id}/submit`), "Solicitud enviada a Dirección");
      return;
    }
    if (accion === "descartar" && solicitud) {
      const ok = await confirmar({ titulo: "Descartar borrador", texto: "Se borrará tu borrador y los documentos que cargaste. Podrás solicitar de nuevo cuando quieras. ¿Descartarlo?", boton: "Sí, descartar", peligro: true });
      if (ok) await ejecutar(el, () => api.delete(`/practice-requests/${solicitud.id}`), "Borrador descartado");
      return;
    }
    if (accion === "elegir-plaza" && solicitud) return abrirElegirPlaza();
  });

  // ¿Esta pantalla maneja el estado actual? (se decide antes de dibujar nada para no parpadear)
  let t;
  try {
    ({ data: t } = await api.get("/me/practice-trajectory"));
  } catch {
    return false;
  }
  const abierta = t.solicitud_abierta;
  const manejar = abierta ? ESTADOS_PREVIOS.includes(abierta.estado) : Boolean(t.nivel_propuesto);
  if (!manejar) return false;
  await cargar();
  return true;
}

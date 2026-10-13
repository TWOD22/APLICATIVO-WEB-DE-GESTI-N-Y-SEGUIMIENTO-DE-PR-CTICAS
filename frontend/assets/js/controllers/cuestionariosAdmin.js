/**
 * Cuestionarios por nivel (Director) conectados al API real.
 * Cada nivel tiene versiones: un BORRADOR editable y versiones PUBLICADAS inmutables; una sola versión por nivel está
 * habilitada (la que ven los estudiantes en su bitácora).
 */
import { api } from "../services/api.js";

// Tipos de pregunta: texto visible, detalle y clase CSS.
const TIPOS = {
  ABIERTA: { texto: "Abierta", detalle: "Respuesta abierta", clase: "open" },
  CERRADA_UNICA: { texto: "Cerrada", detalle: "Selección única", clase: "closed" },
  CERRADA_MULTIPLE: { texto: "Cerrada", detalle: "Selección múltiple", clase: "closed" },
};
// ¿La pregunta se responde eligiendo opciones? (todas menos la abierta)
const esCerrada = (tipo) => tipo !== "ABIERTA";
// Une el mensaje del error con los detalles de validación del servidor.
const mensajeDeError = (error) => {
  const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => d.mensaje) : [];
  return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
};
// Fecha corta en español (vacío si no hay fecha válida).
const fecha = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "";
};

/**
 * Conecta la pantalla de cuestionarios con la API.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarCuestionarios(ui) {
  const { badge, escapar, openModal, showToast } = ui;
  const pagina = document.querySelector(".page");
    // Estado local: niveles, versiones del nivel elegido, detalle de la versión abierta y bandera de operación en curso.
  const estado = { niveles: [], nivelId: null, versiones: [], detalle: null, ocupado: false, error: null };

  const url = new URL(window.location.href);
  const nivelInicial = url.searchParams.get("nivel");

  // ───────────── Carga ─────────────
    /** Carga los niveles de práctica y abre el primero (o el indicado en ?nivel=). */
  async function cargarNiveles() {
    try {
      const { data } = await api.get("/practice-levels");
      estado.niveles = data.filter((n) => n.activo !== false);
      estado.nivelId = estado.niveles.find((n) => n.id === nivelInicial)?.id ?? estado.niveles[0]?.id ?? null;
      await cargarNivel();
    } catch (error) {
      pintarError(mensajeDeError(error), cargarNiveles);
    }
  }

  /** Carga las versiones del nivel y el detalle de la versión indicada (o la más relevante). */
  async function cargarNivel(versionId = null) {
    if (!estado.nivelId) { pintar(); return; }
    pagina.querySelector("#qz-banco")?.setAttribute("aria-busy", "true");
    try {
      const { data: versiones } = await api.get("/questionnaires", { nivel_practica_id: estado.nivelId });
      estado.versiones = versiones.slice().sort((a, b) => b.numero_version - a.numero_version);
      const elegida = estado.versiones.find((v) => v.id === versionId)
        ?? estado.versiones.find((v) => v.estado === "BORRADOR")
        ?? estado.versiones.find((v) => v.habilitado)
        ?? estado.versiones[0] ?? null;
      estado.detalle = elegida ? (await api.get(`/questionnaires/${elegida.id}`)).data : null;
      estado.error = null;
    } catch (error) {
      estado.error = mensajeDeError(error);
    }
    pintar();
  }

    // Reemplaza el detalle en pantalla con la respuesta del servidor y actualiza la versión en la lista.
  const recargarDetalle = (detalle) => {
    estado.detalle = detalle;
    const i = estado.versiones.findIndex((v) => v.id === detalle.id);
    if (i >= 0) estado.versiones[i] = { ...estado.versiones[i], ...detalle, preguntas: undefined, total_preguntas: detalle.preguntas.length };
    pintar();
  };

  // ───────────── Pintado ─────────────
    /** Muestra un error de carga con botón para reintentar. */
  function pintarError(mensaje, reintentar) {
    pagina.innerHTML = `<div style="padding:32px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" data-qz-reintentar>Reintentar</button></div>`;
    pagina.querySelector("[data-qz-reintentar]").addEventListener("click", reintentar);
  }

    // Texto del selector de versiones (borrador, publicada o habilitada).
  const etiquetaVersion = (v) => `Versión ${v.numero_version} · ${v.estado === "BORRADOR" ? "Borrador" : v.habilitado ? "Publicada y habilitada" : "Publicada"}`;

    /** HTML de una pregunta del banco (con botones de orden, editar y eliminar si el borrador es editable). */
  function itemPregunta(p, i, total, editable) {
    const t = TIPOS[p.tipo];
    const opciones = esCerrada(p.tipo)
      ? `<ol class="question-options ${p.tipo === "CERRADA_MULTIPLE" ? "multiple" : "single"}">${p.opciones.map((o) => `<li><i>${p.tipo === "CERRADA_MULTIPLE" ? "□" : "○"}</i>${escapar(o.etiqueta)}</li>`).join("")}</ol>`
      : `<div class="open-answer-preview"><span>Espacio para respuesta abierta del estudiante</span></div>`;
    const orden = editable
      ? `<div style="display:flex;flex-direction:column;gap:2px"><button class="btn btn-ghost" type="button" data-qz-subir="${escapar(p.id)}" aria-label="Subir pregunta" ${i === 0 ? "disabled" : ""} style="padding:0 8px;min-height:24px">▲</button><button class="btn btn-ghost" type="button" data-qz-bajar="${escapar(p.id)}" aria-label="Bajar pregunta" ${i === total - 1 ? "disabled" : ""} style="padding:0 8px;min-height:24px">▼</button></div>`
      : "<span></span>"; // la cuadrícula del banco espera siempre una primera columna
    return `<article class="question-bank-item" data-qz-pregunta="${escapar(p.id)}">${orden}<span class="question-number">${i + 1}</span><div class="question-bank-copy"><div><span class="question-type ${t.clase}">${t.texto}</span>${esCerrada(p.tipo) ? `<span class="answer-mode">${t.detalle}</span>` : ""}${p.obligatoria ? '<span class="required-label">Obligatoria</span>' : '<span class="answer-mode">Opcional</span>'}<h4>${escapar(p.enunciado)}</h4></div>${opciones}</div>${editable ? `<div class="question-item-actions"><button class="btn btn-secondary" type="button" data-qz-editar="${escapar(p.id)}">Editar</button><button class="btn btn-danger" type="button" data-qz-eliminar="${escapar(p.id)}">Eliminar</button></div>` : ""}</article>`;
  }

    /** HTML del banco de preguntas del nivel: encabezado, avisos, acciones y lista. */
  function pintarBanco() {
    const nivel = estado.niveles.find((n) => n.id === estado.nivelId);
    const d = estado.detalle;
    if (estado.error) {
      return `<div style="padding:24px;text-align:center"><p class="form-error" role="alert">${escapar(estado.error)}</p><button class="btn btn-secondary" type="button" data-qz-recargar>Reintentar</button></div>`;
    }
    if (!d) {
      return `<header class="panel-heading question-bank-heading"><div><span class="eyebrow">${escapar(nivel?.nombre || "")}</span><h3>Este nivel aún no tiene cuestionario</h3><p>Crea el primero para que los estudiantes de este nivel respondan preguntas en su bitácora.</p></div><div class="question-bank-actions"><button class="btn btn-primary" type="button" data-qz-crear-vacio>Crear cuestionario</button></div></header><div class="empty-state"><strong>Sin cuestionario configurado</strong><p>La bitácora funciona igual sin preguntas; el cuestionario es opcional.</p></div>`;
    }
    const editable = d.editable;
    const selectorVersion = estado.versiones.length > 1
      ? `<label class="field" style="max-width:320px"><span>Versión</span><select data-qz-version>${estado.versiones.map((v) => `<option value="${escapar(v.id)}" ${v.id === d.id ? "selected" : ""}>${escapar(etiquetaVersion(v))}</option>`).join("")}</select></label>`
      : "";
    const insignias = `${badge(editable ? "Borrador" : "Publicado", editable ? "warning" : "success")} ${!editable ? badge(d.habilitado ? "Habilitado" : "Deshabilitado", d.habilitado ? "success" : "neutral") : ""}`;
    let acciones;
    if (editable) {
      acciones = `<button class="btn btn-secondary" type="button" data-qz-titulo>Renombrar</button><button class="btn btn-primary" type="button" data-qz-agregar>+ Agregar pregunta</button><button class="btn btn-primary" type="button" data-qz-publicar ${d.preguntas.length ? "" : "disabled"}>Publicar versión</button>`;
    } else {
      acciones = `<label class="master-switch"><span><strong>Habilitar preguntas</strong><small>Al activarlo, los estudiantes de este nivel podrán responderlas en su bitácora.</small></span><input type="checkbox" data-qz-habilitar ${d.habilitado ? "checked" : ""} /><i aria-hidden="true"></i></label><button class="btn btn-secondary" type="button" data-qz-nueva-version>Crear nueva versión para editar</button>`;
    }
    const aviso = editable
      ? `<div class="notice"><span>Estás editando un <strong>borrador</strong>: los estudiantes no lo ven hasta que lo publiques. Al publicarlo queda habilitado y reemplaza la versión vigente; las bitácoras que ya usan la versión anterior no se alteran.</span></div>`
      : `<div class="notice"><span>Esta versión está <strong>publicada</strong> y no se puede modificar${d.total_bitacoras ? ` (la usan ${d.total_bitacoras} bitácora${d.total_bitacoras === 1 ? "" : "s"})` : ""}. Para cambiar preguntas crea una nueva versión.${d.publicado_en ? ` Publicada el ${escapar(fecha(d.publicado_en))}.` : ""}</span></div>`;
    return `<header class="panel-heading question-bank-heading"><div><span class="eyebrow">${escapar(nivel?.nombre || d.nivel.nombre)} · Versión ${d.numero_version}</span><h3>${escapar(d.titulo)} ${insignias}</h3><p>${d.preguntas.length} ${d.preguntas.length === 1 ? "pregunta" : "preguntas"} en esta versión.</p></div><div class="question-bank-actions">${acciones}</div></header>
      <div style="padding:0 20px 8px;display:grid;gap:12px">${selectorVersion}${aviso}<p class="form-error" role="alert" data-qz-error hidden></p></div>
      <div class="question-bank-list">${d.preguntas.length ? d.preguntas.map((p, i) => itemPregunta(p, i, d.preguntas.length, editable)).join("") : '<div class="empty-state"><strong>Este borrador aún no tiene preguntas</strong><p>Agrega una pregunta abierta o cerrada para comenzar.</p></div>'}</div>`;
  }

    /** Dibuja la pantalla completa (armazón la primera vez y luego solo el banco). */
  function pintar() {
    if (!pagina.querySelector("#qz-banco")) {
      pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Configuración académica</span><h2>Cuestionarios por nivel</h2><p>Diseña las preguntas que complementan la bitácora.</p></div></header>
        <section class="panel level-selector-panel"><header class="panel-heading"><div><h3>Niveles de práctica</h3><p>Selecciona un nivel para consultar y administrar su cuestionario.</p></div></header><div class="content-block"><label class="field"><span>Nivel de práctica</span><select data-qz-nivel>${estado.niveles.map((n) => `<option value="${escapar(n.id)}" ${n.id === estado.nivelId ? "selected" : ""}>${escapar(n.nombre)}</option>`).join("")}</select></label><div class="notice">Cada nivel mantiene un cuestionario independiente. Solo la versión habilitada aparece al estudiante.</div></div></section>
        <section class="panel question-bank-panel" id="qz-banco"></section>`;
    }
    const banco = pagina.querySelector("#qz-banco");
    banco.removeAttribute("aria-busy");
    banco.innerHTML = pintarBanco();
  }

  // ───────────── Acciones ─────────────
    /** Muestra un error cerca de las acciones (o como aviso si no existe el espacio). */
  function avisar(mensaje) {
    const caja = pagina.querySelector("[data-qz-error]");
    if (!caja) { showToast(mensaje); return; }
    caja.textContent = mensaje; caja.hidden = false;
    caja.scrollIntoView({ block: "nearest" });
  }

    /** Ejecuta una acción evitando clics dobles; si el estado cambió en otra sesión, refresca la pantalla. */
  async function ejecutar(accion, exito) {
    if (estado.ocupado) return;
    estado.ocupado = true;
    pagina.querySelector("[data-qz-error]")?.setAttribute("hidden", "");
    try {
      await accion();
      if (exito) showToast(exito);
    } catch (error) {
      avisar(mensajeDeError(error));
      // Si el estado cambió en otra sesión (p. ej. ya fue publicado) se refresca lo que se ve.
      if (["QUESTIONNAIRE_PUBLISHED", "QUESTION_NOT_FOUND", "QUESTIONNAIRE_NOT_FOUND"].includes(error?.code)) await cargarNivel(estado.detalle?.id);
    } finally {
      estado.ocupado = false;
    }
  }

    // Sube o baja una pregunta intercambiándola con su vecina y pide el nuevo orden al servidor.
  const mover = (preguntaId, delta) => ejecutar(async () => {
    const ids = estado.detalle.preguntas.map((p) => p.id);
    const i = ids.indexOf(preguntaId), j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    recargarDetalle((await api.post(`/questionnaires/${estado.detalle.id}/reorder`, { orden: ids })).data);
  });

    /** Ventana para agregar o editar una pregunta (abierta o cerrada con 2 a 10 opciones distintas). */
  function abrirPregunta(existente = null) {
    let opciones = existente && esCerrada(existente.tipo) ? existente.opciones.map((o) => o.etiqueta) : ["", "", "", ""];
    const tipoInicial = existente?.tipo ?? "ABIERTA";
    const modal = openModal(`${existente ? "Editar" : "Agregar"} pregunta`, `<form id="qz-form" novalidate><div class="form-grid question-form-grid"><label class="field"><span>Tipo de pregunta</span><select name="tipo" data-qz-tipo><option value="ABIERTA" ${tipoInicial === "ABIERTA" ? "selected" : ""}>Pregunta abierta</option><option value="CERRADA_UNICA" ${tipoInicial === "CERRADA_UNICA" ? "selected" : ""}>Cerrada · selección única (una respuesta)</option><option value="CERRADA_MULTIPLE" ${tipoInicial === "CERRADA_MULTIPLE" ? "selected" : ""}>Cerrada · selección múltiple (varias respuestas)</option></select></label><label class="field"><span>¿Es obligatoria?</span><select name="obligatoria"><option value="true" ${(existente?.obligatoria ?? true) ? "selected" : ""}>Sí, es obligatoria</option><option value="false" ${existente?.obligatoria === false ? "selected" : ""}>No, es opcional</option></select></label><label class="field question-text-field"><span>Enunciado de la pregunta</span><textarea name="enunciado" required maxlength="1000" placeholder="Escribe la pregunta que verá el estudiante...">${escapar(existente?.enunciado || "")}</textarea></label></div>
      <div data-qz-cerradas><span class="form-section-title">Opciones de respuesta</span><p class="muted">Agrega entre 2 y 10 opciones distintas.</p><div class="dynamic-option-list" data-qz-opciones></div><button class="btn btn-secondary" type="button" data-qz-agregar-opcion>+ Agregar opción</button></div>
      <div data-qz-abierta class="notice">El estudiante verá un espacio en blanco para redactar libremente su respuesta.</div>
      <p class="form-error" role="alert" data-qz-form-error hidden></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">${existente ? "Guardar cambios" : "Agregar pregunta"}</button></div></form>`);
    const tipo = modal.querySelector("[data-qz-tipo]");
    const lista = modal.querySelector("[data-qz-opciones]");
    const leerOpciones = () => [...lista.querySelectorAll("input")].map((i) => i.value);
    const pintarOpciones = () => {
      lista.innerHTML = opciones.map((o, i) => `<label class="dynamic-option"><span>${i + 1}</span><input value="${escapar(o)}" maxlength="250" placeholder="Escribe la opción ${i + 1}" /><button type="button" data-qz-quitar-opcion="${i}" aria-label="Eliminar opción" ${opciones.length <= 2 ? "disabled" : ""}>×</button></label>`).join("");
      modal.querySelector("[data-qz-agregar-opcion]").disabled = opciones.length >= 10;
    };
    const sincronizar = () => {
      const cerrada = esCerrada(tipo.value);
      modal.querySelector("[data-qz-cerradas]").style.display = cerrada ? "block" : "none";
      modal.querySelector("[data-qz-abierta]").style.display = cerrada ? "none" : "flex";
    };
    pintarOpciones(); sincronizar();
    tipo.addEventListener("change", sincronizar);
    modal.addEventListener("click", (e) => {
      if (e.target.closest("[data-qz-agregar-opcion]") && opciones.length < 10) { opciones = [...leerOpciones(), ""]; pintarOpciones(); }
      const quitar = e.target.closest("[data-qz-quitar-opcion]");
      if (quitar && opciones.length > 2) { opciones = leerOpciones(); opciones.splice(Number(quitar.dataset.qzQuitarOpcion), 1); pintarOpciones(); }
    });
    modal.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const aviso = modal.querySelector("[data-qz-form-error]");
      const f = new FormData(e.currentTarget);
      const cuerpo = { tipo: f.get("tipo"), enunciado: f.get("enunciado").trim(), obligatoria: f.get("obligatoria") === "true" };
      aviso.hidden = true;
      if (cuerpo.enunciado.length < 3) { aviso.textContent = "El enunciado debe tener al menos 3 caracteres."; aviso.hidden = false; return; }
      if (esCerrada(cuerpo.tipo)) {
        const etiquetas = leerOpciones().map((o) => o.trim()).filter(Boolean);
        if (etiquetas.length < 2) { aviso.textContent = "Escribe al menos dos opciones de respuesta."; aviso.hidden = false; return; }
        if (new Set(etiquetas.map((o) => o.toLocaleLowerCase("es"))).size !== etiquetas.length) { aviso.textContent = "Las opciones no pueden repetirse."; aviso.hidden = false; return; }
        cuerpo.opciones = etiquetas.map((etiqueta) => ({ etiqueta }));
      } else if (existente && esCerrada(existente.tipo)) {
        cuerpo.opciones = []; // al pasar a abierta se retiran las opciones
      }
      const enviar = modal.querySelector("[type=submit]");
      enviar.disabled = true;
      try {
        const { data } = existente ? await api.patch(`/questions/${existente.id}`, cuerpo) : await api.post(`/questionnaires/${estado.detalle.id}/questions`, cuerpo);
        modal.remove();
        showToast(existente ? "Pregunta actualizada" : "Pregunta agregada");
        recargarDetalle(existente ? (await api.get(`/questionnaires/${estado.detalle.id}`)).data : data);
      } catch (error) {
        aviso.textContent = mensajeDeError(error); aviso.hidden = false; enviar.disabled = false;
        if (error?.code === "QUESTIONNAIRE_PUBLISHED") { modal.remove(); await cargarNivel(estado.detalle?.id); }
      }
    });
  }

    /** Ventana de confirmación genérica: ejecuta `accion` al aceptar y muestra el error si falla. */
  function confirmar({ titulo, html, boton, tono = "btn-primary", accion, exito }) {
    const modal = openModal(titulo, `<div>${html}<p class="form-error" role="alert" data-qz-modal-error hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn ${tono}" type="button" data-qz-ok>${boton}</button></div></div>`);
    modal.querySelector("[data-qz-ok]").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        await accion();
        modal.remove();
        showToast(exito);
      } catch (error) {
        const aviso = modal.querySelector("[data-qz-modal-error]");
        aviso.textContent = mensajeDeError(error); aviso.hidden = false; e.currentTarget.disabled = false;
      }
    });
  }

    /** Crea una versión nueva en borrador (copiando la vigente o vacía). */
  function crearVersion({ sinCopia }) {
    return ejecutar(async () => {
      try {
        const { data } = await api.post("/questionnaires", { nivel_practica_id: estado.nivelId, ...(sinCopia ? { sin_copia: true } : {}) });
        await cargarNivel(data.id);
      } catch (error) {
        if (error?.code === "DRAFT_ALREADY_EXISTS") { await cargarNivel(); showToast("Este nivel ya tenía un borrador; lo abrimos para que continúes."); return; }
        throw error;
      }
    }, sinCopia ? "Cuestionario creado. Agrega las preguntas y publícalo." : "Nueva versión creada en borrador");
  }

  // ───────────── Eventos ─────────────
    // Cambios de nivel, versión y del interruptor "Habilitar preguntas".
  pagina.addEventListener("change", (e) => {
    if (e.target.matches("[data-qz-nivel]")) { estado.nivelId = e.target.value; estado.detalle = null; cargarNivel(); return; }
    if (e.target.matches("[data-qz-version]")) { cargarNivel(e.target.value); return; }
    if (e.target.matches("[data-qz-habilitar]")) {
      const caja = e.target, habilitado = caja.checked;
      ejecutar(async () => {
        try {
          await api.patch(`/questionnaires/${estado.detalle.id}/enabled`, { habilitado });
          await cargarNivel(estado.detalle.id);
        } catch (error) { caja.checked = !habilitado; throw error; }
      }, habilitado ? "Preguntas habilitadas para los estudiantes del nivel" : "Preguntas deshabilitadas");
    }
  });

    // Clics (delegación): crear, agregar, editar, ordenar, eliminar, renombrar y publicar.
  pagina.addEventListener("click", (e) => {
    const d = estado.detalle;
    const pregunta = (id) => d?.preguntas.find((p) => p.id === id);
    if (e.target.closest("[data-qz-recargar]")) { cargarNivel(d?.id); return; }
    if (e.target.closest("[data-qz-crear-vacio]")) { crearVersion({ sinCopia: true }); return; }
    if (e.target.closest("[data-qz-nueva-version]")) { crearVersion({ sinCopia: false }); return; }
    if (e.target.closest("[data-qz-agregar]")) { abrirPregunta(); return; }
    const editar = e.target.closest("[data-qz-editar]");
    if (editar) { abrirPregunta(pregunta(editar.dataset.qzEditar)); return; }
    const subir = e.target.closest("[data-qz-subir]");
    if (subir) { mover(subir.dataset.qzSubir, -1); return; }
    const bajar = e.target.closest("[data-qz-bajar]");
    if (bajar) { mover(bajar.dataset.qzBajar, 1); return; }
    const eliminar = e.target.closest("[data-qz-eliminar]");
    if (eliminar) {
      const p = pregunta(eliminar.dataset.qzEliminar);
      confirmar({ titulo: "Eliminar pregunta", html: `<p>¿Eliminar esta pregunta del borrador?</p><div class="notice">${escapar(p.enunciado)}</div>`, boton: "Eliminar pregunta", tono: "btn-danger",
        accion: async () => { await api.delete(`/questions/${p.id}`); recargarDetalle((await api.get(`/questionnaires/${d.id}`)).data); }, exito: "Pregunta eliminada" });
      return;
    }
    if (e.target.closest("[data-qz-titulo]")) {
      const modal = openModal("Renombrar cuestionario", `<form novalidate><label class="field"><span>Título</span><input name="titulo" maxlength="200" value="${escapar(d.titulo)}" required /></label><p class="form-error" role="alert" data-qz-modal-error hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar</button></div></form>`);
      modal.querySelector("form").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const aviso = modal.querySelector("[data-qz-modal-error]");
        const titulo = new FormData(ev.currentTarget).get("titulo").trim();
        if (titulo.length < 3) { aviso.textContent = "El título debe tener al menos 3 caracteres."; aviso.hidden = false; return; }
        try { const { data } = await api.patch(`/questionnaires/${d.id}`, { titulo }); modal.remove(); showToast("Título actualizado"); recargarDetalle(data); }
        catch (error) { aviso.textContent = mensajeDeError(error); aviso.hidden = false; }
      });
      return;
    }
    if (e.target.closest("[data-qz-publicar]")) {
      const vigente = estado.versiones.find((v) => v.habilitado && v.id !== d.id);
      confirmar({ titulo: "Publicar versión", boton: "Publicar y habilitar",
        html: `<p>Vas a publicar la <strong>versión ${d.numero_version}</strong> con ${d.preguntas.length} ${d.preguntas.length === 1 ? "pregunta" : "preguntas"}.</p><div class="notice"><span>Una vez publicada <strong>no se podrá modificar</strong> y quedará habilitada para los estudiantes de este nivel.${vigente ? ` Reemplaza a la versión ${vigente.numero_version}; las bitácoras que ya la usan la conservan.` : ""}</span></div>`,
        accion: async () => { const { data } = await api.post(`/questionnaires/${d.id}/publish`); await cargarNivel(data.id); }, exito: "Cuestionario publicado y habilitado" });
    }
  });

  cargarNiveles();
}

/**
 * Pantalla "Asignaciones de práctica" (Director) conectada al API real:
 * listar con filtros, crear, reasignar y cancelar.
 */
import { api } from "../services/api.js";

// Filas por página en la tabla.
const TAMANO_PAGINA = 10;
// Estado de completitud de una asignación: [texto, color de la insignia].
const COMPLETITUD = {
  SIN_DOCENTE: ["Sin docente", "warning"],
  SIN_ASESOR: ["Sin asesor", "warning"],
  COMPLETA: ["Completa", "success"],
};
// Texto legible de cada estado de la asignación.
const ESTADO_ASIGNACION = {
  PENDIENTE_DOCUMENTOS: "Pendiente de documentos",
  ACTIVA: "Activa",
  PENDIENTE_EVALUACION: "Pendiente de evaluación",
  FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada",
};
// Estados en los que la asignación todavía puede reasignarse o cancelarse.
const ABIERTOS = ["PENDIENTE_DOCUMENTOS", "ACTIVA", "PENDIENTE_EVALUACION"];

/**
 * Conecta la pantalla con la API.
 * @param {object} ui Utilidades de interfaz compartidas (insignias, escape de HTML, modales y avisos).
 */
export function montarAsignaciones(ui) {
  const { badge, escapar, initials, openModal, showToast } = ui;
  const contenedor = document.querySelector("#assignment-table");
  if (!contenedor) return;
    // Estado local de la pantalla. `turno` descarta respuestas viejas si el usuario cambia de filtro rápido.
  const estado = { periodos: [], periodoId: "", q: "", nivel: "", completitud: "", pagina: 1, filas: new Map(), turno: 0 };

    // Une el mensaje del error con los detalles de validación del servidor.
  const mensajeDeError = (error) => {
    const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => `${d.campo ? `${d.campo}: ` : ""}${d.mensaje}`) : [];
    return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
  };

  // ---------- Listado ----------
    /** Pide las asignaciones al servidor según filtros y página, y las dibuja. */
  async function cargar() {
    const turno = ++estado.turno;
    contenedor.innerHTML = `<p class="muted" style="padding:24px;text-align:center">Cargando asignaciones…</p>`;
    try {
      const consulta = { page: estado.pagina, page_size: TAMANO_PAGINA };
      if (estado.periodoId) consulta.periodo_id = estado.periodoId;
      if (estado.q) consulta.q = estado.q;
      if (estado.nivel) consulta.nivel = estado.nivel;
      if (estado.completitud) consulta.completitud = estado.completitud;
      const { data, meta } = await api.get("/practice-assignments", consulta);
      if (turno !== estado.turno) return;
      estado.filas = new Map(data.map((a) => [a.id, a]));
      pintar(data, meta);
    } catch (error) {
      if (turno !== estado.turno) return;
      contenedor.innerHTML = `<div style="padding:24px;text-align:center"><p class="form-error" role="alert">${escapar(mensajeDeError(error))}</p><button class="btn btn-secondary" type="button" data-a-retry>Reintentar</button></div>`;
    }
  }

    /** Dibuja la tabla de asignaciones y la paginación. */
  function pintar(filas, meta) {
    const cuerpo = filas.map((a) => {
      const [textoC, tonoC] = COMPLETITUD[a.completitud] || [a.completitud, "neutral"];
      const abierta = ABIERTOS.includes(a.estado);
      return `<tr data-a-row="${escapar(a.id)}"><td><div class="person"><span class="avatar">${escapar(initials(a.estudiante.nombre_completo))}</span><span><strong>${escapar(a.estudiante.nombre_completo)}</strong><small>${escapar(a.estudiante.documento)} · ${a.estudiante.semestre ? `${a.estudiante.semestre}° semestre` : ""}</small></span></div></td><td><strong>${escapar(a.nivel.nombre)}</strong><small>${escapar(a.institucion.nombre)} · ${escapar(ESTADO_ASIGNACION[a.estado] || a.estado)}</small></td><td>${a.docente ? `<strong>${escapar(a.docente.nombre_completo)}</strong><small>Docente UDI</small>` : badge("Sin asignar", "warning")}</td><td>${a.asesor ? `<strong>${escapar(a.asesor.nombre_completo)}</strong><small>${escapar(a.institucion.nombre)}</small>` : badge("Sin asignar", "warning")}</td><td>${a.estado === "CANCELADA" ? badge("Cancelada", "neutral") : badge(textoC, tonoC)}</td><td>${abierta ? `<div class="row-actions"><button class="btn btn-secondary" type="button" data-a-reassign="${escapar(a.id)}">Reasignar</button><button class="btn btn-danger" type="button" data-a-cancel="${escapar(a.id)}">Cancelar</button></div>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="6"><div class="empty-state">No hay asignaciones para los filtros seleccionados.</div></td></tr>`;
    const desde = (meta.page - 1) * meta.page_size + 1;
    const botones = [`<button type="button" data-a-page="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>`];
    for (let n = 1; n <= meta.total_pages; n++) botones.push(`<button type="button" class="${n === meta.page ? "active" : ""}" data-a-page="${n}">${n}</button>`);
    botones.push(`<button type="button" data-a-page="${meta.page + 1}" ${meta.page >= meta.total_pages ? "disabled" : ""} aria-label="Página siguiente">›</button>`);
    contenedor.innerHTML = `<div class="table-wrap"><table class="assignment-table"><thead><tr><th>Estudiante</th><th>Práctica / institución</th><th>Docente supervisor</th><th>Asesor de sitio</th><th>Estado de asignación</th><th>Acción</th></tr></thead><tbody>${cuerpo}</tbody></table></div><footer class="pagination"><span>${meta.total ? `Mostrando ${desde} - ${desde + filas.length - 1} de ${meta.total} asignaciones` : "0 asignaciones"}</span><nav aria-label="Paginación de asignaciones">${botones.join("")}</nav></footer>`;
  }

  // ---------- Filtros ----------
    // Búsqueda con espera de 300 ms para no consultar en cada tecla.
  let temporizador;
  document.querySelector("#assignment-search")?.addEventListener("input", (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { estado.q = e.target.value.trim(); estado.pagina = 1; cargar(); }, 300);
  });
  document.querySelector("#assignment-period-filter")?.addEventListener("change", (e) => { estado.periodoId = e.target.value; estado.pagina = 1; cargar(); });
  document.querySelector("#assignment-level-filter")?.addEventListener("change", (e) => { estado.nivel = e.target.value === "all" ? "" : e.target.value; estado.pagina = 1; cargar(); });
  document.querySelector("#assignment-status-filter")?.addEventListener("change", (e) => { estado.completitud = e.target.value === "all" ? "" : e.target.value; estado.pagina = 1; cargar(); });

  // ---------- Catálogos del formulario ----------
    /** Carga instituciones vigentes, docentes activos y niveles para el formulario. */
  async function catalogos() {
    const [instituciones, docentes, niveles] = await Promise.all([
      api.get("/institutions", { activa: "true", estado_convenio: "VIGENTE", page_size: 100 }),
      api.get("/users", { rol: "DOCENTE_SUPERVISOR", estado: "ACTIVO", page_size: 100 }),
      api.get("/practice-levels"),
    ]);
    return { instituciones: instituciones.data, docentes: docentes.data, niveles: niveles.data };
  }
    // Asesores activos de una institución (dependen de la institución elegida).
  const asesoresDe = async (institucionId) => {
    if (!institucionId) return [];
    const periodo = estado.periodoId ? { periodo_id: estado.periodoId } : {};
    const { data } = await api.get(`/institutions/${institucionId}/advisors`, periodo);
    return data.filter((a) => a.activa !== false && a.estado === "ACTIVO");
  };

  // ---------- Alta / reasignación ----------
    /** Abre el formulario para crear una asignación (sin argumento) o reasignar una existente. */
  async function abrir(asignacion = null) {
    const edicion = Boolean(asignacion);
    let cat, elegibles = [];
    try {
      cat = await catalogos();
      if (!edicion) elegibles = (await api.get("/practice-assignments/eligible-students", { page_size: 100 })).data;
    } catch (error) { showToast(mensajeDeError(error)); return; }
    if (!edicion && !elegibles.length) {
      openModal("Nueva asignación de práctica", `<div><p>No hay estudiantes activos sin práctica asignada en el periodo activo. Crea primero al estudiante en <strong>Gestión de Usuarios</strong> o revisa que el periodo académico esté activo.</p><div class="form-actions"><button class="btn btn-primary" type="button" data-close>Entendido</button></div></div>`);
      return;
    }
    if (!cat.instituciones.length) {
      openModal(edicion ? "Reasignar práctica" : "Nueva asignación de práctica", `<div><p>No hay instituciones activas con convenio vigente. Crea o habilita una en <strong>Gestión de Usuarios e Instituciones</strong>.</p><div class="form-actions"><button class="btn btn-primary" type="button" data-close>Entendido</button></div></div>`);
      return;
    }
    const institucionInicial = asignacion?.institucion.id && cat.instituciones.some((i) => i.id === asignacion.institucion.id) ? asignacion.institucion.id : cat.instituciones[0].id;
    const campoEstudiante = edicion
      ? `<label class="field"><span>Estudiante</span><input value="${escapar(asignacion.estudiante.nombre_completo)} · ${escapar(asignacion.estudiante.documento)}" disabled /></label>`
      : `<label class="field assignment-student-field"><span>Estudiante activo sin asignación</span><div class="student-combobox" data-student-combobox><input type="text" data-student-combobox-input placeholder="Buscar por nombre o cédula..." autocomplete="off" role="combobox" aria-expanded="false" /><input type="hidden" name="estudiante_id" /><div class="student-combobox-options" data-student-combobox-options role="listbox" hidden>${elegibles.map((s) => `<button type="button" role="option" data-opcion="${escapar(s.estudiante_id)}" data-busqueda="${escapar(`${s.nombres} ${s.apellidos} ${s.documento}`.toLowerCase())}"><span class="avatar">${escapar(initials(`${s.nombres} ${s.apellidos}`))}</span><span><strong>${escapar(`${s.nombres} ${s.apellidos}`)}</strong><small>${escapar(s.documento)} · ${s.semestre}° semestre</small></span></button>`).join("")}</div></div></label>`;
    const campoNivel = edicion
      ? `<label class="field"><span>Nivel de práctica</span><input value="${escapar(asignacion.nivel.nombre)}" disabled /></label>`
      : `<label class="field"><span>Nivel de práctica</span><select name="nivel_practica_id" required>${cat.niveles.map((n) => `<option value="${escapar(n.id)}">${escapar(n.nombre)}</option>`).join("")}</select><small>Se selecciona según el semestre del estudiante.</small></label>`;
    const modal = openModal(edicion ? `Reasignar práctica · ${escapar(asignacion.estudiante.nombre_completo)}` : "Nueva asignación de práctica", `<form id="assignment-form" novalidate>
      <div class="assignment-form-intro"><span>1</span><div><strong>${edicion ? "Actualiza la vinculación" : "Selecciona al estudiante y nivel"}</strong><small>Periodo académico activo</small></div></div>
      <div class="form-grid">${campoEstudiante}${campoNivel}</div>
      <div class="assignment-form-intro"><span>2</span><div><strong>Define la sede y los evaluadores</strong><small>Solo instituciones activas con convenio vigente y personas activas.</small></div></div>
      <div class="form-grid">
        <label class="field"><span>Institución / sede</span><select name="institucion_id" data-institucion required>${cat.instituciones.map((i) => `<option value="${escapar(i.id)}" ${i.id === institucionInicial ? "selected" : ""}>${escapar(i.nombre)} · ${escapar(i.ciudad)}</option>`).join("")}</select></label>
        <label class="field"><span>Docente supervisor UDI</span><select name="docente_supervisor_id"><option value="">Sin asignar por ahora</option>${cat.docentes.map((d) => `<option value="${escapar(d.id)}" ${asignacion?.docente?.id === d.id ? "selected" : ""}>${escapar(d.nombre_completo)}</option>`).join("")}</select></label>
        <label class="field"><span>Asesor de sitio</span><select name="asesor_sitio_id" data-asesor><option value="">Sin asignar por ahora</option></select><small>La lista depende de la institución seleccionada.</small></label>
        <label class="field"><span>Fecha de inicio (opcional)</span><input name="fecha_inicio" type="date" value="${escapar((asignacion?.fecha_inicio || "").slice(0, 10))}" /></label>
        <label class="field"><span>Fecha de fin (opcional)</span><input name="fecha_fin" type="date" value="${escapar((asignacion?.fecha_fin || "").slice(0, 10))}" /></label>
      </div>
      <p class="form-error" role="alert" data-form-error hidden></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">${edicion ? "Actualizar vinculación" : "Crear asignación"}</button></div></form>`);

    const formulario = modal.querySelector("form");
    const selInstitucion = formulario.querySelector("[data-institucion]");
    const selAsesor = formulario.querySelector("[data-asesor]");
        // Recarga la lista de asesores cada vez que cambia la institución.
    const cargarAsesores = async () => {
      selAsesor.disabled = true;
      selAsesor.innerHTML = `<option value="">Cargando…</option>`;
      try {
        const asesores = await asesoresDe(selInstitucion.value);
        selAsesor.innerHTML = `<option value="">Sin asignar por ahora</option>${asesores.map((a) => `<option value="${escapar(a.asesor_id)}" ${asignacion?.asesor?.id === a.asesor_id ? "selected" : ""}>${escapar(`${a.nombres} ${a.apellidos}`)}</option>`).join("")}`;
        if (!asesores.length) selAsesor.insertAdjacentHTML("beforeend", "");
      } catch (error) {
        selAsesor.innerHTML = `<option value="">No se pudo cargar</option>`;
        showToast(mensajeDeError(error));
      }
      selAsesor.disabled = false;
    };
    cargarAsesores();
    selInstitucion.addEventListener("change", cargarAsesores);

    // Selector de estudiante con búsqueda
    const caja = formulario.querySelector("[data-student-combobox]");
    if (caja) {
      const entrada = caja.querySelector("[data-student-combobox-input]");
      const oculto = caja.querySelector('[name="estudiante_id"]');
      const lista = caja.querySelector("[data-student-combobox-options]");
      const mostrar = () => { lista.hidden = false; entrada.setAttribute("aria-expanded", "true"); };
      const ocultar = () => { lista.hidden = true; entrada.setAttribute("aria-expanded", "false"); };
      entrada.addEventListener("focus", mostrar);
      entrada.addEventListener("input", () => {
        oculto.value = "";
        const q = entrada.value.toLowerCase();
        lista.querySelectorAll("[data-opcion]").forEach((o) => { o.hidden = !o.dataset.busqueda.includes(q); });
        mostrar();
      });
      lista.addEventListener("click", (e) => {
        const opcion = e.target.closest("[data-opcion]");
        if (!opcion) return;
        const estudiante = elegibles.find((s) => s.estudiante_id === opcion.dataset.opcion);
        entrada.value = `${estudiante.nombres} ${estudiante.apellidos} · ${estudiante.documento}`;
        oculto.value = estudiante.estudiante_id;
        if (estudiante.nivel_sugerido_id) {
          const sel = formulario.querySelector('[name="nivel_practica_id"]');
          if (sel) sel.value = estudiante.nivel_sugerido_id;
        }
        ocultar();
      });
      modal.addEventListener("click", (e) => { if (!e.target.closest("[data-student-combobox]")) ocultar(); });
    }

        // Envío: crea (POST) o reasigna (PATCH) y refresca la tabla.
    formulario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = formulario.querySelector("[data-form-error]");
      error.hidden = true;
      const f = new FormData(formulario);
      if (!edicion && !f.get("estudiante_id")) {
        error.textContent = "Selecciona un estudiante de la lista de coincidencias.";
        error.hidden = false;
        return;
      }
      const comunes = {
        institucion_id: f.get("institucion_id"),
        docente_supervisor_id: f.get("docente_supervisor_id") || null,
        asesor_sitio_id: f.get("asesor_sitio_id") || null,
        fecha_inicio: f.get("fecha_inicio") || null,
        fecha_fin: f.get("fecha_fin") || null,
      };
      const boton = formulario.querySelector("[type=submit]");
      boton.disabled = true;
      try {
        if (edicion) await api.patch(`/practice-assignments/${asignacion.id}`, comunes);
        else await api.post("/practice-assignments", { ...comunes, estudiante_id: f.get("estudiante_id"), nivel_practica_id: f.get("nivel_practica_id") });
        modal.remove();
        showToast(edicion ? "Vinculación actualizada correctamente" : "Asignación creada correctamente");
        if (!edicion) estado.pagina = 1;
        cargar();
      } catch (fallo) {
        error.textContent = mensajeDeError(fallo);
        error.hidden = false;
        boton.disabled = false;
      }
    });
  }

  // ---------- Cancelación ----------
    /** Pide el motivo y cancela la asignación; si la práctica ya está en curso el servidor pide confirmar. */
  function cancelar(asignacion, confirmar = false, motivoPrevio = "") {
    const modal = openModal(`Cancelar práctica · ${escapar(asignacion.estudiante.nombre_completo)}`, `<form id="cancel-form" novalidate><p class="muted">Se cancelará la asignación de ${escapar(asignacion.nivel.nombre)} en ${escapar(asignacion.institucion.nombre)}. El estudiante quedará libre para recibir una nueva.</p><label class="field"><span>Motivo (obligatorio)</span><textarea name="motivo" rows="3" required>${escapar(motivoPrevio)}</textarea></label><p class="form-error" role="alert" data-form-error hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Volver</button><button class="btn btn-danger" type="submit">Cancelar asignación</button></div></form>`);
    const formulario = modal.querySelector("form");
    formulario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = formulario.querySelector("[data-form-error]");
      const motivo = formulario.motivo.value.trim();
      const boton = formulario.querySelector("[type=submit]");
      boton.disabled = true;
      try {
        await api.patch(`/practice-assignments/${asignacion.id}/status`, { estado: "CANCELADA", motivo, ...(confirmar ? { confirmar: true } : {}) });
        modal.remove();
        showToast("Asignación cancelada");
        cargar();
      } catch (fallo) {
        if (fallo.code === "CONFIRMATION_REQUIRED") {
          modal.remove();
          const aviso = openModal("Confirmar cancelación", `<div><p>${escapar(fallo.message)}</p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Volver</button><button class="btn btn-danger" type="button" data-confirmar>Cancelar de todas formas</button></div></div>`);
          aviso.querySelector("[data-confirmar]").addEventListener("click", () => { aviso.remove(); cancelarConfirmada(asignacion, motivo); });
          return;
        }
        error.textContent = mensajeDeError(fallo);
        error.hidden = false;
        boton.disabled = false;
      }
    });
  }
    /** Repite la cancelación con confirmación explícita. */
  async function cancelarConfirmada(asignacion, motivo) {
    try {
      await api.patch(`/practice-assignments/${asignacion.id}/status`, { estado: "CANCELADA", motivo, confirmar: true });
      showToast("Asignación cancelada");
      cargar();
    } catch (error) { showToast(mensajeDeError(error)); }
  }

  // ---------- Eventos ----------
    // Un solo escuchador de clics (delegación) para paginación, reintentar, reasignar, cancelar y nueva asignación.
  document.addEventListener("click", (e) => {
    const pagina = e.target.closest("[data-a-page]");
    if (pagina && !pagina.disabled) { estado.pagina = Number(pagina.dataset.aPage); cargar(); return; }
    if (e.target.closest("[data-a-retry]")) { cargar(); return; }
    const reasignar = e.target.closest("[data-a-reassign]");
    if (reasignar) { const a = estado.filas.get(reasignar.dataset.aReassign); if (a) abrir(a); return; }
    const cancelarBtn = e.target.closest("[data-a-cancel]");
    if (cancelarBtn) { const a = estado.filas.get(cancelarBtn.dataset.aCancel); if (a) cancelar(a); return; }
    if (e.target.closest("[data-assign]")) abrir(null);
  });

  // ---------- Inicio: periodos y primera carga ----------
  (async () => {
    const selector = document.querySelector("#assignment-period-filter");
    try {
      estado.periodos = (await api.get("/periods")).data;
    } catch (error) {
      showToast(mensajeDeError(error));
    }
    const activo = estado.periodos.find((p) => p.es_activo) || estado.periodos[0];
    estado.periodoId = activo?.id ?? "";
    if (selector) {
      selector.innerHTML = estado.periodos.length
        ? estado.periodos.map((p) => `<option value="${escapar(p.id)}" ${p.id === estado.periodoId ? "selected" : ""}>${escapar(p.codigo)}${p.es_activo ? " (activo)" : ""}</option>`).join("")
        : "<option value=\"\">Sin periodos</option>";
    }
    cargar();
  })();
}

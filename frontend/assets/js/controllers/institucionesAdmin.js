/**
 * Pestaña "Instituciones" de Gestión de Usuarios e Instituciones (Director) conectada al API real.
 */
import { api } from "../services/api.js";

// Filas por página.
const TAMANO_PAGINA = 10;
// Estado del convenio: [texto, color de la insignia].
const CONVENIOS = {
  VIGENTE: ["Vigente", "success"],
  EN_TRAMITE: ["En trámite", "warning"],
  SUSPENDIDO: ["Suspendido", "danger"],
  VENCIDO: ["Vencido", "neutral"],
};

// Une el mensaje del error con los detalles de validación del servidor.
const mensajeDeError = (error) => {
  const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => `${d.campo ? `${d.campo}: ` : ""}${d.mensaje}`) : [];
  return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
};

// HTML de un campo de texto del formulario.
const campo = (escapar, etiqueta, nombre, valor = "", extra = "") => `<label class="field"><span>${etiqueta}</span><input name="${nombre}" value="${escapar(valor)}" ${extra} /></label>`;
// HTML del formulario de institución (alta y edición).
const formulario = (escapar, i = {}) => `<form id="institution-form" novalidate><div class="form-grid">
  ${campo(escapar, "Nombre de la institución", "nombre", i.nombre, "required")}
  ${campo(escapar, "NIT", "nit", i.nit, 'required placeholder="900123456-7"')}
  ${campo(escapar, "Ciudad", "ciudad", i.ciudad, "required")}
  ${campo(escapar, "Dirección (opcional)", "direccion", i.direccion || "")}
  ${campo(escapar, "Correo institucional", "correo", i.correo, 'type="email" required placeholder="contacto@institucion.edu.co"')}
  ${campo(escapar, "Teléfono (opcional)", "telefono", i.telefono || "", 'type="tel" placeholder="607 000 0000"')}
  <label class="field"><span>Estado del convenio</span><select name="estado_convenio">${Object.entries(CONVENIOS).map(([valor, [texto]]) => `<option value="${valor}" ${(i.estado_convenio || "EN_TRAMITE") === valor ? "selected" : ""}>${texto}</option>`).join("")}</select></label>
  ${campo(escapar, "Inicio del convenio (opcional)", "convenio_inicio", (i.convenio_inicio || "").slice(0, 10), 'type="date"')}
  ${campo(escapar, "Fin del convenio (opcional)", "convenio_fin", (i.convenio_fin || "").slice(0, 10), 'type="date"')}
</div><p class="form-error" role="alert" data-form-error hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar registro</button></div></form>`;

/**
 * Abre la ventana para registrar o editar una institución (también la usa el perfil de la institución).
 * @param {object} institucion Institución a editar; si no se pasa, se registra una nueva.
 * @param {Function} alTerminar Se ejecuta tras guardar para refrescar la pantalla.
 */
export function abrirFormularioInstitucion(ui, institucion, alTerminar) {
  const { escapar, openModal, showToast } = ui;
  const edicion = Boolean(institucion);
  const modal = openModal(edicion ? `Editar ${escapar(institucion?.nombre)}` : "Registrar nueva institución", formulario(escapar, institucion || {}));
  const form = modal.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = form.querySelector("[data-form-error]");
    error.hidden = true;
    const f = new FormData(form);
    const valores = {};
    for (const nombre of ["nombre", "nit", "ciudad", "direccion", "correo", "telefono", "estado_convenio", "convenio_inicio", "convenio_fin"]) valores[nombre] = (f.get(nombre) || "").trim();
    let cuerpoPeticion = valores;
    if (edicion) {
      cuerpoPeticion = {};
      for (const [nombre, nuevo] of Object.entries(valores)) {
        const actual = (nombre.startsWith("convenio_") && nombre !== "estado_convenio" ? (institucion[nombre] || "").slice(0, 10) : institucion[nombre] || "");
        if (nuevo !== actual) cuerpoPeticion[nombre] = nuevo;
      }
      if (!Object.keys(cuerpoPeticion).length) { modal.remove(); return; }
    }
    const boton = form.querySelector("[type=submit]");
    boton.disabled = true;
    try {
      if (edicion) await api.patch(`/institutions/${institucion.id}`, cuerpoPeticion);
      else await api.post("/institutions", cuerpoPeticion);
      modal.remove();
      showToast(edicion ? "Institución actualizada correctamente" : "Institución registrada correctamente");
      alTerminar();
    } catch (fallo) {
      error.textContent = mensajeDeError(fallo);
      error.hidden = false;
      boton.disabled = false;
    }
  });
}

/**
 * Habilita o deshabilita una institución; si tiene prácticas en curso el servidor pide confirmación.
 */
export async function cambiarEstadoInstitucion(ui, institucion, alTerminar, confirmar = false) {
  const { escapar, openModal, showToast } = ui;
  const activa = !institucion.activa;
  try {
    await api.patch(`/institutions/${institucion.id}/status`, confirmar ? { activa, confirmar: true } : { activa });
    showToast(activa ? "Institución habilitada" : "Institución deshabilitada");
    alTerminar();
  } catch (error) {
    if (error.code === "CONFIRMATION_REQUIRED") {
      const modal = openModal("Confirmar cambio", `<div><p>${escapar(error.message)}</p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-danger" type="button" data-confirmar>Deshabilitar de todas formas</button></div></div>`);
      modal.querySelector("[data-confirmar]").addEventListener("click", () => { modal.remove(); cambiarEstadoInstitucion(ui, institucion, alTerminar, true); });
    } else {
      showToast(mensajeDeError(error));
    }
  }
}


/**
 * Conecta la pestaña "Instituciones" (tabla, filtros, paginación y acciones) con la API.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarInstituciones(ui) {
  const { badge, escapar, icon, openModal, pathFor, showToast } = ui;
  const cuerpo = document.querySelector("#institutions-table-body");
  if (!cuerpo) return;
    // Estado local: página, filtros, filas por id y `turno` para descartar respuestas viejas.
  const estado = { pagina: 1, q: "", convenio: "", activa: "", filas: new Map(), turno: 0 };

  const resumen = () => document.querySelector("[data-institution-pagination-summary]");
  const botonesPagina = () => document.querySelector("[data-institution-pagination-buttons]");

    /** Pide las instituciones con los filtros actuales y las dibuja. */
  async function cargar() {
    const turno = ++estado.turno;
    cuerpo.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">Cargando instituciones…</td></tr>`;
    try {
      const consulta = { page: estado.pagina, page_size: TAMANO_PAGINA };
      if (estado.q) consulta.q = estado.q;
      if (estado.convenio) consulta.estado_convenio = estado.convenio;
      if (estado.activa) consulta.activa = estado.activa;
      const { data, meta } = await api.get("/institutions", consulta);
      if (turno !== estado.turno) return;
      estado.filas = new Map(data.map((i) => [i.id, i]));
      pintar(data, meta);
    } catch (error) {
      if (turno !== estado.turno) return;
      cuerpo.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px"><p class="form-error" role="alert">${escapar(mensajeDeError(error))}</p><button class="btn btn-secondary" type="button" data-i-retry>Reintentar</button></td></tr>`;
      resumen().textContent = "";
      botonesPagina().innerHTML = "";
    }
  }

    /** Dibuja las filas de la tabla y los botones de paginación. */
  function pintar(filas, meta) {
    if (!filas.length) {
      cuerpo.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No hay instituciones registradas con esos filtros. Usa «+ Nueva institución» para crear la primera.</td></tr>`;
    } else {
      cuerpo.innerHTML = filas.map((i) => {
        const [textoConvenio, tonoConvenio] = CONVENIOS[i.estado_convenio] || [i.estado_convenio, "neutral"];
        const asesores = i.asesores_vinculados === 1 ? "1 asesor vinculado" : `${i.asesores_vinculados ?? 0} asesores vinculados`;
        return `<tr data-i-row="${escapar(i.id)}"><td>${escapar(i.nit)}</td><td><div class="person"><span class="stat-icon blue">${icon("building")}</span><span><a class="profile-link" href="${pathFor("director", "institucion")}?id=${escapar(i.id)}">${escapar(i.nombre)}</a><small>${escapar(i.correo)}</small></span></div></td><td><strong>${escapar(i.ciudad)}</strong><small>${asesores}</small></td><td>${badge(textoConvenio, tonoConvenio)}</td><td><strong>${i.practicas_activas ?? 0}</strong></td><td>${badge(i.activa ? "Activa" : "Inactiva", i.activa ? "success" : "neutral")}</td><td><div class="row-actions"><a class="btn btn-secondary" href="${pathFor("director", "institucion")}?id=${escapar(i.id)}">Ver perfil</a><button class="btn btn-secondary" type="button" data-i-edit="${escapar(i.id)}">Editar</button><button class="btn ${i.activa ? "btn-danger" : "btn-secondary"}" type="button" data-i-status="${escapar(i.id)}">${i.activa ? "Deshabilitar" : "Habilitar"}</button></div></td></tr>`;
      }).join("");
    }
    const desde = (meta.page - 1) * meta.page_size + 1;
    resumen().textContent = meta.total ? `${desde} - ${desde + filas.length - 1} de ${meta.total} instituciones` : "0 instituciones encontradas";
    const botones = [`<button type="button" data-i-page="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>`];
    for (let n = 1; n <= meta.total_pages; n++) botones.push(`<button type="button" class="${n === meta.page ? "active" : ""}" data-i-page="${n}">${n}</button>`);
    botones.push(`<button type="button" data-i-page="${meta.page + 1}" ${meta.page >= meta.total_pages ? "disabled" : ""} aria-label="Página siguiente">›</button>`);
    botonesPagina().innerHTML = botones.join("");
  }

  // ---------- Filtros ----------
  let temporizador;
  document.querySelector("[data-site-search]")?.addEventListener("input", (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { estado.q = e.target.value.trim(); estado.pagina = 1; cargar(); }, 300);
  });
  document.querySelector("#institution-agreement-filter")?.addEventListener("change", (e) => { estado.convenio = e.target.value === "all" ? "" : e.target.value; estado.pagina = 1; cargar(); });
  document.querySelector("#institution-status-filter")?.addEventListener("change", (e) => { estado.activa = e.target.value === "all" ? "" : e.target.value; estado.pagina = 1; cargar(); });

    // Atajos que abren el formulario y cambian el estado de una institución.
  const abrir = (institucion) => abrirFormularioInstitucion(ui, institucion, () => { if (!institucion) estado.pagina = 1; cargar(); });
  const cambiarEstado = (institucion) => cambiarEstadoInstitucion(ui, institucion, cargar);

  // ---------- Eventos ----------
    // Clics (delegación): nuevo, editar, habilitar/deshabilitar, paginación y reintentar.
  document.addEventListener("click", (e) => {
    const pagina = e.target.closest("[data-i-page]");
    if (pagina && !pagina.disabled) { estado.pagina = Number(pagina.dataset.iPage); cargar(); return; }
    if (e.target.closest("[data-i-retry]")) { cargar(); return; }
    const editar = e.target.closest("[data-i-edit]");
    if (editar) { const i = estado.filas.get(editar.dataset.iEdit); if (i) abrir(i); return; }
    const cambiar = e.target.closest("[data-i-status]");
    if (cambiar) { const i = estado.filas.get(cambiar.dataset.iStatus); if (i) cambiarEstado(i); return; }
    const nuevo = e.target.closest("[data-new]");
    if (nuevo && nuevo.textContent.includes("institución")) abrir(null);
    const pestana = e.target.closest('[data-tab="sites"]');
    if (pestana) cargar();
  });

  cargar();
}

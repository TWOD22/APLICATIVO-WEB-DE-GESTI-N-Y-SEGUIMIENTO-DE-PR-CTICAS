/**
 * Perfil de una institución (Director) conectado al API real: datos, convenio y personas vinculadas
 * (estudiantes y asesores) del periodo académico elegido.
 */
import { api } from "../services/api.js";
import { abrirFormularioInstitucion, cambiarEstadoInstitucion } from "./institucionesAdmin.js";

// Estado del convenio: [texto, color de la insignia].
const CONVENIOS = { VIGENTE: ["Vigente", "success"], EN_TRAMITE: ["En trámite", "warning"], SUSPENDIDO: ["Suspendido", "danger"], VENCIDO: ["Vencido", "neutral"] };
// Texto y color del estado de la práctica.
const ESTADO_PRACTICA = {
  PENDIENTE_DOCUMENTOS: ["Documentación pendiente", "warning"], ACTIVA: ["En desarrollo", "success"], PENDIENTE_EVALUACION: ["En evaluación", "info"],
  FINALIZADA: ["Finalizada", "success"], CANCELADA: ["Cancelada", "neutral"],
};
// Fecha corta en español.
const fecha = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
};
// Une el mensaje del error con los detalles de validación del servidor.
const mensajeDeError = (error) => {
  const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => d.mensaje) : [];
  return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
};

/**
 * Conecta el perfil de una institución con la API (el id viene en la dirección de la página).
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarPerfilInstitucion(ui) {
  const { badge, escapar, icon, initials, pathFor } = ui;
  const pagina = document.querySelector(".page");
  const id = new URLSearchParams(window.location.search).get("id");
    // Estado local: institución, periodos, pestaña activa y personas vinculadas (estudiantes y asesores).
  const estado = { institucion: null, periodos: [], periodoId: null, pestana: "students", personas: { students: null, advisors: null }, turno: 0 };

  const volver = `<a class="btn btn-ghost" href="${pathFor("director", "usuarios")}">Volver a instituciones</a>`;
  const errorHtml = (mensaje) => `<div style="padding:32px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" data-ip-retry>Reintentar</button> ${volver}</div>`;

  // ───────────── Carga ─────────────
  async function cargar() {
    pagina.innerHTML = `<p class="muted" style="padding:32px;text-align:center">Cargando institución…</p>`;
    if (!id) {
      pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Administración</span><h2>Selecciona una institución</h2><p>Abre un perfil desde Gestión de instituciones.</p></div></header>${volver}`;
      return;
    }
    try {
      const [{ data: institucion }, { data: periodos }] = await Promise.all([api.get(`/institutions/${id}`), api.get("/periods")]);
      estado.institucion = institucion;
      estado.periodos = periodos;
      estado.periodoId ??= (periodos.find((p) => p.es_activo) ?? periodos[0])?.id ?? null;
      pintar();
      await cargarPersonas();
    } catch (error) {
      pagina.innerHTML = errorHtml(error?.code === "INSTITUTION_NOT_FOUND" ? "La institución no existe." : mensajeDeError(error));
    }
  }

    /** Trae estudiantes y asesores del periodo elegido (si uno falla, el otro se muestra igual). */
  async function cargarPersonas() {
    const turno = ++estado.turno;
    estado.personas = { students: null, advisors: null };
    pintarPersonas();
    const consulta = estado.periodoId ? { periodo_id: estado.periodoId } : {};
    const [estudiantes, asesores] = await Promise.allSettled([api.get(`/institutions/${id}/students`, consulta), api.get(`/institutions/${id}/advisors`, consulta)]);
    if (turno !== estado.turno) return;
    estado.personas = { students: estudiantes, advisors: asesores };
    pintarPersonas();
  }

  // ───────────── Pintado ─────────────
    /** Tabla de estudiantes con práctica en la institución. */
  function tablaEstudiantes(r) {
    if (!r) return `<p class="muted" style="padding:24px;text-align:center">Cargando estudiantes…</p>`;
    if (r.status === "rejected") return `<p class="form-error" style="padding:16px 20px">${escapar(mensajeDeError(r.reason))}</p>`;
    const filas = r.value.data;
    if (!filas.length) return `<div class="empty-state" style="padding:24px"><strong>Sin estudiantes en este periodo</strong><p>Ningún estudiante tiene una práctica asignada en esta institución durante el periodo elegido.</p></div>`;
    return `<div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>Práctica / periodo</th><th>Semestre</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${filas.map((e) => {
      const nombre = `${e.nombres} ${e.apellidos}`;
      const [texto, tono] = ESTADO_PRACTICA[e.estado_asignacion] || [e.estado_asignacion, "info"];
      return `<tr><td><div class="person"><span class="avatar">${escapar(initials(nombre))}</span><span><a class="profile-link" href="${pathFor("director", "perfil")}?id=${escapar(e.estudiante_id)}">${escapar(nombre)}</a><small>${escapar(e.documento)}</small></span></div></td><td><strong>${escapar(e.nivel_nombre)}</strong><small>${escapar(e.periodo_codigo)}</small></td><td>${e.semestre ? `${escapar(e.semestre)}°` : "—"}</td><td>${badge(texto, tono)}</td><td><a class="btn btn-secondary" href="${pathFor("director", "practica")}?id=${escapar(e.asignacion_id)}">Ver práctica</a></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

    /** Tabla de asesores de sitio de la institución. */
  function tablaAsesores(r) {
    if (!r) return `<p class="muted" style="padding:24px;text-align:center">Cargando asesores…</p>`;
    if (r.status === "rejected") return `<p class="form-error" style="padding:16px 20px">${escapar(mensajeDeError(r.reason))}</p>`;
    const filas = r.value.data;
    if (!filas.length) return `<div class="empty-state" style="padding:24px"><strong>Sin asesores en este periodo</strong><p>No hay asesores de sitio vinculados a esta institución durante el periodo elegido.</p></div>`;
    return `<div class="table-wrap"><table><thead><tr><th>Asesor de sitio</th><th>Cargo</th><th>Vigencia</th><th>Estudiantes</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${filas.map((a) => {
      const nombre = `${a.nombres} ${a.apellidos}`;
      const vigente = a.activa && a.estado === "ACTIVO";
      return `<tr><td><div class="person"><span class="avatar">${escapar(initials(nombre))}</span><span><a class="profile-link" href="${pathFor("director", "perfil")}?id=${escapar(a.asesor_id)}">${escapar(nombre)}</a><small>${escapar(a.correo)}</small></span></div></td><td>${escapar(a.cargo || "—")}<small>${escapar(a.periodo_codigo)}</small></td><td>${escapar(fecha(a.vigente_desde))}${a.vigente_hasta ? ` – ${escapar(fecha(a.vigente_hasta))}` : " – vigente"}</td><td><strong>${escapar(a.estudiantes_asignados)}</strong></td><td>${badge(vigente ? "Activo" : "Inactivo", vigente ? "success" : "neutral")}</td><td><a class="btn btn-secondary" href="${pathFor("director", "perfil")}?id=${escapar(a.asesor_id)}">Ver asesor</a></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

    // Cantidad para la etiqueta de cada pestaña (– si la consulta falló).
  const contar = (r) => (r?.status === "fulfilled" ? r.value.data.length : "–");

    /** Dibuja la pestaña activa con su tabla. */
  function pintarPersonas() {
    const zona = pagina.querySelector("[data-ip-personas]");
    if (!zona) return;
    const { students, advisors } = estado.personas;
    pagina.querySelector('[data-ip-tab="students"] span').textContent = contar(students);
    pagina.querySelector('[data-ip-tab="advisors"] span').textContent = contar(advisors);
    zona.querySelector('[data-ip-panel="students"]').innerHTML = tablaEstudiantes(students);
    zona.querySelector('[data-ip-panel="advisors"]').innerHTML = tablaAsesores(advisors);
  }

    /** Dibuja el perfil completo: datos, convenio y pestañas. */
  function pintar() {
    const i = estado.institucion;
    const [textoConvenio, tonoConvenio] = CONVENIOS[i.estado_convenio] || [i.estado_convenio, "neutral"];
    const periodos = estado.periodos.map((p) => `<option value="${escapar(p.id)}" ${p.id === estado.periodoId ? "selected" : ""}>${escapar(p.codigo)}${p.es_activo ? " (activo)" : ""}</option>`).join("");
    const vigencia = i.convenio_inicio || i.convenio_fin ? `${escapar(fecha(i.convenio_inicio) || "—")} – ${escapar(fecha(i.convenio_fin) || "sin fecha de fin")}` : "Sin fechas registradas";
    pagina.innerHTML = `<nav class="breadcrumbs"><a href="${pathFor("director", "usuarios")}">Gestión de instituciones</a><span>/</span><strong>${escapar(i.nombre)}</strong></nav>
      <header class="profile-hero"><div class="person"><span class="stat-icon blue">${icon("building")}</span><div><span class="eyebrow">Institución aliada</span><h2>${escapar(i.nombre)}</h2><p>${escapar(i.ciudad)} · NIT ${escapar(i.nit)}</p></div></div><div class="profile-hero-actions">${badge(i.activa ? "Activa" : "Inactiva", i.activa ? "success" : "neutral")}${badge(textoConvenio, tonoConvenio)}<button class="btn btn-secondary" type="button" data-ip-editar>Editar institución</button><button class="btn ${i.activa ? "btn-danger" : "btn-primary"}" type="button" data-ip-estado>${i.activa ? "Deshabilitar" : "Habilitar"}</button></div></header>
      <section class="panel"><header class="panel-heading"><div><h3>Información institucional</h3><p>Datos de identificación, contacto y estado del convenio</p></div></header><dl class="detail-list detail-list-grid"><div><dt>NIT</dt><dd>${escapar(i.nit)}</dd></div><div><dt>Dirección</dt><dd>${escapar(i.direccion || "No registrada")}</dd></div><div><dt>Ciudad</dt><dd>${escapar(i.ciudad)}</dd></div><div><dt>Correo de contacto</dt><dd>${escapar(i.correo)}</dd></div><div><dt>Teléfono</dt><dd>${escapar(i.telefono || "No registrado")}</dd></div><div><dt>Convenio</dt><dd>${badge(textoConvenio, tonoConvenio)}</dd></div><div><dt>Vigencia del convenio</dt><dd>${vigencia}</dd></div><div><dt>Prácticas en curso</dt><dd>${escapar(i.practicas_activas ?? 0)}</dd></div></dl></section>
      <section class="panel profile-section linked-people-panel"><header class="panel-heading"><div><h3>Personas vinculadas</h3><p>Estudiantes y asesores de esta institución en el periodo elegido.</p></div><label class="field" style="min-width:180px"><span class="sr-only">Periodo académico</span><select data-ip-periodo aria-label="Periodo académico">${periodos}</select></label></header>
        <div class="tabs profile-tabs" role="tablist"><button class="${estado.pestana === "students" ? "active" : ""}" type="button" role="tab" data-ip-tab="students">Estudiantes vinculados <span>–</span></button><button class="${estado.pestana === "advisors" ? "active" : ""}" type="button" role="tab" data-ip-tab="advisors">Asesores vinculados <span>–</span></button></div>
        <div data-ip-personas><div data-ip-panel="students" role="tabpanel" ${estado.pestana === "students" ? "" : "hidden"}></div><div data-ip-panel="advisors" role="tabpanel" ${estado.pestana === "advisors" ? "" : "hidden"}></div></div></section>`;
    pintarPersonas();
  }

  // ───────────── Eventos ─────────────
  pagina.addEventListener("change", (e) => {
    if (e.target.matches("[data-ip-periodo]")) { estado.periodoId = e.target.value; cargarPersonas(); }
  });
  pagina.addEventListener("click", (e) => {
    if (e.target.closest("[data-ip-retry]")) { cargar(); return; }
    const pestana = e.target.closest("[data-ip-tab]");
    if (pestana) {
      estado.pestana = pestana.dataset.ipTab;
      pagina.querySelectorAll("[data-ip-tab]").forEach((t) => t.classList.toggle("active", t === pestana));
      pagina.querySelectorAll("[data-ip-panel]").forEach((p) => { p.hidden = p.dataset.ipPanel !== estado.pestana; });
      return;
    }
    if (e.target.closest("[data-ip-editar]")) abrirFormularioInstitucion(ui, estado.institucion, async () => { try { estado.institucion = (await api.get(`/institutions/${id}`)).data; pintar(); } catch { cargar(); } });
    if (e.target.closest("[data-ip-estado]")) cambiarEstadoInstitucion(ui, estado.institucion, async () => { try { estado.institucion = (await api.get(`/institutions/${id}`)).data; pintar(); } catch { cargar(); } });
  });

  cargar();
}

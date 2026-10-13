/**
 * Vistas del Director conectadas al API real:
 *  - montarPerfilUsuario: perfil de un usuario (estudiante, docente o asesor) con su historial de prácticas.
 *  - montarPracticaDirector: detalle de una práctica (expediente, bitácora y evaluaciones independientes) con las
 *    acciones de Dirección: devolver la bitácora, reabrir una evaluación y finalizar la práctica.
 */
import { api } from "../services/api.js";
import { abrirEdicionUsuario, cambiarEstadoUsuario } from "./usuariosAdmin.js";

// Textos y colores de roles, estados de usuario, práctica, bitácora y documentos.
const NOMBRE_ROL = { ESTUDIANTE: "Estudiante", DOCENTE_SUPERVISOR: "Docente supervisor", ASESOR_SITIO: "Asesor de sitio", DIRECTOR_PROGRAMA: "Director de programa" };
const ESTADO_USUARIO = { ACTIVO: ["Activo", "success"], INACTIVO: ["Inactivo", "neutral"], SUSPENDIDO: ["Suspendido", "warning"] };
const ESTADO_PRACTICA = {
  PENDIENTE_DOCUMENTOS: ["Documentación pendiente", "warning"], ACTIVA: ["En desarrollo", "success"], PENDIENTE_EVALUACION: ["En evaluación", "info"],
  FINALIZADA: ["Finalizada", "success"], CANCELADA: ["Cancelada", "neutral"],
};
const ESTADO_BITACORA = {
  BLOQUEADA: ["No habilitada", "neutral"], BORRADOR: ["En borrador", "warning"], DEVUELTA: ["Devuelta", "danger"],
  ENVIADA: ["Entregada", "info"], EN_EVALUACION: ["En evaluación", "info"], EVALUADA: ["Evaluada", "success"],
};
const ESTADO_DOCUMENTO = { APROBADO: ["Aprobado", "success"], EN_REVISION: ["En revisión", "info"], POR_CORREGIR: ["Por corregir", "danger"], SIN_CARGAR: ["Sin cargar", "neutral"] };
const TIPO_PREGUNTA = { ABIERTA: "Respuesta abierta", CERRADA_UNICA: "Selección única", CERRADA_MULTIPLE: "Selección múltiple" };
// Tipos de evaluación: [código, rótulo, rol evaluador].
const TIPOS_EVALUACION = [["DOCENTE_SUPERVISOR", "Nota docente", "docente"], ["ASESOR_SITIO", "Nota asesor", "asesor"]];

// Formato de fechas y plurales.
const fecha = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "";
};
const fechaHora = (valor) => {
  const d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
};
const nota2 = (n) => Number(n).toFixed(2);
const pluralizar = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
// Une el mensaje del error con los detalles de validación del servidor.
const mensajeDeError = (error) => {
  const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => d.mensaje) : [];
  return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
};

// ═════════════════════════ Perfil de usuario ═════════════════════════

/**
 * Perfil de un usuario (estudiante, docente o asesor) con su historial de prácticas.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarPerfilUsuario(ui) {
  const { badge, escapar, icon, initials, pathFor } = ui;
  const pagina = document.querySelector(".page");
  const id = new URLSearchParams(window.location.search).get("id");
  const errorHtml = (mensaje) => `<div style="padding:32px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" data-pf-retry>Reintentar</button> <a class="btn btn-ghost" href="${pathFor("director", "usuarios")}">Volver a usuarios</a></div>`;

    /** Trae el usuario y sus prácticas (cada consulta se resuelve por separado para mostrar lo que sí cargó). */
  async function cargar() {
    pagina.innerHTML = `<p class="muted" style="padding:32px;text-align:center">Cargando perfil…</p>`;
    if (!id) {
      pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Administración</span><h2>Selecciona un usuario</h2><p>Abre un perfil desde Gestión de usuarios.</p></div></header><a class="btn btn-primary" href="${pathFor("director", "usuarios")}">Ir a Gestión de usuarios</a>`;
      return;
    }
    try {
      const { data: usuario } = await api.get(`/users/${id}`);
      const codigos = usuario.roles.map((r) => r.codigo);
      const [historial, comoDocente, comoAsesor] = await Promise.allSettled([
        codigos.includes("ESTUDIANTE") ? api.get(`/users/${id}/practices`) : Promise.resolve(null),
        codigos.includes("DOCENTE_SUPERVISOR") ? api.get("/practice-assignments", { docente_id: id, todos_los_periodos: true, page_size: 100 }) : Promise.resolve(null),
        codigos.includes("ASESOR_SITIO") ? api.get("/practice-assignments", { asesor_id: id, todos_los_periodos: true, page_size: 100 }) : Promise.resolve(null),
      ]);
      pintar(usuario, { historial, comoDocente, comoAsesor });
    } catch (error) {
      pagina.innerHTML = errorHtml(mensajeDeError(error));
    }
  }

    // HTML de una sección que no pudo cargarse.
  const seccionError = (titulo, resultado) => `<section class="panel profile-section"><header class="panel-heading"><div><h3>${titulo}</h3></div></header><p class="form-error" style="padding:16px 20px">${escapar(resultado.reason?.message || "No se pudo cargar esta información.")}</p></section>`;

    /** Tabla de prácticas de un estudiante. */
  function tablaHistorial(filas) {
    if (!filas.length) return `<div class="empty-state" style="padding:24px">Este estudiante aún no tiene prácticas asignadas.</div>`;
    return `<div class="table-wrap"><table><thead><tr><th>Práctica / periodo</th><th>Institución y evaluadores</th><th>Estado de la práctica</th><th>Notas</th><th>Acciones</th></tr></thead><tbody>${filas.map((p) => {
      const [textoE, tonoE] = ESTADO_PRACTICA[p.estado] || [p.estado, "info"];
      const [textoB] = p.bitacora_estado ? ESTADO_BITACORA[p.bitacora_estado] || [p.bitacora_estado] : ["Sin iniciar"];
      const notas = p.nota_docente != null || p.nota_asesor != null
        ? `<strong>Docente: ${p.nota_docente != null ? nota2(p.nota_docente) : "Pendiente"}</strong><small>Asesor: ${p.nota_asesor != null ? nota2(p.nota_asesor) : "Pendiente"}</small>`
        : badge("Sin calificar", "neutral");
      return `<tr><td><strong>${escapar(p.nivel_nombre)}</strong><small>${escapar(p.periodo_codigo)}</small></td><td><strong>${escapar(p.institucion_nombre)}</strong><small>Docente: ${escapar(p.docente_nombre || "Sin asignar")}</small><small>Asesor: ${escapar(p.asesor_nombre || "Sin asignar")}</small></td><td>${badge(textoE, tonoE)}<small>Bitácora: ${escapar(textoB)}</small></td><td>${notas}</td><td><div class="history-actions"><a class="btn btn-secondary" href="${pathFor("director", "practica")}?id=${escapar(p.asignacion_id)}">Ver práctica</a></div></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

    /** Tabla de estudiantes a cargo de un docente o asesor. */
  function tablaEstudiantes(filas, contraparte) {
    if (!filas.length) return `<div class="empty-state" style="padding:24px">No tiene estudiantes asignados.</div>`;
    return `<div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>Práctica / periodo</th><th>Institución</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${filas.map((a) => {
      const [textoE, tonoE] = ESTADO_PRACTICA[a.estado] || [a.estado, "info"];
      return `<tr><td><div class="person"><span class="avatar">${escapar(initials(a.estudiante.nombre_completo))}</span><span><a class="profile-link" href="${pathFor("director", "perfil")}?id=${escapar(a.estudiante.id)}">${escapar(a.estudiante.nombre_completo)}</a><small>${escapar(a.estudiante.documento)}</small></span></div></td><td><strong>${escapar(a.nivel.nombre)}</strong><small>${escapar(a.periodo.codigo)}</small></td><td><strong>${escapar(a.institucion.nombre)}</strong><small>${escapar(contraparte(a))}</small></td><td>${badge(textoE, tonoE)}</td><td><a class="btn btn-secondary" href="${pathFor("director", "practica")}?id=${escapar(a.id)}">Ver práctica</a></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

    /** Dibuja el perfil según el rol de la persona. */
  function pintar(usuario, { historial, comoDocente, comoAsesor }) {
    const codigos = usuario.roles.map((r) => r.codigo);
    const [textoEstado, tonoEstado] = ESTADO_USUARIO[usuario.estado] || [usuario.estado, "neutral"];
    const rotuloRoles = usuario.roles.map((r) => r.nombre || NOMBRE_ROL[r.codigo]).join(" · ");
    const m = usuario.matricula_actual;
    const programa = m?.programa_nombre || usuario.programas?.[0]?.nombre || "Licenciatura en Educación Infantil";
    const esEstudiante = codigos.includes("ESTUDIANTE");
    const academica = esEstudiante
      ? `<dl class="detail-list"><div><dt>Programa</dt><dd>${escapar(programa)}</dd></div><div><dt>Semestre actual</dt><dd>${m ? `${escapar(m.semestre)}° semestre` : "Sin matrícula"}</dd></div><div><dt>Periodo de matrícula</dt><dd>${escapar(m?.periodo_codigo || "—")}</dd></div></dl>`
      : `<dl class="detail-list"><div><dt>Rol</dt><dd>${escapar(rotuloRoles)}</dd></div><div><dt>Programa</dt><dd>${escapar(programa)}</dd></div><div><dt>Último acceso</dt><dd>${escapar(fechaHora(usuario.ultimo_acceso_en) || "Aún no ha ingresado")}</dd></div></dl>`;

    let secciones = "";
    if (esEstudiante) {
      secciones += historial.status === "fulfilled"
        ? `<section class="panel profile-section"><header class="panel-heading"><div><h3>Historial de prácticas</h3><p>Una práctica por nivel y periodo académico</p></div></header>${tablaHistorial(historial.value.data)}</section>`
        : seccionError("Historial de prácticas", historial);
    }
    if (codigos.includes("DOCENTE_SUPERVISOR")) {
      secciones += comoDocente.status === "fulfilled"
        ? `<section class="panel profile-section"><header class="panel-heading"><div><h3>Estudiantes bajo su supervisión</h3><p>${pluralizar(comoDocente.value.data.length, "práctica asignada", "prácticas asignadas")}</p></div></header>${tablaEstudiantes(comoDocente.value.data, (a) => (a.asesor ? `Asesor: ${a.asesor.nombre_completo}` : "Sin asesor asignado"))}</section>`
        : seccionError("Estudiantes bajo su supervisión", comoDocente);
    }
    if (codigos.includes("ASESOR_SITIO")) {
      const vinculos = usuario.vinculaciones_institucionales || [];
      secciones += `<section class="panel profile-section"><header class="panel-heading"><div><h3>Vinculación institucional</h3><p>Instituciones donde acompaña practicantes</p></div></header>${vinculos.length ? `<div class="table-wrap"><table><thead><tr><th>Institución</th><th>Ciudad</th><th>Periodo</th><th>Vigencia</th></tr></thead><tbody>${vinculos.map((v) => `<tr><td><a class="profile-link" href="${pathFor("director", "institucion")}?id=${escapar(v.institucion_id)}">${escapar(v.institucion_nombre)}</a></td><td>${escapar(v.ciudad)}</td><td>${escapar(v.periodo_codigo)}</td><td>${escapar(fecha(v.vigente_desde))}${v.vigente_hasta ? ` – ${escapar(fecha(v.vigente_hasta))}` : " – vigente"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state" style="padding:24px">No tiene instituciones vinculadas.</div>`}</section>`;
      secciones += comoAsesor.status === "fulfilled"
        ? `<section class="panel profile-section"><header class="panel-heading"><div><h3>Practicantes en su institución</h3><p>${pluralizar(comoAsesor.value.data.length, "práctica asignada", "prácticas asignadas")}</p></div></header>${tablaEstudiantes(comoAsesor.value.data, (a) => (a.docente ? `Supervisor UDI: ${a.docente.nombre_completo}` : "Sin docente asignado"))}</section>`
        : seccionError("Practicantes en su institución", comoAsesor);
    }

    pagina.innerHTML = `<nav class="breadcrumbs"><a href="${pathFor("director", "usuarios")}">Gestión de usuarios</a><span>/</span><strong>${escapar(usuario.nombre_completo)}</strong></nav>
      <header class="profile-hero"><div class="person"><span class="avatar profile-avatar">${escapar(initials(usuario.nombre_completo))}</span><div><span class="eyebrow">${escapar(rotuloRoles)}</span><h2>${escapar(usuario.nombre_completo)}</h2><p>${escapar(programa)}</p></div></div><div class="profile-hero-actions">${badge(textoEstado, tonoEstado)}<button class="btn btn-secondary" type="button" data-pf-editar>Editar perfil</button><button class="btn ${usuario.estado === "ACTIVO" ? "btn-danger" : "btn-primary"}" type="button" data-pf-estado>${usuario.estado === "ACTIVO" ? "Deshabilitar usuario" : "Habilitar usuario"}</button></div></header>
      <section class="profile-grid"><article class="panel"><header class="panel-heading"><div><h3>Información personal</h3><p>Datos de identificación y contacto</p></div></header><dl class="detail-list"><div><dt>Documento</dt><dd>${escapar(usuario.documento)}</dd></div><div><dt>Correo institucional</dt><dd>${escapar(usuario.correo)}</dd></div><div><dt>Teléfono</dt><dd>${escapar(usuario.telefono || "No registrado")}</dd></div></dl></article>
      <article class="panel"><header class="panel-heading"><div><h3>${esEstudiante ? "Información académica" : "Información del usuario"}</h3><p>${esEstudiante ? "Matrícula más reciente" : "Cuenta y rol en el sistema"}</p></div></header>${academica}</article></section>${secciones}`;
    pagina._usuario = usuario;
  }

    // Clics: reintentar, editar los datos del usuario y cambiar su estado.
  pagina.addEventListener("click", (e) => {
    if (e.target.closest("[data-pf-retry]")) { cargar(); return; }
    const usuario = pagina._usuario;
    if (!usuario) return;
    if (e.target.closest("[data-pf-editar]")) abrirEdicionUsuario(ui, usuario, cargar);
    if (e.target.closest("[data-pf-estado]")) cambiarEstadoUsuario(ui, usuario, cargar);
  });

  cargar();
}

// ═════════════════════════ Detalle de la práctica ═════════════════════════

/**
 * Detalle de una práctica para el Director: expediente, bitácora y las dos evaluaciones por separado,
 * con las acciones de Dirección (devolver la bitácora, reabrir una evaluación y finalizar la práctica).
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarPracticaDirector(ui) {
  const { badge, escapar, icon, initials, openModal, pathFor, showToast } = ui;
  const pagina = document.querySelector(".page");
  const id = new URLSearchParams(window.location.search).get("id");
    // Estado local: datos de la práctica y URLs temporales de las evidencias.
  const estado = { datos: null, urls: new Map() };

  const errorHtml = (mensaje) => `<div style="padding:32px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" data-pd-retry>Reintentar</button> <a class="btn btn-ghost" href="${pathFor("director", "usuarios")}">Volver a usuarios</a></div>`;

  async function cargar(pestana = null) {
    pagina.innerHTML = `<p class="muted" style="padding:32px;text-align:center">Cargando la práctica…</p>`;
    if (!id) {
      pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Gestión de prácticas</span><h2>Selecciona una práctica</h2><p>Abre una práctica desde el perfil de un estudiante.</p></div></header><a class="btn btn-primary" href="${pathFor("director", "usuarios")}">Ir a Gestión de usuarios</a>`;
      return;
    }
    try {
      const { data: asignacion } = await api.get(`/practice-assignments/${id}`);
      const [documentos, bitacora, evaluaciones] = await Promise.allSettled([
        api.get(`/practice-assignments/${id}/legal-documents`),
        api.get(`/practice-assignments/${id}/logbook`),
        api.get("/evaluations", { asignacion_id: id, page_size: 10 }),
      ]);
      // Las retroalimentaciones solo vienen en el detalle de cada evaluación publicada.
      const detalles = new Map();
      if (evaluaciones.status === "fulfilled") {
        await Promise.all(evaluaciones.value.data.filter((e) => e.estado === "PUBLICADA").map(async (e) => {
          try { detalles.set(e.id, (await api.get(`/evaluations/${e.id}`)).data.evaluacion); } catch { /* se muestra sin retroalimentación */ }
        }));
      }
      estado.datos = { asignacion, documentos, bitacora, evaluaciones, detalles };
      pintar(pestana);
    } catch (error) {
      pagina.innerHTML = errorHtml(error?.code === "ASSIGNMENT_NOT_FOUND" ? "La práctica no existe." : mensajeDeError(error));
    }
  }

    // HTML de un documento legal con su estado.
  const doc = (d) => {
    const [texto, tono] = ESTADO_DOCUMENTO[d.estado] || [d.estado, "neutral"];
    const icono = d.estado === "APROBADO" ? "green" : d.estado === "POR_CORREGIR" ? "red" : "orange";
    return `<section><span class="doc-icon ${icono}">${icon("file")}</span><div><strong>${escapar(d.tipo.nombre)}</strong><small>${escapar(d.archivo?.nombre || "Aún no cargado")}${d.estado === "POR_CORREGIR" && d.observacion ? ` · ${escapar(d.observacion)}` : ""}</small></div><span>${badge(texto, tono)}</span>${d.documento_id ? `<button class="btn btn-ghost" type="button" data-pd-doc="${escapar(d.documento_id)}">Ver PDF</button>` : ""}</section>`;
  };

    /** Tarjeta de una evidencia (solo lectura). */
  function tarjetaEvidencia(e) {
    const vista = e.es_imagen ? `<img data-pd-img="${escapar(e.id)}" alt="Vista previa de ${escapar(e.nombre)}" />` : `<span>${icon("file")}<small>PDF</small></span>`;
    const tam = e.tamano_bytes < 1048576 ? `${Math.max(1, Math.round(e.tamano_bytes / 1024))} KB` : `${(e.tamano_bytes / 1048576).toFixed(1)} MB`;
    return `<article class="evidence-card"><button class="evidence-preview" type="button" data-pd-ev="${escapar(e.id)}" title="Abrir en una pestaña nueva" style="border:0;cursor:pointer">${vista}</button><div class="evidence-details"><div class="evidence-file-row"><div><strong title="${escapar(e.nombre)}">${escapar(e.nombre)}</strong><small>${e.es_imagen ? "Imagen" : "PDF"} · ${tam}</small></div></div><p class="evidence-caption">${escapar(e.descripcion || "Sin descripción")}</p></div></article>`;
  }

    /** Pregunta con la respuesta del estudiante (solo lectura). */
  function tarjetaPregunta(p, i, respuesta) {
    const marcadas = new Set(respuesta?.opciones_ids ?? []);
    const cuerpo = p.tipo === "ABIERTA"
      ? `<label class="field"><span class="sr-only">Respuesta registrada</span><textarea readonly>${escapar(respuesta?.texto || "Sin respuesta.")}</textarea></label>`
      : `<div class="student-answer-options readonly-options">${p.opciones.map((o) => `<label><input type="${p.tipo === "CERRADA_UNICA" ? "radio" : "checkbox"}" ${marcadas.has(o.id) ? "checked" : ""} disabled /><span>${escapar(o.etiqueta)}</span></label>`).join("")}</div>`;
    return `<fieldset class="student-question"><legend><span class="student-question-number">${String(i + 1).padStart(2, "0")}</span><span><small>${TIPO_PREGUNTA[p.tipo] || p.tipo}</small>${escapar(p.enunciado)}</span></legend>${cuerpo}</fieldset>`;
  }

    /** Pestaña de la bitácora: reflexión, evidencias, preguntas y botón para devolverla. */
  function panelBitacora(a, bitacora) {
    if (bitacora.status === "rejected") {
      const sinBitacora = bitacora.reason?.code === "LOGBOOK_NOT_FOUND";
      return `<article class="panel content-block"><span class="eyebrow">01 · Bitácora continua</span><h3>${sinBitacora ? "La bitácora aún no existe" : "No se pudo cargar la bitácora"}</h3><p class="${sinBitacora ? "muted" : "form-error"}">${escapar(sinBitacora ? "Se crea cuando el estudiante entra a su bitácora o cuando se aprueban sus documentos." : bitacora.reason?.message || "")}</p></article>`;
    }
    const b = bitacora.value.data;
    const enviada = ["ENVIADA", "EN_EVALUACION", "EVALUADA", "DEVUELTA"].includes(b.estado);
    const [textoB, tonoB] = ESTADO_BITACORA[b.estado] || [b.estado, "neutral"];
    if (!enviada) {
      const mensaje = b.estado === "BLOQUEADA" ? "La bitácora se habilita cuando todos los documentos legales estén aprobados." : "El estudiante está diligenciando su bitácora. Verás su contenido cuando la envíe de forma definitiva.";
      return `<article class="panel content-block"><div class="director-journal-heading"><div><span class="eyebrow">01 · Bitácora continua</span><h3>Actividades y reflexión</h3></div>${badge(textoB, tonoB)}</div><div class="empty-state"><strong>Aún no hay contenido entregado</strong><p>${escapar(mensaje)}</p></div></article>`;
    }
    const preguntas = b.cuestionario?.preguntas ?? [];
    const respuestas = new Map((b.contenido.respuestas || []).map((r) => [r.pregunta_id, r]));
    const respondidas = preguntas.filter((p) => respuestas.has(p.id)).length;
    return `<article class="panel content-block journal-editor"><div class="director-journal-heading"><div><span class="eyebrow">01 · Bitácora continua</span><h3>Actividades y reflexión</h3></div>${badge(textoB, tonoB)}</div>
      ${b.estado === "DEVUELTA" ? `<div class="notice"><strong>Devuelta al estudiante</strong><br>${escapar(b.motivo_devolucion || "")}</div>` : ""}
      <label class="field journal-field"><span>Descripción registrada por el estudiante${b.enviada_en ? ` · Entregada el ${escapar(fechaHora(b.enviada_en))}` : ""}</span><textarea readonly>${escapar(b.contenido.reflexion || "")}</textarea></label>
      <div class="evidence-heading"><div><strong>Evidencias adjuntas</strong><small>Archivos enviados por el estudiante para esta práctica.</small></div>${badge(pluralizar(b.evidencias.length, "archivo", "archivos"), b.evidencias.length ? "info" : "neutral")}</div>
      <div class="evidence-gallery submitted-evidence-gallery">${b.evidencias.length ? b.evidencias.map(tarjetaEvidencia).join("") : `<div class="evidence-empty"><div><strong>Sin evidencias adjuntas</strong></div></div>`}</div></article>
      <article class="panel student-questionnaire submitted-questionnaire"><header class="panel-heading student-questionnaire-heading"><div><span class="eyebrow">02 · Preguntas de nivel</span><h3>${escapar(b.cuestionario?.titulo || `Respuestas de ${a.nivel.nombre}`)}</h3><p>Cuestionario diligenciado por el estudiante para este nivel.</p></div>${preguntas.length ? badge(`${respondidas} de ${preguntas.length} respondidas`, respondidas === preguntas.length ? "success" : "warning") : badge("Sin cuestionario", "neutral")}</header><div class="student-question-list">${preguntas.length ? preguntas.map((p, i) => tarjetaPregunta(p, i, respuestas.get(p.id))).join("") : `<div class="empty-state"><strong>Sin respuestas registradas</strong><p>El cuestionario no fue habilitado para esta bitácora.</p></div>`}</div></article>`;
  }

    /** Pestaña de evaluaciones: nota y retroalimentación de cada evaluador (sin promedio) y acciones de reabrir o finalizar. */
  function panelEvaluaciones(a, bitacora, evaluaciones, detalles) {
    const lista = evaluaciones.status === "fulfilled" ? evaluaciones.value.data : [];
    const publicadas = lista.filter((e) => e.estado === "PUBLICADA");
    const enEvaluacion = a.estado === "PENDIENTE_EVALUACION";
    const finalizada = a.estado === "FINALIZADA";
    const b = bitacora.status === "fulfilled" ? bitacora.value.data : null;

    const tarjetas = TIPOS_EVALUACION.map(([tipo, rotulo]) => {
      const e = lista.find((x) => x.tipo === tipo);
      const persona = tipo === "DOCENTE_SUPERVISOR" ? a.docente : a.asesor;
      const nombre = e?.evaluador?.nombre_completo || persona?.nombre_completo || "Sin asignar";
      const publicada = e?.estado === "PUBLICADA";
      const retro = detalles.get(e?.id)?.retroalimentacion;
      const [texto, tono] = publicada ? ["Evaluado", "success"] : e?.estado === "BORRADOR" ? ["En borrador", "info"] : ["Pendiente", "warning"];
      return `<div class="practice-grade"><span>${rotulo}</span><strong>${publicada ? nota2(e.nota) : "—"}</strong><small>${escapar(nombre)}</small>${badge(texto, tono)}${publicada ? `<small>Publicada el ${escapar(fecha(e.publicada_en))}</small>` : ""}${retro ? `<details style="font-size:.8125rem"><summary style="cursor:pointer">Retroalimentación</summary><p style="white-space:pre-wrap">${escapar(retro)}</p></details>` : ""}${e?.reabrible ? `<button class="btn btn-secondary btn-block" type="button" data-pd-reabrir="${escapar(e.id)}" data-tipo="${escapar(rotulo)}">Reabrir evaluación</button>` : ""}</div>`;
    }).join("");

    const puedeFinalizar = enEvaluacion && publicadas.length === 2;
    const puedeDevolver = b && ["ENVIADA", "EN_EVALUACION"].includes(b.estado) && !publicadas.length && !finalizada;
    const [textoP, tonoP] = ESTADO_PRACTICA[a.estado] || [a.estado, "info"];
    return `<aside class="panel practice-evaluation-summary sticky"><span class="eyebrow">Evaluaciones independientes</span><h3>Calificaciones</h3>${tarjetas}<div class="notice">Las calificaciones se presentan por separado y no se promedian.</div>
      <dl class="mini-detail-list"><div><dt>Periodo</dt><dd>${escapar(a.periodo.codigo)}</dd></div><div><dt>Institución</dt><dd>${escapar(a.institucion.nombre)}</dd></div><div><dt>Estado</dt><dd>${escapar(textoP)}</dd></div></dl>
      <p class="form-error" role="alert" data-pd-error hidden></p>
      ${puedeFinalizar ? `<button class="btn btn-primary btn-block" type="button" data-pd-finalizar>Finalizar práctica</button>` : enEvaluacion ? `<p class="muted">Podrás finalizar la práctica cuando el docente y el asesor publiquen sus evaluaciones.</p>` : ""}
      ${puedeDevolver ? `<button class="btn btn-secondary btn-block" type="button" data-pd-devolver>Devolver bitácora al estudiante</button>` : ""}
      ${b && ["ENVIADA", "EN_EVALUACION", "EVALUADA", "DEVUELTA"].includes(b.estado) ? `<button class="btn btn-ghost btn-block" type="button" data-export-logbook="${escapar(b.id)}">${icon("file")} Exportar a PDF</button>` : ""}</aside>`;
  }

    /** Dibuja el encabezado y las pestañas de la práctica. */
  function pintar(pestana) {
    const { asignacion: a, documentos, bitacora, evaluaciones, detalles } = estado.datos;
    const [textoP, tonoP] = ESTADO_PRACTICA[a.estado] || [a.estado, "info"];
    const docs = documentos.status === "fulfilled" ? documentos.value.data : null;
    const resumenDocs = docs ? `${docs.resumen.aprobados_obligatorios} de ${docs.resumen.total_obligatorios} aprobados` : "—";
    const docsCompletos = docs?.resumen.expediente_completo;
    const listaDocs = documentos.status === "rejected"
      ? `<p class="form-error" style="padding:16px 20px">${escapar(documentos.reason?.message || "No se pudo cargar el expediente.")}</p>`
      : `<div class="practice-document-list">${docs.documentos.map(doc).join("") || '<div class="empty-state">Esta práctica no tiene documentos requeridos.</div>'}</div>`;
    const finalizada = a.estado === "FINALIZADA";

    pagina.innerHTML = `<nav class="breadcrumbs"><a href="${pathFor("director", "usuarios")}">Gestión de usuarios</a><span>/</span><a href="${pathFor("director", "perfil")}?id=${escapar(a.estudiante.id)}">${escapar(a.estudiante.nombre_completo)}</a><span>/</span><strong>${escapar(a.nivel.nombre)}</strong></nav>
      <header class="profile-hero practice-detail-hero"><div class="person"><span class="avatar profile-avatar">${escapar(initials(a.estudiante.nombre_completo))}</span><div><span class="eyebrow">${escapar(a.periodo.codigo)}</span><h2>${escapar(a.nivel.nombre)} · ${escapar(a.estudiante.nombre_completo)}</h2><p>${escapar(a.institucion.nombre)}${a.institucion.ciudad ? ` · ${escapar(a.institucion.ciudad)}` : ""}</p></div></div><div class="profile-hero-actions">${badge(textoP, tonoP)}<a class="btn btn-secondary" href="${pathFor("director", "perfil")}?id=${escapar(a.estudiante.id)}">Volver al perfil</a></div></header>
      ${a.estado === "CANCELADA" ? `<div class="notice"><strong>Práctica cancelada.</strong> ${escapar(a.motivo_cancelacion || "")}</div>` : ""}
      <section class="panel practice-assignment-summary"><div><span class="eyebrow">Asignación académica</span><h3>${escapar(a.institucion.nombre)}</h3></div><div><span>Docente supervisor</span><strong>${escapar(a.docente?.nombre_completo || "Sin asignar")}</strong></div><div><span>Asesor de sitio</span><strong>${escapar(a.asesor?.nombre_completo || "Sin asignar")}</strong></div><div><span>Estado documental</span><strong>${escapar(resumenDocs)}</strong></div></section>
      <div class="tabs practice-detail-tabs" role="tablist"><button class="${pestana === "journal" ? "" : "active"}" type="button" role="tab" data-pd-tab="documents">Expediente / Soporte documental <span>${docs ? docs.documentos.length : 0}</span></button><button class="${pestana === "journal" ? "active" : ""}" type="button" role="tab" data-pd-tab="journal">Bitácora y evaluaciones</button></div>
      <section data-pd-panel="documents" role="tabpanel" ${pestana === "journal" ? "hidden" : ""}><article class="panel"><header class="panel-heading"><div><h3>Expediente de ${escapar(a.nivel.nombre)}</h3><p>Documentos exclusivos del periodo ${escapar(a.periodo.codigo)}. No se mezclan con otros niveles.</p></div>${docs ? badge(resumenDocs, docsCompletos ? "success" : "warning") : ""}</header>${listaDocs}${finalizada ? "" : `<div style="padding:16px 20px"><a class="btn btn-secondary" href="${pathFor("director", "auditoria")}?asignacion=${escapar(a.id)}">Revisar en Auditoría documental →</a></div>`}</article></section>
      <section data-pd-panel="journal" role="tabpanel" ${pestana === "journal" ? "" : "hidden"}><div class="practice-detail-grid director-journal-view"><main>${panelBitacora(a, bitacora)}</main>${panelEvaluaciones(a, bitacora, evaluaciones, detalles)}</div></section>`;
    cargarMiniaturas();
  }

  // ───────────── Archivos ─────────────
  async function urlEvidencia(id) {
    const guardada = estado.urls.get(id);
    if (guardada && guardada.vence > Date.now() + 30_000) return guardada.url;
    const { data } = await api.get(`/logbooks/${estado.datos.bitacora.value.data.id}/evidences/${id}/download-url`);
    estado.urls.set(id, { url: data.url, vence: Date.now() + (data.expira_en_segundos || 60) * 1000 });
    return data.url;
  }
  function cargarMiniaturas() {
    pagina.querySelectorAll("img[data-pd-img]").forEach((img) => {
      urlEvidencia(img.dataset.pdImg).then((url) => { img.src = url; }).catch(() => img.replaceWith(Object.assign(document.createElement("small"), { textContent: "Sin vista previa" })));
    });
  }
    /** Abre un archivo en una pestaña nueva usando una URL firmada temporal. */
  async function abrir(obtenerUrl) {
    const ventana = window.open("", "_blank");
    try {
      const url = await obtenerUrl();
      if (ventana) ventana.location.href = url; else window.location.assign(url);
    } catch (error) {
      ventana?.close();
      showToast(mensajeDeError(error));
    }
  }

  // ───────────── Acciones de Dirección ─────────────
  const pestanaActual = () => (pagina.querySelector('[data-pd-tab="journal"]')?.classList.contains("active") ? "journal" : "documents");

    /** Ventana que pide un motivo (mínimo 5 caracteres) y lo envía a la ruta indicada. */
  function pedirMotivo({ titulo, explicacion, boton, ruta, exito, minimo = 5, maximo = 1000 }) {
    const modal = openModal(titulo, `<form data-pd-form-motivo><p>${explicacion}</p><label class="field"><span>Motivo (mínimo ${minimo} caracteres)</span><textarea name="motivo" rows="4" maxlength="${maximo}" required></textarea></label><p class="form-error" role="alert" data-pd-error-modal hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">${boton}</button></div></form>`);
    modal.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const aviso = modal.querySelector("[data-pd-error-modal]");
      const motivo = new FormData(e.currentTarget).get("motivo").trim();
      aviso.hidden = true;
      if (motivo.length < minimo) { aviso.textContent = `Describe el motivo (mínimo ${minimo} caracteres).`; aviso.hidden = false; return; }
      const enviar = modal.querySelector("[type=submit]");
      enviar.disabled = true;
      try {
        await api.post(ruta, { motivo });
        modal.remove();
        showToast(exito);
        cargar("journal");
      } catch (fallo) {
        aviso.textContent = mensajeDeError(fallo); aviso.hidden = false; enviar.disabled = false;
      }
    });
  }

    /** Confirmación para finalizar la práctica (requiere las dos evaluaciones publicadas). */
  function confirmarFinalizar() {
    const a = estado.datos.asignacion;
    const modal = openModal("Finalizar práctica", `<div><p>Vas a finalizar la <strong>${escapar(a.nivel.nombre)}</strong> de ${escapar(a.estudiante.nombre_completo)}.</p><div class="notice">Después de finalizar, las evaluaciones ya no se pueden editar ni reabrir. Las dos notas se conservan por separado.</div><p class="form-error" role="alert" data-pd-error-modal hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="button" data-pd-confirmar-fin>Finalizar práctica</button></div></div>`);
    modal.querySelector("[data-pd-confirmar-fin]").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api.post(`/practice-assignments/${a.id}/finish`);
        modal.remove();
        showToast("Práctica finalizada correctamente");
        cargar("journal");
      } catch (fallo) {
        const aviso = modal.querySelector("[data-pd-error-modal]");
        aviso.textContent = mensajeDeError(fallo); aviso.hidden = false; e.currentTarget.disabled = false;
      }
    });
  }

  // ───────────── Eventos ─────────────
    // Clics (delegación): pestañas, ver archivos, devolver bitácora, reabrir evaluación y finalizar.
  pagina.addEventListener("click", (e) => {
    if (e.target.closest("[data-pd-retry]")) { cargar(); return; }
    const pestana = e.target.closest("[data-pd-tab]");
    if (pestana) {
      pagina.querySelectorAll("[data-pd-tab]").forEach((t) => t.classList.toggle("active", t === pestana));
      pagina.querySelectorAll("[data-pd-panel]").forEach((p) => { p.hidden = p.dataset.pdPanel !== pestana.dataset.pdTab; });
      return;
    }
    const documento = e.target.closest("[data-pd-doc]");
    if (documento) { abrir(async () => (await api.get(`/legal-documents/${documento.dataset.pdDoc}/download-url`)).data.url); return; }
    const evidencia = e.target.closest("[data-pd-ev]");
    if (evidencia) { abrir(() => urlEvidencia(evidencia.dataset.pdEv)); return; }
    const reabrir = e.target.closest("[data-pd-reabrir]");
    if (reabrir) {
      pedirMotivo({ titulo: "Reabrir evaluación", explicacion: `La <strong>${escapar(reabrir.dataset.tipo)}</strong> volverá a borrador para que su autor la corrija. Mientras esté reabierta, el estudiante dejará de verla.`, boton: "Reabrir evaluación", ruta: `/evaluations/${reabrir.dataset.pdReabrir}/reopen`, exito: "Evaluación reabierta", maximo: 500 });
      return;
    }
    if (e.target.closest("[data-pd-devolver]")) {
      const b = estado.datos.bitacora.value.data;
      pedirMotivo({ titulo: "Devolver bitácora", explicacion: "La bitácora volverá al estudiante para que la corrija y la envíe de nuevo. Las evaluaciones sin publicar se retiran y se crean otra vez en el siguiente envío.", boton: "Devolver bitácora", ruta: `/logbooks/${b.id}/return`, exito: "Bitácora devuelta al estudiante" });
      return;
    }
    if (e.target.closest("[data-pd-finalizar]")) confirmarFinalizar();
  });

  cargar();
}

/**
 * Pestaña "Usuarios" de Gestión de Usuarios e Instituciones (Director) conectada al API real.
 * Recibe de appController las utilidades de interfaz para no duplicarlas.
 */
import { api } from "../services/api.js";
import { enviarRecuperacion, mensajeDeFirebase } from "../services/auth.js";

// Filas por página.
const TAMANO_PAGINA = 10;
// Nombre visible de cada rol.
const NOMBRE_ROL = {
  ESTUDIANTE: "Estudiante",
  DOCENTE_SUPERVISOR: "Docente supervisor",
  ASESOR_SITIO: "Asesor de sitio",
  DIRECTOR_PROGRAMA: "Director de programa",
};
// Estado del usuario: [texto, color de la insignia].
const ESTADO_USUARIO = { ACTIVO: ["Activo", "success"], INACTIVO: ["Inactivo", "neutral"], SUSPENDIDO: ["Suspendido", "warning"] };

// Une el mensaje del error con los detalles de validación del servidor.
const mensajeDeError = (error) => {
  const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => `${d.campo ? `${d.campo}: ` : ""}${d.mensaje}`) : [];
  return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
};

/**
 * Abre la ventana para editar los datos de un usuario (también la usa el perfil del usuario).
 * @param {object} usuario Usuario a editar.
 * @param {Function} alGuardar Se ejecuta tras guardar para refrescar la pantalla.
 */
export function abrirEdicionUsuario(ui, usuario, alGuardar) {
  const { escapar, openModal, showToast } = ui;
  const modal = openModal(`Editar ${escapar(usuario.nombre_completo)}`, `<form id="edit-user-form" novalidate><p class="muted">Corrige los datos básicos. El rol y la información académica no cambian aquí.</p><div class="form-grid">
    <label class="field"><span>Documento de identidad</span><input name="documento" value="${escapar(usuario.documento)}" required /></label>
    <label class="field"><span>Nombres</span><input name="nombres" value="${escapar(usuario.nombres)}" required /></label>
    <label class="field"><span>Apellidos</span><input name="apellidos" value="${escapar(usuario.apellidos)}" required /></label>
    <label class="field"><span>Correo institucional</span><input name="correo" type="email" value="${escapar(usuario.correo)}" required /></label>
    <label class="field"><span>Teléfono</span><input name="telefono" type="tel" value="${escapar(usuario.telefono || "")}" /></label>
  </div><p class="form-error" role="alert" data-form-error hidden></p>
    <div class="notice" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>¿No ha podido entrar o perdió su contraseña? Envíale de nuevo el correo para definirla.</span><button class="btn btn-secondary" type="button" data-reenviar>Reenviar correo de contraseña</button></div>
    <p class="muted" data-estado-correo role="status"></p>
    <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar cambios</button></div></form>`);
  const formulario = modal.querySelector("form");
  formulario.querySelector("[data-reenviar]").addEventListener("click", async (e) => {
    const estadoCorreo = formulario.querySelector("[data-estado-correo]");
    e.currentTarget.disabled = true;
    estadoCorreo.textContent = "Enviando…";
    try {
      await enviarRecuperacion(usuario.correo);
      estadoCorreo.textContent = `Correo enviado a ${usuario.correo}. Si no lo ve, que revise la carpeta de spam.`;
    } catch (error) {
      estadoCorreo.textContent = mensajeDeFirebase(error);
    }
    e.currentTarget.disabled = false;
  });
  formulario.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = formulario.querySelector("[data-form-error]");
    error.hidden = true;
    const f = new FormData(formulario);
    const cambios = {};
    for (const campo of ["documento", "nombres", "apellidos", "correo", "telefono"]) {
      const nuevo = (f.get(campo) || "").trim();
      if (nuevo !== (usuario[campo] || "")) cambios[campo] = nuevo;
    }
    if (!Object.keys(cambios).length) { modal.remove(); return; }
    const boton = formulario.querySelector("[type=submit]");
    boton.disabled = true;
    try {
      await api.patch(`/users/${usuario.id}`, cambios);
      modal.remove();
      showToast("Datos del usuario actualizados correctamente");
      alGuardar();
    } catch (fallo) {
      error.textContent = mensajeDeError(fallo);
      error.hidden = false;
      boton.disabled = false;
    }
  });
}

/** Habilita o deshabilita; si el servidor pide confirmación (prácticas en curso) la solicita. */
/**
 * Activa, inactiva o suspende un usuario; si tiene prácticas en curso el servidor pide confirmación.
 */
export async function cambiarEstadoUsuario(ui, usuario, alTerminar, confirmar = false) {
  const { escapar, openModal, showToast } = ui;
  const destino = usuario.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO";
  try {
    await api.patch(`/users/${usuario.id}/status`, confirmar ? { estado: destino, confirmar: true } : { estado: destino });
    showToast(destino === "ACTIVO" ? "Usuario habilitado" : "Usuario deshabilitado");
    alTerminar();
  } catch (error) {
    if (error.code === "CONFIRMATION_REQUIRED") {
      const modal = openModal("Confirmar cambio", `<div><p>${escapar(error.message)}</p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-danger" type="button" data-confirmar>Deshabilitar de todas formas</button></div></div>`);
      modal.querySelector("[data-confirmar]").addEventListener("click", () => { modal.remove(); cambiarEstadoUsuario(ui, usuario, alTerminar, true); });
    } else {
      showToast(mensajeDeError(error));
    }
  }
}

/**
 * Conecta la pestaña "Usuarios" (tabla, filtros, alta, edición y estado) con la API.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarUsuarios(ui) {
  const { badge, escapar, icon, initials, openModal, pathFor, showToast } = ui;
    // Estado local: página, filtros, filas por id y `turno` para descartar respuestas viejas.
  const estado = { pagina: 1, q: "", rol: "", semestre: "", estado: "", filas: new Map(), turno: 0, catalogos: null };
  const cuerpo = document.querySelector("#users-table-body");
  if (!cuerpo) return;

  // ---------- Listado ----------
  async function cargar() {
    const turno = ++estado.turno;
    cuerpo.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">Cargando usuarios…</td></tr>`;
    try {
      const consulta = { page: estado.pagina, page_size: TAMANO_PAGINA };
      if (estado.q) consulta.q = estado.q;
      if (estado.rol) consulta.rol = estado.rol;
      if (estado.semestre) consulta.semestre = estado.semestre;
      if (estado.estado) consulta.estado = estado.estado;
      const { data, meta } = await api.get("/users", consulta);
      if (turno !== estado.turno) return;
      estado.filas = new Map(data.map((u) => [u.id, u]));
      pintar(data, meta);
    } catch (error) {
      if (turno !== estado.turno) return;
      cuerpo.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px"><p class="form-error" role="alert">${escapar(mensajeDeError(error))}</p><button class="btn btn-secondary" type="button" data-u-retry>Reintentar</button></td></tr>`;
      document.querySelector("[data-pagination-summary]").textContent = "";
      document.querySelector("[data-pagination-buttons]").innerHTML = "";
    }
  }

    /** Dibuja la tabla de usuarios y la paginación. */
  function pintar(filas, meta) {
    if (!filas.length) {
      cuerpo.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No se encontraron usuarios con esos filtros.</td></tr>`;
    } else {
      cuerpo.innerHTML = filas.map((u) => {
        const [textoEstado, tono] = ESTADO_USUARIO[u.estado] || [u.estado, "neutral"];
        const roles = (u.roles || []).map((r) => NOMBRE_ROL[r] || r).join(" · ") || "—";
        const activo = u.estado === "ACTIVO";
        return `<tr data-u-row="${escapar(u.id)}"><td>${escapar(u.documento)}</td><td><div class="person"><span class="avatar">${escapar(initials(u.nombre_completo))}</span><span><a class="profile-link" href="${pathFor("director", "perfil")}?id=${escapar(u.id)}">${escapar(u.nombre_completo)}</a><small>${escapar(u.correo)}</small></span></div></td><td><strong>${escapar(roles)}</strong></td><td><strong>${u.semestre ? `${u.semestre}° semestre` : "—"}</strong></td><td>${badge(textoEstado, tono)}</td><td><div class="row-actions"><a class="btn btn-secondary" href="${pathFor("director", "perfil")}?id=${escapar(u.id)}">Ver perfil</a><button class="btn btn-secondary" type="button" data-u-edit="${escapar(u.id)}">Editar</button><button class="btn ${activo ? "btn-danger" : "btn-secondary"}" type="button" data-u-status="${escapar(u.id)}">${activo ? "Deshabilitar" : "Habilitar"}</button></div></td></tr>`;
      }).join("");
    }
    const desde = (meta.page - 1) * meta.page_size + 1;
    document.querySelector("[data-pagination-summary]").textContent = meta.total
      ? `${desde} - ${desde + filas.length - 1} de ${meta.total} usuarios`
      : "0 usuarios encontrados";
    const total = meta.total_pages;
    const botones = [`<button type="button" data-u-page="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>`];
    for (let n = 1; n <= total; n++) botones.push(`<button type="button" class="${n === meta.page ? "active" : ""}" data-u-page="${n}">${n}</button>`);
    botones.push(`<button type="button" data-u-page="${meta.page + 1}" ${meta.page >= total ? "disabled" : ""} aria-label="Página siguiente">›</button>`);
    document.querySelector("[data-pagination-buttons]").innerHTML = botones.join("");
  }

  // ---------- Filtros ----------
  let temporizador;
  document.querySelector("[data-search]")?.addEventListener("input", (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { estado.q = e.target.value.trim(); estado.pagina = 1; cargar(); }, 300);
  });
    // Conecta cada filtro (rol, semestre, estado) con el estado local y recarga la tabla.
  const filtro = (selector, clave, convertir = (v) => v) => document.querySelector(selector)?.addEventListener("change", (e) => {
    estado[clave] = e.target.value === "all" ? "" : convertir(e.target.value);
    estado.pagina = 1;
    cargar();
  });
  filtro("#user-role-filter", "rol");
  filtro("#user-semester-filter", "semestre", (v) => parseInt(v, 10));
  filtro("#user-status-filter", "estado");

  // ---------- Catálogos para el formulario de alta ----------
  async function catalogos() {
    const [programas, instituciones] = await Promise.all([
      api.get("/programs"),
      api.get("/institutions", { activa: "true", page_size: 100 }),
    ]);
    return { programas: programas.data, instituciones: instituciones.data };
  }

  // ---------- Alta ----------
    /** Formulario de alta: según el rol pide semestre (estudiante) o institución (asesor). */
  async function abrirAlta() {
    let cat;
    try { cat = await catalogos(); } catch (error) { showToast(mensajeDeError(error)); return; }
    const opcionesPrograma = cat.programas.length > 1
      ? `<label class="field"><span>Programa académico</span><select name="programa_id" required>${cat.programas.map((p) => `<option value="${escapar(p.id)}">${escapar(p.nombre)}</option>`).join("")}</select></label>`
      : "";
    const modal = openModal("Registrar nuevo usuario", `<form id="new-user-form" novalidate><div class="form-grid">
      <label class="field"><span>Tipo de usuario</span><select name="rol" data-user-role><option value="ESTUDIANTE">Estudiante</option><option value="DOCENTE_SUPERVISOR">Docente supervisor</option><option value="ASESOR_SITIO">Asesor de sitio</option></select></label>
      <label class="field"><span>Documento</span><input name="documento" required autocomplete="off" /></label>
      <label class="field"><span>Nombres</span><input name="nombres" required /></label>
      <label class="field"><span>Apellidos</span><input name="apellidos" required /></label>
      <label class="field"><span>Correo institucional</span><input name="correo" type="email" required /></label>
      <label class="field"><span>Teléfono (opcional)</span><input name="telefono" type="tel" /></label>
      ${opcionesPrograma}
      <label class="field" data-student-only><span>Semestre actual</span><select name="semestre">${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}">${i + 1}° semestre</option>`).join("")}</select></label>
      <label class="field" data-advisor-only style="display:none"><span>Institución educativa</span><select name="institucion_id" disabled><option value="">Seleccionar institución</option>${cat.instituciones.map((i) => `<option value="${escapar(i.id)}">${escapar(i.nombre)}</option>`).join("")}</select></label>
    </div><p class="form-error" role="alert" data-form-error hidden></p><div class="notice">Se creará la cuenta de acceso y recibirás un enlace para que la persona defina su contraseña.</div><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar registro</button></div></form>`);
    const formulario = modal.querySelector("form");
    const alternarRol = () => {
      const rol = formulario.rol.value;
      modal.querySelectorAll("[data-student-only]").forEach((f) => { f.style.display = rol === "ESTUDIANTE" ? "flex" : "none"; f.querySelector("select").disabled = rol !== "ESTUDIANTE"; });
      modal.querySelectorAll("[data-advisor-only]").forEach((f) => { f.style.display = rol === "ASESOR_SITIO" ? "flex" : "none"; f.querySelector("select").disabled = rol !== "ASESOR_SITIO"; });
    };
    formulario.rol.addEventListener("change", alternarRol);
    formulario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = formulario.querySelector("[data-form-error]");
      error.hidden = true;
      const f = new FormData(formulario);
      const cuerpoPeticion = { rol: f.get("rol"), documento: f.get("documento").trim(), nombres: f.get("nombres").trim(), apellidos: f.get("apellidos").trim(), correo: f.get("correo").trim() };
      if (f.get("telefono")?.trim()) cuerpoPeticion.telefono = f.get("telefono").trim();
      if (f.get("programa_id")) cuerpoPeticion.programa_id = f.get("programa_id");
      if (cuerpoPeticion.rol === "ESTUDIANTE") cuerpoPeticion.semestre = Number(f.get("semestre"));
      if (cuerpoPeticion.rol === "ASESOR_SITIO") {
        if (!f.get("institucion_id")) { error.textContent = "Selecciona la institución del asesor."; error.hidden = false; return; }
        cuerpoPeticion.institucion_id = f.get("institucion_id");
      }
      const boton = formulario.querySelector("[type=submit]");
      boton.disabled = true;
      try {
        const { data } = await api.post("/users", cuerpoPeticion);
        modal.remove();
        mostrarEnlace(data);
        estado.pagina = 1;
        cargar();
      } catch (fallo) {
        error.textContent = mensajeDeError(fallo);
        error.hidden = false;
        boton.disabled = false;
      }
    });
  }

    /** Tras crear el usuario ofrece enviarle el correo para definir su contraseña o copiar el enlace. */
  function mostrarEnlace(usuario) {
    const enlace = usuario.enlace_definir_contrasena;
    const avisos = (usuario.advertencias || []).map((a) => `<p class="form-error">${escapar(a)}</p>`).join("");
    const modal = openModal("Usuario creado", `<div><p><strong>${escapar(usuario.nombre_completo)}</strong> ya tiene cuenta con <strong>${escapar(usuario.correo)}</strong>. Falta que defina su contraseña.</p>
      <div class="form-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="button" data-enviar-correo>Enviar correo para definir contraseña</button></div>
      <p class="muted" data-estado-correo role="status"></p>
      ${enlace ? `<details><summary class="muted">¿No le llega el correo? Copia el enlace manualmente</summary><textarea readonly rows="4" style="width:100%" data-enlace>${escapar(enlace)}</textarea><div class="form-actions"><button class="btn btn-secondary" type="button" data-copiar>Copiar enlace</button></div></details>` : ""}
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cerrar</button></div>${avisos}</div>`);
    const estadoCorreo = modal.querySelector("[data-estado-correo]");
    modal.querySelector("[data-enviar-correo]").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      estadoCorreo.textContent = "Enviando…";
      try {
        await enviarRecuperacion(usuario.correo);
        estadoCorreo.textContent = `Correo enviado a ${usuario.correo}. Si no lo ve, que revise la carpeta de spam.`;
      } catch (error) {
        estadoCorreo.textContent = mensajeDeFirebase(error);
        e.currentTarget.disabled = false;
      }
    });
    modal.querySelector("[data-copiar]")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(enlace); showToast("Enlace copiado"); } catch { modal.querySelector("[data-enlace]").select(); showToast("Selecciona y copia el enlace"); }
    });
  }

  // ---------- Edición ----------
  const abrirEdicion = (usuario) => abrirEdicionUsuario(ui, usuario, cargar);
  const cambiarEstado = (usuario) => cambiarEstadoUsuario(ui, usuario, cargar);

  // ---------- Eventos ----------
    // Clics (delegación): nuevo usuario, editar, cambiar estado, paginación y reintentar.
  document.addEventListener("click", (e) => {
    const pagina = e.target.closest("[data-u-page]");
    if (pagina && !pagina.disabled) { estado.pagina = Number(pagina.dataset.uPage); cargar(); return; }
    if (e.target.closest("[data-u-retry]")) { cargar(); return; }
    const editar = e.target.closest("[data-u-edit]");
    if (editar) { const u = estado.filas.get(editar.dataset.uEdit); if (u) abrirEdicion(u); return; }
    const cambiar = e.target.closest("[data-u-status]");
    if (cambiar) { const u = estado.filas.get(cambiar.dataset.uStatus); if (u) cambiarEstado(u); return; }
    const nuevo = e.target.closest("[data-new]");
    if (nuevo && nuevo.textContent.includes("usuario")) abrirAlta();
  });

  cargar();
}

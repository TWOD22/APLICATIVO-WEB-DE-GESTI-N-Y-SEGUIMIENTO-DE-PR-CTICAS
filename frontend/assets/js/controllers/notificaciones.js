/**
 * Campana de notificaciones (todos los roles) conectada al API real.
 * Las notificaciones pertenecen a la persona, no al rol: quien tiene varios roles ve todas en una sola bandeja.
 * Se consultan al abrir la página, al volver a la pestaña y cada pocos minutos mientras está visible.
 */
import { api } from "../services/api.js";

// Notificaciones por página y cada cuánto se consultan (2 minutos) mientras la pestaña está visible.
const TAMANO_PAGINA = 15;
const INTERVALO_MS = 120_000;

// Estilos de la campana y el panel; se insertan una sola vez en la página.
const ESTILOS = `
.bell { position: relative; }
.bell-button { position: relative; display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--line, #dfe5ee); border-radius: 10px; background: #fff; color: inherit; cursor: pointer; }
.bell-button:hover { background: var(--blue-soft, #eaf3ff); }
.bell-button .icon { width: 19px; height: 19px; }
.bell-count { position: absolute; top: -6px; right: -6px; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 999px; background: #d92d20; color: #fff; font-size: 10.5px; font-weight: 700; line-height: 19px; text-align: center; }
.bell-panel { position: absolute; z-index: 60; top: 48px; right: 0; width: min(400px, calc(100vw - 24px)); max-height: min(560px, 80vh); display: flex; flex-direction: column; border: 1px solid var(--line, #dfe5ee); border-radius: 14px; background: #fff; box-shadow: 0 18px 44px rgba(16, 24, 40, .18); overflow: hidden; }
.bell-panel[hidden] { display: none; }
.bell-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line, #dfe5ee); }
.bell-head h3 { margin: 0; font-size: 14px; }
.bell-list { margin: 0; padding: 0; list-style: none; overflow-y: auto; }
.bell-item { display: grid; grid-template-columns: 34px 1fr 10px; gap: 10px; width: 100%; padding: 12px 16px; border: 0; border-bottom: 1px solid var(--line, #dfe5ee); background: #fff; text-align: left; cursor: pointer; color: inherit; font: inherit; }
.bell-item:hover { background: var(--background, #f4f6fa); }
.bell-item.unread { background: var(--blue-soft, #eef5ff); }
.bell-item .bell-ico { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: var(--blue-soft, #eaf3ff); color: var(--blue, #1769d1); }
.bell-item.alta .bell-ico { background: #fdecea; color: #d92d20; }
.bell-item .bell-ico .icon { width: 17px; height: 17px; }
.bell-item strong { display: block; font-size: 12.5px; line-height: 1.35; }
.bell-item p { margin: 2px 0 0; font-size: 12px; line-height: 1.4; color: var(--muted, #667085); overflow-wrap: anywhere; }
.bell-item small { display: block; margin-top: 4px; font-size: 11px; color: var(--muted, #667085); }
.bell-item .bell-dot { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--blue, #1769d1); }
.bell-item:not(.unread) .bell-dot { visibility: hidden; }
.bell-empty, .bell-estado { padding: 28px 16px; text-align: center; font-size: 12.5px; color: var(--muted, #667085); }
.bell-foot { padding: 10px 16px; border-top: 1px solid var(--line, #dfe5ee); text-align: center; }
.bell-link { border: 0; background: none; color: var(--blue, #1769d1); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.bell-link:disabled { opacity: .5; cursor: default; }
`;

// Mensaje de error para mostrar al usuario.
const mensajeDeError = (error) => error?.message || "No se pudieron cargar las notificaciones.";

// Tiempo relativo ("hace 5 min") a partir de una fecha.
const relativo = (valor) => {
  const d = valor ? new Date(valor) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const segundos = Math.round((d.getTime() - Date.now()) / 1000);
  const formato = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  const abs = Math.abs(segundos);
  if (abs < 60) return "hace un momento";
  if (abs < 3600) return formato.format(Math.round(segundos / 60), "minute");
  if (abs < 86400) return formato.format(Math.round(segundos / 3600), "hour");
  if (abs < 86400 * 7) return formato.format(Math.round(segundos / 86400), "day");
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
};

// Icono según el tipo de notificación.
const iconoDe = (n) => {
  if (n.prioridad === "alta" && !/PUBLICADA|FINALIZADA|APROBADO/.test(n.tipo || "")) return "alert";
  const t = n.tipo || "";
  if (t.startsWith("DOCUMENTO") || t.startsWith("ALERTA")) return "file";
  if (t.startsWith("BITACORA")) return "edit";
  if (t.startsWith("EVALUACION") || t.startsWith("PRACTICA")) return "check";
  if (t.startsWith("ASIGNACION")) return "users";
  return "clock";
};

/**
 * Monta la campana de notificaciones en el encabezado de la página.
 * @param {object} ui Utilidades de interfaz compartidas.
 */
export function montarNotificaciones(ui) {
  const { escapar, icon, pathFor, role, showToast } = ui;
  const host = document.querySelector("[data-bell]");
  if (!host) return;

  if (!document.querySelector("#estilos-campana")) {
    const estilo = document.createElement("style");
    estilo.id = "estilos-campana";
    estilo.textContent = ESTILOS;
    document.head.append(estilo);
  }

  host.className = "bell";
  host.innerHTML = `<button class="bell-button" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Notificaciones" data-bell-toggle>${icon("bell")}<span class="bell-count" data-bell-count hidden></span></button><div class="bell-panel" role="dialog" aria-label="Notificaciones" data-bell-panel hidden></div>`;
  const boton = host.querySelector("[data-bell-toggle]");
  const panel = host.querySelector("[data-bell-panel]");
  const contador = host.querySelector("[data-bell-count]");

    // Estado local: panel abierto, lista cargada, paginación, contador de no leídas y banderas de carga/error.
  const estado = { abierto: false, items: [], pagina: 0, total: 0, noLeidas: 0, cargando: false, error: null, turno: 0 };

  // ───────────── Destino de cada notificación ─────────────
  /** Devuelve la URL a la que lleva la notificación según el rol de la página (o null si no hay destino claro). */
    /** Calcula a qué pantalla lleva una notificación según su tipo y el rol activo. */
  async function destinoDe(n) {
    const tipo = n.tipo || "";
    const e = n.entidad || {};
    if (n.ruta_destino && n.ruta_destino.startsWith("/") && !n.ruta_destino.startsWith("//")) return n.ruta_destino;
    const dashboard = pathFor(role, "dashboard");

    if (role === "estudiante") {
      if (tipo.startsWith("DOCUMENTO") || tipo.startsWith("ALERTA")) return pathFor("estudiante", "documentos");
      if (tipo.startsWith("BITACORA")) return pathFor("estudiante", "bitacora");
      return dashboard;
    }
    if (role === "director") {
      if (tipo === "DOCUMENTO_PENDIENTE_REVISION" || tipo === "ALERTA_EXPEDIENTE") return e.id ? `${pathFor("director", "auditoria")}?asignacion=${encodeURIComponent(e.id)}` : pathFor("director", "auditoria");
      if ((e.tipo === "asignacion_practica" || e.tipo === "asignacion") && e.id) return `${pathFor("director", "practica")}?id=${encodeURIComponent(e.id)}`;
      return dashboard;
    }
    // Docente y asesor: llevan a la evaluación de la bitácora; hay que averiguar la asignación.
    try {
      if (e.tipo === "asignacion_practica" || e.tipo === "asignacion") return dashboard;
      if (e.tipo === "evaluacion" && e.id) {
        const { data } = await api.get(`/evaluations/${e.id}`);
        const asignacion = data?.asignacion?.id;
        return asignacion ? `${pathFor(role, "evaluacion")}?asignacion=${encodeURIComponent(asignacion)}` : dashboard;
      }
      if (e.tipo === "bitacora" && e.id) {
        const { data } = await api.get("/evaluations", { page_size: 100 });
        const fila = data.find((x) => x.bitacora?.id === e.id);
        const asignacion = fila?.asignacion?.id;
        return asignacion ? `${pathFor(role, "evaluacion")}?asignacion=${encodeURIComponent(asignacion)}` : dashboard;
      }
    } catch { /* sin destino: se abre el panel principal */ }
    return dashboard;
  }

  // ───────────── Datos ─────────────
    /** Muestra la cantidad de notificaciones sin leer en la campana. */
  function pintarContador() {
    contador.hidden = estado.noLeidas <= 0;
    contador.textContent = estado.noLeidas > 99 ? "99+" : String(estado.noLeidas);
    boton.setAttribute("aria-label", estado.noLeidas > 0 ? `Notificaciones: ${estado.noLeidas} sin leer` : "Notificaciones");
  }

    /** Pide una página de notificaciones al servidor. */
  async function consultar(pagina) {
    const turno = ++estado.turno;
    estado.cargando = true;
    estado.error = null;
    if (estado.abierto) pintarPanel();
    try {
      const { data, meta } = await api.get("/notifications", { page: pagina, page_size: TAMANO_PAGINA });
      if (turno !== estado.turno) return;
      estado.items = pagina === 1 ? data : [...estado.items, ...data.filter((n) => !estado.items.some((x) => x.id === n.id))];
      estado.pagina = pagina;
      estado.total = meta.total;
      estado.noLeidas = meta.no_leidas ?? estado.items.filter((n) => !n.leida).length;
    } catch (error) {
      if (turno !== estado.turno) return;
      estado.error = mensajeDeError(error);
    } finally {
      if (turno === estado.turno) estado.cargando = false;
    }
    pintarContador();
    if (estado.abierto) pintarPanel();
  }

  /** Solo el contador (sin tocar la lista): consulta ligera para el sondeo periódico. */
  async function actualizarContador() {
    if (estado.abierto) { await consultar(1); return; }
    try {
      const { meta } = await api.get("/notifications", { page: 1, page_size: 1 });
      estado.noLeidas = meta.no_leidas ?? 0;
      pintarContador();
    } catch { /* se reintenta en el siguiente ciclo */ }
  }

  // ───────────── Panel ─────────────
    /** Dibuja el panel con la lista de notificaciones. */
  function pintarPanel() {
    const hay = estado.items.length > 0;
    let cuerpo;
    if (estado.error && !hay) cuerpo = `<div class="bell-estado"><p class="form-error" role="alert">${escapar(estado.error)}</p><button class="btn btn-secondary" type="button" data-bell-retry>Reintentar</button></div>`;
    else if (!hay && estado.cargando) cuerpo = `<div class="bell-estado">Cargando notificaciones…</div>`;
    else if (!hay) cuerpo = `<div class="bell-empty"><strong>No tienes notificaciones</strong><p>Aquí verás los avisos sobre tus documentos, bitácoras, evaluaciones y asignaciones.</p></div>`;
    else {
      cuerpo = `<ul class="bell-list">${estado.items.map((n) => `<li><button type="button" class="bell-item ${n.leida ? "" : "unread"} ${n.prioridad === "alta" ? "alta" : ""}" data-bell-item="${escapar(n.id)}"><span class="bell-ico">${icon(iconoDe(n))}</span><span><strong>${escapar(n.titulo)}</strong>${n.mensaje ? `<p>${escapar(n.mensaje)}</p>` : ""}<small>${escapar(relativo(n.fecha))}</small></span><span class="bell-dot" aria-label="${n.leida ? "" : "Sin leer"}"></span></button></li>`).join("")}</ul>`;
    }
    const hayMas = estado.items.length < estado.total;
    panel.innerHTML = `<div class="bell-head"><h3>Notificaciones${estado.noLeidas ? ` · ${estado.noLeidas} sin leer` : ""}</h3><button class="bell-link" type="button" data-bell-todas ${estado.noLeidas ? "" : "disabled"}>Marcar todas como leídas</button></div>${cuerpo}${hayMas ? `<div class="bell-foot"><button class="bell-link" type="button" data-bell-mas ${estado.cargando ? "disabled" : ""}>${estado.cargando ? "Cargando…" : "Ver más antiguas"}</button></div>` : ""}${estado.error && hay ? `<p class="form-error" role="alert" style="padding:8px 16px;margin:0">${escapar(estado.error)}</p>` : ""}`;
  }

    /** Abre el panel y carga las notificaciones. */
  function abrir() {
    estado.abierto = true;
    panel.hidden = false;
    boton.setAttribute("aria-expanded", "true");
    pintarPanel();
    consultar(1);
  }
    /** Cierra el panel (opcionalmente devuelve el foco a la campana). */
  function cerrar({ devolverFoco = false } = {}) {
    if (!estado.abierto) return;
    estado.abierto = false;
    panel.hidden = true;
    boton.setAttribute("aria-expanded", "false");
    if (devolverFoco) boton.focus();
  }

    /** Marca una notificación como leída. */
  async function marcarLeida(id) {
    const n = estado.items.find((x) => x.id === id);
    if (!n || n.leida) return;
    n.leida = true;
    estado.noLeidas = Math.max(0, estado.noLeidas - 1);
    pintarContador();
    try { await api.patch(`/notifications/${id}/read`); }
    catch { n.leida = false; estado.noLeidas += 1; pintarContador(); }
  }

    /** Marca todas como leídas. */
  async function marcarTodas() {
    const boton2 = panel.querySelector("[data-bell-todas]");
    if (boton2) boton2.disabled = true;
    try {
      await api.patch("/notifications/read-all");
      estado.items.forEach((n) => { n.leida = true; });
      estado.noLeidas = 0;
      pintarContador();
      pintarPanel();
    } catch (error) {
      showToast(mensajeDeError(error));
      if (boton2) boton2.disabled = false;
    }
  }

  // ───────────── Eventos ─────────────
    // Abrir/cerrar con la campana; clic fuera o tecla Escape cierran; al volver a la pestaña se refresca el contador.
  boton.addEventListener("click", () => (estado.abierto ? cerrar() : abrir()));
  panel.addEventListener("click", async (e) => {
    if (e.target.closest("[data-bell-retry]")) { consultar(1); return; }
    if (e.target.closest("[data-bell-todas]")) { marcarTodas(); return; }
    if (e.target.closest("[data-bell-mas]")) { consultar(estado.pagina + 1); return; }
    const item = e.target.closest("[data-bell-item]");
    if (!item) return;
    const n = estado.items.find((x) => x.id === item.dataset.bellItem);
    if (!n) return;
    item.disabled = true;
    await marcarLeida(n.id);
    const destino = await destinoDe(n);
    if (destino && destino !== window.location.pathname + window.location.search) window.location.assign(destino);
    else { item.disabled = false; pintarPanel(); }
  });
  // composedPath: el botón pulsado puede haberse reemplazado al redibujar el panel y ya no estar dentro de `host`.
  document.addEventListener("click", (e) => { if (estado.abierto && !e.composedPath().includes(host)) cerrar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar({ devolverFoco: true }); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") actualizarContador(); });
  setInterval(() => { if (document.visibilityState === "visible") actualizarContador(); }, INTERVALO_MS);

  actualizarContador();
}

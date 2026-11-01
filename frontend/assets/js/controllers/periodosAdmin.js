/**
 * "Periodos académicos" del Director: crear, activar y cerrar periodos.
 *  - Activar un periodo nuevo matricula a los estudiantes que continúan (paso de semestre) y copia los docentes
 *    de nivel y las guías de criterios del periodo anterior.
 *  - Cerrar exige que no haya prácticas en curso; las solicitudes sin resolver se cancelan con confirmación.
 */
import { api } from "../services/api.js";

const ETIQUETA = { PLANIFICADO: ["Planificado", "info"], ACTIVO: ["Activo", "success"], CERRADO: ["Cerrado", "neutral"] };
const AVISO = "periodos:aviso";

/** @param {object} ui Utilidades compartidas: badge, escapar, openModal, showToast. */
export function montarPeriodos(ui) {
  const { badge, escapar, openModal, showToast } = ui;
  const pagina = document.querySelector(".page");
  const estado = { periodos: [], turno: 0 };
  /** Texto de error legible; añade los detalles de validación del servidor. */
  const mensaje = (error) => {
    const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => `${d.campo ? `${d.campo}: ` : ""}${d.mensaje}`) : [];
    return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
  };
  /** Fecha corta en español; «—» si el valor no es válido. */
  const fecha = (valor) => {
    const d = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
  };
  /** Lee (y borra) el aviso que dejó la recarga anterior, si el navegador permite guardarlo. */
  const leerAviso = () => { try { const t = sessionStorage.getItem(AVISO); sessionStorage.removeItem(AVISO); return t; } catch { return null; } };
  /** Tras activar o cerrar se recarga la página: el selector de periodo de la cabecera también debe actualizarse. */
  const recargarConAviso = (texto) => { try { sessionStorage.setItem(AVISO, texto); } catch { /* sin almacenamiento: solo se recarga */ } window.location.reload(); };

  /** Trae los periodos académicos y los pinta; `aviso` es un mensaje opcional para mostrar arriba. */
  async function cargar(aviso = null) {
    const turno = ++estado.turno;
    pagina.innerHTML = `<p class="muted practice-empty">Cargando periodos…</p>`;
    try {
      const { data } = await api.get("/periods");
      if (turno !== estado.turno) return;
      estado.periodos = data;
      pintar(aviso);
    } catch (error) {
      if (turno === estado.turno) pagina.innerHTML = `<div class="practice-empty"><p class="form-error" role="alert">${escapar(mensaje(error))}</p><button class="btn btn-secondary" type="button" data-per-reintentar>Reintentar</button></div>`;
    }
  }

  /** Tabla de periodos con su estado y la acción que corresponde: activar el planificado, cerrar el activo o solo consulta. */
  function pintar(aviso) {
    const hayActivo = estado.periodos.some((p) => p.estado === "ACTIVO");
    const filas = estado.periodos.map((p) => {
      const [texto, tono] = ETIQUETA[p.estado] ?? [p.estado, "info"];
      const accion = p.estado === "ACTIVO"
        ? `<button class="btn btn-secondary" type="button" data-per-cerrar="${escapar(p.id)}">Cerrar periodo</button>`
        : p.estado === "PLANIFICADO"
          ? `<button class="btn btn-primary" type="button" data-per-activar="${escapar(p.id)}" ${hayActivo ? 'disabled title="Cierra primero el periodo activo"' : ""}>Activar</button>`
          : `<span class="muted">Solo consulta</span>`;
      return `<tr><td><strong>${escapar(p.codigo)}</strong><small>${escapar(p.nombre)}</small></td><td>${fecha(p.fecha_inicio)} → ${fecha(p.fecha_fin)}</td><td>${badge(texto, tono)}</td><td>${accion}</td></tr>`;
    }).join("");
    pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Ciclo académico</span><h2>Periodos académicos</h2><p>Crea el periodo siguiente, actívalo cuando empiece y ciérralo cuando termine. Solo puede haber un periodo activo.</p></div><button class="btn btn-primary" type="button" data-per-nuevo>+ Nuevo periodo</button></header>
      ${aviso ? `<div class="notice" role="status"><span>${escapar(aviso)}</span></div>` : ""}
      <section class="panel"><div class="table-wrap"><table class="dashboard-practices"><thead><tr><th>Periodo</th><th>Fechas</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${filas || `<tr><td colspan="4" class="muted">Aún no hay periodos.</td></tr>`}</tbody></table></div></section>
      <section class="panel content-block"><h3>¿Qué pasa al cambiar de periodo?</h3>
        <ul class="plain-list"><li><strong>Al cerrar:</strong> no debe haber prácticas en curso ni pendientes de evaluación. Las solicitudes sin resolver se cancelan y las matrículas del periodo quedan finalizadas.</li>
        <li><strong>Al activar el siguiente:</strong> los estudiantes que terminaron la práctica de su semestre pasan al siguiente; quienes no, repiten el mismo. Quienes terminaron el último semestre del programa no se matriculan de nuevo.</li>
        <li>También se copian los docentes por nivel y las guías de criterios del periodo anterior; puedes cambiarlos después.</li></ul></section>`;
  }

  // ───────────── Crear ─────────────
  /** Formulario para crear un periodo (código, nombre y fechas). */
  function nuevo() {
    const modal = openModal("Nuevo periodo académico", `<form novalidate><div class="form-grid">
      <label class="field"><span>Código</span><input name="codigo" placeholder="2027-1" maxlength="20" required /></label>
      <label class="field"><span>Nombre</span><input name="nombre" placeholder="Primer periodo 2027" maxlength="120" required /></label>
      <label class="field"><span>Fecha de inicio</span><input type="date" name="fecha_inicio" required /></label>
      <label class="field"><span>Fecha de fin</span><input type="date" name="fecha_fin" required /></label></div>
      <p class="form-error" role="alert" data-form-error hidden></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Crear periodo</button></div></form>`);
    const formulario = modal.querySelector("form");
    formulario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = formulario.querySelector("[data-form-error]");
      const cuerpo = { codigo: formulario.codigo.value.trim(), nombre: formulario.nombre.value.trim(), fecha_inicio: formulario.fecha_inicio.value, fecha_fin: formulario.fecha_fin.value };
      if (Object.values(cuerpo).some((v) => !v)) { error.textContent = "Completa todos los campos."; error.hidden = false; return; }
      const boton = formulario.querySelector("[type=submit]");
      boton.disabled = true;
      try {
        await api.post("/periods", cuerpo);
        modal.remove();
        showToast("Periodo creado");
        cargar();
      } catch (fallo) {
        error.textContent = mensaje(fallo); error.hidden = false; boton.disabled = false;
      }
    });
  }

  // ───────────── Activar ─────────────
  /** Pregunta qué traer del último periodo cerrado (matrículas, docentes por nivel, guías) y activa el periodo. */
  function activar(id) {
    const periodo = estado.periodos.find((p) => p.id === id);
    if (!periodo) return;
    const modal = openModal(`Activar ${escapar(periodo.codigo)}`, `<form novalidate><p class="muted">El periodo pasará a ser el periodo vigente de todo el sistema. Se preparará a partir del último periodo cerrado:</p>
      <label class="check-row"><input type="checkbox" name="matriculas" checked /> <span>Matricular a los estudiantes que continúan (con paso de semestre)</span></label>
      <label class="check-row"><input type="checkbox" name="docentes" checked /> <span>Copiar los docentes por nivel</span></label>
      <label class="check-row"><input type="checkbox" name="guias" checked /> <span>Copiar las guías de criterios</span></label>
      <p class="form-error" role="alert" data-form-error hidden></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Activar periodo</button></div></form>`);
    const formulario = modal.querySelector("form");
    formulario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = formulario.querySelector("[data-form-error]");
      const boton = formulario.querySelector("[type=submit]");
      boton.disabled = true;
      try {
        const { data } = await api.post(`/periods/${id}/activate`, {
          arrastrar_matriculas: formulario.matriculas.checked, copiar_docentes: formulario.docentes.checked, copiar_guias: formulario.guias.checked,
        });
        const p = data.preparacion;
        const partes = p.periodo_anterior
          ? [`${p.matriculados} estudiante(s) matriculados`, p.egresados ? `${p.egresados} terminaron el programa` : null, `${p.docentes_copiados} docente(s) de nivel copiados`, `${p.guias_copiadas} guía(s) copiadas`].filter(Boolean).join(" · ")
          : "Es el primer periodo: no había uno anterior del cual copiar.";
        recargarConAviso(`Periodo ${periodo.codigo} activo. ${partes}.`);
      } catch (fallo) {
        error.textContent = mensaje(fallo); error.hidden = false; boton.disabled = false;
      }
    });
  }

  // ───────────── Cerrar ─────────────
  /** Muestra el resumen de cierre. Si hay prácticas en marcha no deja cerrar; si hay solicitudes abiertas avisa que se cancelarán. */
  async function cerrar(id) {
    const periodo = estado.periodos.find((p) => p.id === id);
    if (!periodo) return;
    let r;
    try { ({ data: r } = await api.get(`/periods/${id}/closing-summary`)); } catch (error) { showToast(mensaje(error)); return; }
    const bloqueado = r.practicas_en_marcha > 0;
    const modal = openModal(`Cerrar ${escapar(periodo.codigo)}`, `<form novalidate>
      <div class="summary-statuses"><div><span>Prácticas en curso o por evaluar</span><strong>${r.practicas_en_marcha}</strong></div><div><span>Solicitudes sin resolver</span><strong>${r.solicitudes_abiertas}</strong></div><div><span>Prácticas finalizadas</span><strong>${r.practicas_finalizadas}</strong></div></div>
      ${bloqueado
        ? `<div class="notice"><span><strong>No se puede cerrar todavía.</strong> Hay ${r.practicas_en_marcha} práctica(s) sin terminar. Finalízalas o cancélalas desde Seguimiento de prácticas.</span></div>`
        : `<p class="muted">${r.solicitudes_abiertas ? `Las ${r.solicitudes_abiertas} solicitud(es) sin resolver se cancelarán. ` : ""}Las matrículas del periodo quedarán finalizadas. Esta acción no se puede deshacer.</p>`}
      <p class="form-error" role="alert" data-form-error hidden></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Volver</button>${bloqueado ? `<a class="btn btn-primary" href="/frontend/pages/director/seguimiento.html?grupo=VIGENTES">Ir a Seguimiento</a>` : `<button class="btn btn-danger" type="submit">Cerrar periodo</button>`}</div></form>`);
    const formulario = modal.querySelector("form");
    formulario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = formulario.querySelector("[data-form-error]");
      const boton = formulario.querySelector("[type=submit]");
      boton.disabled = true;
      try {
        const { data } = await api.post(`/periods/${id}/close`, { confirmar: true });
        recargarConAviso(`Periodo ${periodo.codigo} cerrado. ${data.solicitudes_canceladas} solicitud(es) canceladas · ${data.matriculas_finalizadas} matrícula(s) finalizadas. Crea y activa el siguiente periodo para continuar.`);
      } catch (fallo) {
        error.textContent = mensaje(fallo); error.hidden = false; boton.disabled = false;
      }
    });
  }

  /** Botones de la pantalla: nuevo, activar, cerrar y reintentar. */
  pagina.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-per-nuevo")) nuevo();
    else if (b.dataset.perActivar) activar(b.dataset.perActivar);
    else if (b.dataset.perCerrar) cerrar(b.dataset.perCerrar);
    else if (b.hasAttribute("data-per-reintentar")) cargar();
  });
  cargar(leerAviso());
}

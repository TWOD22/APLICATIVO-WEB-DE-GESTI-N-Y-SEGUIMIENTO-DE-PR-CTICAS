/**
 * "Documentos requeridos" del Director: catálogo de documentos legales y qué se pide en cada nivel de práctica
 * (obligatorio, opcional o no se pide). Un documento obligatorio nuevo afecta a los estudiantes con práctica sin terminar:
 * el servidor avisa cuántos son y se pide confirmación.
 */
import { api } from "../services/api.js";

/** @param {object} ui Utilidades compartidas: badge, escapar, openModal, showToast. */
export function montarRequisitos(ui) {
  const { badge, escapar, openModal, showToast } = ui;
  const pagina = document.querySelector(".page");
  const estado = { tipos: [], niveles: [], turno: 0 };
  /** Texto de error legible; añade los detalles de validación que envíe el servidor. */
  const mensaje = (error) => {
    const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => `${d.campo ? `${d.campo}: ` : ""}${d.mensaje}`) : [];
    return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
  };

  /** Trae el catálogo de documentos y, por nivel, qué se pide; luego lo pinta. */
  async function cargar() {
    const turno = ++estado.turno;
    pagina.innerHTML = `<p class="muted practice-empty">Cargando documentos…</p>`;
    try {
      const { data } = await api.get("/document-requirements");
      if (turno !== estado.turno) return;
      estado.tipos = data.tipos;
      estado.niveles = data.niveles;
      pintar();
    } catch (error) {
      if (turno === estado.turno) pagina.innerHTML = `<div class="practice-empty"><p class="form-error" role="alert">${escapar(mensaje(error))}</p><button class="btn btn-secondary" type="button" data-req-reintentar>Reintentar</button></div>`;
    }
  }

  /** Cuántos niveles lo piden como obligatorio y cuántos como opcional. */
  const resumenDe = (tipoId) => {
    let obligatorio = 0; let opcional = 0;
    for (const n of estado.niveles) {
      const r = n.requisitos.find((q) => q.tipo_id === tipoId);
      if (r) (r.obligatorio ? (obligatorio += 1) : (opcional += 1));
    }
    return { obligatorio, opcional };
  };

  /** Tabla de documentos con dónde se piden (obligatorio, opcional o ningún nivel) y sus acciones. */
  function pintar() {
    const total = estado.niveles.length;
    const filas = estado.tipos.map((t) => {
      const { obligatorio, opcional } = resumenDe(t.id);
      const donde = !t.activo ? badge("Desactivado", "neutral")
        : !obligatorio && !opcional ? badge("No se pide en ningún nivel", "warning")
          : `${obligatorio ? badge(`Obligatorio en ${obligatorio} de ${total}`, "success") : ""} ${opcional ? badge(`Opcional en ${opcional}`, "info") : ""}`;
      return `<tr class="${t.activo ? "" : "muted"}"><td><strong>${escapar(t.nombre)}</strong><small>${escapar(t.descripcion || "Sin descripción")} · PDF hasta ${t.tamano_maximo_mb} MB</small></td><td>${donde}</td>
        <td><div class="row-actions"><button class="btn btn-secondary" type="button" data-req-niveles="${escapar(t.id)}" ${t.activo ? "" : "disabled"}>Niveles</button><button class="btn btn-secondary" type="button" data-req-editar="${escapar(t.id)}">Editar</button><button class="btn btn-secondary" type="button" data-req-activo="${escapar(t.id)}">${t.activo ? "Desactivar" : "Activar"}</button></div></td></tr>`;
    }).join("");
    pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Configuración</span><h2>Documentos requeridos</h2><p>Define qué documentos legales debe cargar el estudiante en cada nivel de práctica.</p></div><button class="btn btn-primary" type="button" data-req-nuevo>+ Nuevo documento</button></header>
      <section class="panel"><div class="table-wrap"><table class="dashboard-practices"><thead><tr><th>Documento</th><th>Dónde se pide</th><th>Acciones</th></tr></thead><tbody>${filas || `<tr><td colspan="3" class="muted">Aún no hay documentos.</td></tr>`}</tbody></table></div></section>
      <div class="notice"><span>Si agregas un documento <strong>obligatorio</strong>, los estudiantes con práctica sin terminar en ese nivel deberán cargarlo. Los archivos ya subidos nunca se borran, aunque dejes de pedir un documento.</span></div>`;
  }

  // ───────────── Crear / editar ─────────────
  /** Formulario para crear o editar un tipo de documento. Al crear uno nuevo abre enseguida la elección de niveles. */
  function formularioTipo(tipo) {
    const modal = openModal(tipo ? `Editar · ${escapar(tipo.nombre)}` : "Nuevo documento", `<form novalidate><div class="form-grid">
      <label class="field"><span>Nombre</span><input name="nombre" maxlength="120" value="${escapar(tipo?.nombre ?? "")}" placeholder="Certificado de EPS" required /></label>
      <label class="field"><span>Tamaño máximo (MB)</span><input type="number" name="mb" min="1" max="25" value="${tipo?.tamano_maximo_mb ?? 10}" required /></label>
      <label class="field" style="grid-column:1/-1"><span>Descripción (opcional)</span><textarea name="descripcion" maxlength="500" placeholder="Qué debe contener el documento">${escapar(tipo?.descripcion ?? "")}</textarea></label></div>
      <p class="muted">Los estudiantes cargan este documento en PDF.${tipo ? "" : " Después de crearlo, elige en qué niveles se pide."}</p>
      <p class="form-error" role="alert" data-form-error hidden></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">${tipo ? "Guardar cambios" : "Crear documento"}</button></div></form>`);
    const formulario = modal.querySelector("form");
    formulario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = formulario.querySelector("[data-form-error]");
      const cuerpo = { nombre: formulario.nombre.value.trim(), descripcion: formulario.descripcion.value.trim() || null, tamano_maximo_mb: Number(formulario.mb.value) };
      if (!cuerpo.nombre || !Number.isInteger(cuerpo.tamano_maximo_mb)) { error.textContent = "Escribe el nombre y un tamaño en MB (número entero)."; error.hidden = false; return; }
      const boton = formulario.querySelector("[type=submit]");
      boton.disabled = true;
      try {
        const { data } = tipo ? await api.patch(`/document-requirements/types/${tipo.id}`, cuerpo) : await api.post("/document-requirements/types", cuerpo);
        modal.remove();
        showToast(tipo ? "Documento actualizado" : "Documento creado");
        await cargar();
        if (!tipo) niveles(data.id);
      } catch (fallo) {
        error.textContent = mensaje(fallo); error.hidden = false; boton.disabled = false;
      }
    });
  }

  // ───────────── Niveles ─────────────
  /** Ventana para elegir, nivel por nivel, si el documento es obligatorio, opcional o no se pide. Si el servidor avisa que afecta a estudiantes en curso, pide confirmar. */
  function niveles(tipoId) {
    const tipo = estado.tipos.find((t) => t.id === tipoId);
    if (!tipo) return;
    const actual = (nivel) => nivel.requisitos.find((q) => q.tipo_id === tipoId);
    const valorDe = (nivel) => (actual(nivel) ? (actual(nivel).obligatorio ? "OBLIGATORIO" : "OPCIONAL") : "NO");
    const opcion = (v, etiqueta, sel) => `<option value="${v}" ${sel === v ? "selected" : ""}>${etiqueta}</option>`;
    const filas = estado.niveles.map((n) => `<label class="check-row" style="justify-content:space-between"><span>${escapar(n.nombre)}</span>
      <select data-req-nivel="${escapar(n.id)}">${opcion("NO", "No se pide", valorDe(n))}${opcion("OBLIGATORIO", "Obligatorio", valorDe(n))}${opcion("OPCIONAL", "Opcional", valorDe(n))}</select></label>`).join("");
    const modal = openModal(`Niveles · ${escapar(tipo.nombre)}`, `<form novalidate><p class="muted">Elige en qué niveles se pide este documento.</p>
      <div class="form-actions" style="justify-content:flex-start;margin:0 0 8px"><button class="btn btn-secondary" type="button" data-req-todos="OBLIGATORIO">Obligatorio en todos</button><button class="btn btn-secondary" type="button" data-req-todos="NO">Quitar de todos</button></div>
      ${filas}
      <label class="check-row" style="margin-top:10px;align-items:flex-start"><input type="checkbox" data-req-en-curso />
        <span><strong>Aplicar también a prácticas en curso</strong><br /><span class="muted">Si lo dejas sin marcar, un documento que pasa a ser obligatorio solo se exige a quienes aún no tienen su expediente aprobado. Las prácticas ya aprobadas, activas o por evaluar no se ven afectadas ni se les bloquea la bitácora.</span></span></label>
      <p class="form-error" role="alert" data-form-error hidden></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar</button></div></form>`);
    const formulario = modal.querySelector("form");
    const leer = () => Object.fromEntries([...formulario.querySelectorAll("[data-req-nivel]")].map((s) => [s.dataset.reqNivel, s.value]));
    let confirmar = false; // se activa cuando el servidor avisa que el cambio afecta a estudiantes en curso
    const reiniciarConfirmacion = () => { confirmar = false; formulario.querySelector("[type=submit]").textContent = "Guardar"; };
    formulario.addEventListener("change", reiniciarConfirmacion);
    formulario.addEventListener("click", (e) => {
      const b = e.target.closest("[data-req-todos]");
      if (b) { formulario.querySelectorAll("[data-req-nivel]").forEach((s) => { s.value = b.dataset.reqTodos; }); reiniciarConfirmacion(); }
    });
    formulario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = formulario.querySelector("[data-form-error]");
      const elegido = leer();
      const cuerpo = { niveles: Object.entries(elegido).filter(([, v]) => v !== "NO").map(([nivel_id, v]) => ({ nivel_id, obligatorio: v === "OBLIGATORIO" })), ...(confirmar ? { confirmar: true } : {}), ...(formulario.querySelector("[data-req-en-curso]").checked ? { aplicar_en_curso: true } : {}) };
      const boton = formulario.querySelector("[type=submit]");
      boton.disabled = true;
      try {
        const { data } = await api.put(`/document-requirements/types/${tipoId}/levels`, cuerpo);
        modal.remove();
        const exentas = data?.practicas_en_curso_exentas ?? 0;
        showToast(exentas > 0 ? `Niveles actualizados · ${exentas} práctica(s) en curso no se ven afectadas` : "Niveles actualizados");
        cargar();
      } catch (fallo) {
        if (fallo.code === "CONFIRMATION_REQUIRED") {
          confirmar = true;
          boton.textContent = "Confirmar y guardar";
        }
        error.textContent = mensaje(fallo); error.hidden = false; boton.disabled = false;
      }
    });
  }

  /** Activa o desactiva el documento en el servidor y recarga la lista. */
  async function cambiarActivo(tipo) {
    try {
      await api.patch(`/document-requirements/types/${tipo.id}`, { activo: !tipo.activo });
      showToast(tipo.activo ? "Documento desactivado" : "Documento activado");
      cargar();
    } catch (error) { showToast(mensaje(error)); }
  }

  /** Activar es inmediato; desactivar pide confirmación antes. */
  function alternarActivo(tipoId) {
    const tipo = estado.tipos.find((t) => t.id === tipoId);
    if (!tipo) return;
    if (!tipo.activo) { cambiarActivo(tipo); return; }
    const modal = openModal(`Desactivar «${escapar(tipo.nombre)}»`, `<div><p>Dejará de pedirse en todos los niveles. Los archivos que los estudiantes ya subieron se conservan, y puedes activarlo de nuevo cuando quieras.</p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-danger" type="button" data-req-confirmar-off>Desactivar</button></div></div>`);
    modal.querySelector("[data-req-confirmar-off]").addEventListener("click", () => { modal.remove(); cambiarActivo(tipo); });
  }

  /** Botones de la tabla: nuevo, editar, niveles, activar/desactivar y reintentar. */
  pagina.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-req-nuevo")) formularioTipo(null);
    else if (b.dataset.reqEditar) formularioTipo(estado.tipos.find((t) => t.id === b.dataset.reqEditar));
    else if (b.dataset.reqNiveles) niveles(b.dataset.reqNiveles);
    else if (b.dataset.reqActivo) alternarActivo(b.dataset.reqActivo);
    else if (b.hasAttribute("data-req-reintentar")) cargar();
  });
  cargar();
}

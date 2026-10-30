/**
 * Acciones del Director sobre una práctica ya creada: cambiar de institución o asesor (reasignar) y cancelarla.
 * Se usan desde Seguimiento y desde el detalle de la práctica. El docente supervisor no se elige aquí:
 * lo define el nivel en «Docentes por nivel».
 */
import { api } from "../services/api.js";

// Estados en los que la práctica todavía puede reasignarse o cancelarse.
export const ESTADOS_EDITABLES = ["PENDIENTE_DOCUMENTOS", "ACTIVA", "PENDIENTE_EVALUACION"];

const mensajeDeError = (error) => {
  const detalles = Array.isArray(error?.details) ? error.details.filter((d) => d?.mensaje).map((d) => `${d.campo ? `${d.campo}: ` : ""}${d.mensaje}`) : [];
  return [error?.message || "Ocurrió un error inesperado.", ...detalles].join(" · ");
};

/** Abre el formulario para cambiar institución y asesor de sitio de una práctica. `alTerminar` recarga la pantalla. */
export async function reasignarPractica(ui, asignacion, alTerminar) {
  const { escapar, openModal, showToast } = ui;
  let instituciones;
  try {
    instituciones = (await api.get("/institutions", { activa: "true", estado_convenio: "VIGENTE", page_size: 100 })).data;
  } catch (error) { showToast(mensajeDeError(error)); return; }
  if (!instituciones.length) {
    openModal("Cambiar institución o asesor", `<div><p>No hay instituciones activas con convenio vigente. Crea o habilita una en <strong>Gestión de Usuarios e Instituciones</strong>.</p><div class="form-actions"><button class="btn btn-primary" type="button" data-close>Entendido</button></div></div>`);
    return;
  }
  const actual = asignacion.institucion?.id;
  const inicial = instituciones.some((i) => i.id === actual) ? actual : instituciones[0].id;
  const modal = openModal(`Institución y asesor · ${escapar(asignacion.estudiante.nombre_completo)}`, `<form novalidate>
    <p class="muted">${escapar(asignacion.nivel.nombre)}. El docente supervisor lo define el nivel; aquí se cambia solo el lugar de práctica y su asesor.</p>
    <div class="form-grid">
      <label class="field"><span>Institución / sede</span><select name="institucion_id" data-institucion required>${instituciones.map((i) => `<option value="${escapar(i.id)}" ${i.id === inicial ? "selected" : ""}>${escapar(i.nombre)}${i.ciudad ? ` · ${escapar(i.ciudad)}` : ""}</option>`).join("")}</select></label>
      <label class="field"><span>Asesor de sitio</span><select name="asesor_sitio_id" data-asesor><option value="">Sin asignar por ahora</option></select><small>La lista depende de la institución elegida.</small></label>
    </div>
    <p class="form-error" role="alert" data-form-error hidden></p>
    <div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar cambios</button></div></form>`);
  const formulario = modal.querySelector("form");
  const selInstitucion = formulario.querySelector("[data-institucion]");
  const selAsesor = formulario.querySelector("[data-asesor]");
  const cargarAsesores = async () => {
    selAsesor.disabled = true;
    selAsesor.innerHTML = `<option value="">Cargando…</option>`;
    try {
      const { data } = await api.get(`/institutions/${selInstitucion.value}/advisors`);
      const asesores = data.filter((a) => a.activa !== false && a.estado === "ACTIVO");
      selAsesor.innerHTML = `<option value="">Sin asignar por ahora</option>${asesores.map((a) => `<option value="${escapar(a.asesor_id)}" ${asignacion.asesor?.id === a.asesor_id ? "selected" : ""}>${escapar(`${a.nombres} ${a.apellidos}`)}</option>`).join("")}`;
    } catch (error) {
      selAsesor.innerHTML = `<option value="">No se pudo cargar</option>`;
      showToast(mensajeDeError(error));
    }
    selAsesor.disabled = false;
  };
  cargarAsesores();
  selInstitucion.addEventListener("change", cargarAsesores);
  formulario.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = formulario.querySelector("[data-form-error]");
    const boton = formulario.querySelector("[type=submit]");
    error.hidden = true;
    boton.disabled = true;
    const cuerpo = { institucion_id: selInstitucion.value, asesor_sitio_id: selAsesor.value || null };
    try {
      await api.patch(`/practice-assignments/${asignacion.id}`, cuerpo);
      modal.remove();
      showToast("Institución y asesor actualizados");
      alTerminar?.();
    } catch (fallo) {
      error.textContent = mensajeDeError(fallo);
      error.hidden = false;
      boton.disabled = false;
    }
  });
}

/** Pide el motivo y cancela la práctica; si ya está en curso, el servidor pide una confirmación explícita. */
export function cancelarPractica(ui, asignacion, alTerminar, confirmar = false, motivoPrevio = "") {
  const { escapar, openModal, showToast } = ui;
  const modal = openModal(`Cancelar práctica · ${escapar(asignacion.estudiante.nombre_completo)}`, `<form novalidate><p class="muted">Se cancelará la práctica de ${escapar(asignacion.nivel.nombre)}${asignacion.institucion?.nombre ? ` en ${escapar(asignacion.institucion.nombre)}` : ""}. El estudiante podrá enviar una nueva solicitud.</p><label class="field"><span>Motivo (obligatorio)</span><textarea name="motivo" rows="3" required>${escapar(motivoPrevio)}</textarea></label><p class="form-error" role="alert" data-form-error hidden></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Volver</button><button class="btn btn-danger" type="submit">Cancelar práctica</button></div></form>`);
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
      showToast("Práctica cancelada");
      alTerminar?.();
    } catch (fallo) {
      if (fallo.code === "CONFIRMATION_REQUIRED") {
        modal.remove();
        const aviso = openModal("Confirmar cancelación", `<div><p>${escapar(fallo.message)}</p><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Volver</button><button class="btn btn-danger" type="button" data-confirmar>Cancelar de todas formas</button></div></div>`);
        aviso.querySelector("[data-confirmar]").addEventListener("click", () => { aviso.remove(); cancelarPractica(ui, asignacion, alTerminar, true, motivo); });
        return;
      }
      error.textContent = mensajeDeError(fallo);
      error.hidden = false;
      boton.disabled = false;
    }
  });
}

/**
 * "Docentes por nivel" del Director (flujo v2): un docente supervisor por nivel de práctica y periodo.
 * Un docente puede tener varios niveles. Sin docente en el nivel no se pueden asignar estudiantes de ese nivel.
 * Cambiar el docente no altera las prácticas que ya están asignadas.
 */
import { api } from "../services/api.js";

/**
 * @param {object} ui Utilidades compartidas: badge, escapar, showToast.
 */
export function montarDocentesNivel(ui) {
  const { badge, escapar, showToast } = ui;
  const pagina = document.querySelector(".page");
  const estado = { periodo: null, niveles: [], docentes: [], turno: 0 };
  /** Texto de error legible para mostrar al usuario. */
  const mensaje = (error) => error?.message || "Ocurrió un error inesperado.";
  /** Nombre completo del usuario (usa nombre_completo o nombres + apellidos). */
  const nombre = (u) => u.nombre_completo || `${u.nombres ?? ""} ${u.apellidos ?? ""}`.trim();

  /** Trae los niveles con su docente actual y los docentes supervisores activos; luego pinta la tabla. */
  async function cargar() {
    const turno = ++estado.turno;
    pagina.innerHTML = `<p class="muted practice-empty">Cargando niveles…</p>`;
    try {
      const [niveles, docentes] = await Promise.all([
        api.get("/level-teachers"),
        api.get("/users", { rol: "DOCENTE_SUPERVISOR", estado: "ACTIVO", page_size: 100 }),
      ]);
      if (turno !== estado.turno) return;
      estado.periodo = niveles.data.periodo;
      estado.niveles = niveles.data.niveles;
      estado.docentes = docentes.data;
      pintar();
    } catch (error) {
      if (turno === estado.turno) pagina.innerHTML = `<div class="practice-empty"><p class="form-error" role="alert">${escapar(mensaje(error))}</p><button class="btn btn-secondary" type="button" data-dn="reintentar">Reintentar</button></div>`;
    }
  }

  /** Tabla de niveles con el docente de cada uno. Señala los niveles con estudiantes que aún no tienen docente. */
  function pintar() {
    const sinDocente = estado.niveles.filter((n) => !n.docente && n.estudiantes > 0).length;
    const filas = estado.niveles.map((n) => {
      const opciones = [`<option value="">Sin docente</option>`, ...estado.docentes.map((d) => `<option value="${escapar(d.id)}" ${n.docente?.id === d.id ? "selected" : ""}>${escapar(nombre(d))}</option>`)].join("");
      const alerta = !n.docente && n.estudiantes > 0 ? badge("Falta docente", "warning") : n.docente ? badge("Configurado", "success") : badge("Sin estudiantes", "neutral");
      return `<tr><td><strong>${escapar(n.nivel.nombre)}</strong><small>${escapar(n.nivel.codigo)}</small></td><td>${n.estudiantes}</td>
        <td><label class="sr-only" for="dn-${escapar(n.nivel.id)}">Docente de ${escapar(n.nivel.nombre)}</label><select id="dn-${escapar(n.nivel.id)}" class="dn-select" data-dn-nivel="${escapar(n.nivel.id)}" data-previo="${escapar(n.docente?.id ?? "")}">${opciones}</select></td><td>${alerta}</td></tr>`;
    }).join("") || `<tr><td colspan="4"><div class="empty-state">No hay niveles de práctica configurados.</div></td></tr>`;
    pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Configuración académica · ${escapar(estado.periodo.codigo)}</span><h2>Docentes por nivel</h2><p>Cada nivel de práctica tiene un docente supervisor por periodo. Un mismo docente puede tener varios niveles.</p></div></header>
      ${sinDocente ? `<div class="notice notice-warning" role="status"><span>${sinDocente === 1 ? "Hay 1 nivel con estudiantes y sin docente." : `Hay ${sinDocente} niveles con estudiantes y sin docente.`} No se podrán asignar prácticas de esos niveles hasta configurarlo.</span></div>` : ""}
      <section class="panel"><div class="table-wrap"><table class="assignment-table"><thead><tr><th>Nivel de práctica</th><th>Estudiantes</th><th>Docente supervisor</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div>
      <footer class="pagination"><span>El cambio se guarda al elegir. Las prácticas ya asignadas conservan su docente.</span></footer></section>`;
  }

  pagina.addEventListener("click", (e) => { if (e.target.closest("[data-dn=reintentar]")) cargar(); });
  /** Guarda de inmediato el docente elegido para el nivel; si falla, devuelve el valor anterior. */
  pagina.addEventListener("change", async (e) => {
    const select = e.target.closest("[data-dn-nivel]");
    if (!select) return;
    const nivelId = select.dataset.dnNivel;
    select.disabled = true;
    try {
      await api.put(`/level-teachers/${nivelId}`, { docente_id: select.value || null });
      showToast(select.value ? "Docente del nivel guardado" : "Se quitó el docente del nivel");
      await cargar();
    } catch (error) {
      showToast(mensaje(error));
      select.value = select.dataset.previo;
      select.disabled = false;
    }
  });

  cargar();
}

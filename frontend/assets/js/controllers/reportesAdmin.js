/**
 * "Reportes" del Director: indicadores del periodo para autoevaluación y acreditación (MEN/CNA).
 * Descarga el detalle por práctica (CSV, abre en Excel) y el informe en PDF.
 * Las notas del docente y del asesor se muestran por separado: no hay promedio entre ambas.
 */
import { api } from "../services/api.js";

/** @param {object} ui Utilidades compartidas: badge, escapar, showToast. */
export function montarReportes(ui) {
  const { badge, escapar, showToast } = ui;
  const pagina = document.querySelector(".page");
  const estado = { periodos: [], periodoId: null, datos: null, turno: 0, descargando: false };
  const mensaje = (e) => e?.message || "Ocurrió un error inesperado.";
  const n = (v) => (v == null ? "—" : String(v).replace(".", ","));
  const pct = (v) => (v == null ? "—" : `${String(v).replace(".", ",")} %`);

  async function cargar() {
    const turno = ++estado.turno;
    pagina.innerHTML = `<p class="muted practice-empty">Cargando reportes…</p>`;
    try {
      if (!estado.periodos.length) {
        estado.periodos = (await api.get("/periods")).data;
        estado.periodoId = (estado.periodos.find((p) => p.es_activo) ?? estado.periodos[0])?.id ?? null;
      }
      const { data } = await api.get("/reports/summary", estado.periodoId ? { periodo_id: estado.periodoId } : {});
      if (turno !== estado.turno) return;
      estado.datos = data;
      pintar();
    } catch (error) {
      if (turno === estado.turno) pagina.innerHTML = `<div class="practice-empty"><p class="form-error" role="alert">${escapar(mensaje(error))}</p><button class="btn btn-secondary" type="button" data-rep-reintentar>Reintentar</button></div>`;
    }
  }

  const tarjeta = (titulo, valor, detalle, tono = "blue") => `<div class="stat-card"><span class="stat-icon ${tono}" aria-hidden="true"></span><div><span>${escapar(titulo)}</span><strong>${escapar(valor)}</strong><small>${escapar(detalle)}</small></div></div>`;
  const tabla = (columnas, filas, vacio) => `<div class="table-wrap"><table class="dashboard-practices"><thead><tr>${columnas.map((c) => `<th>${escapar(c)}</th>`).join("")}</tr></thead><tbody>${filas.length ? filas.join("") : `<tr><td colspan="${columnas.length}" class="muted">${escapar(vacio)}</td></tr>`}</tbody></table></div>`;
  const bloque = (titulo, ayuda, contenido) => `<section class="panel"><header class="panel-heading"><div><h3>${escapar(titulo)}</h3>${ayuda ? `<p>${escapar(ayuda)}</p>` : ""}</div></header>${contenido}</section>`;

  function pintar() {
    const d = estado.datos;
    const opciones = estado.periodos.map((p) => `<option value="${escapar(p.id)}" ${p.id === estado.periodoId ? "selected" : ""}>${escapar(p.codigo)}${p.es_activo ? " (activo)" : ""}</option>`).join("");
    const ev = d.evaluaciones;
    const filasNivel = d.por_nivel.map((x) => `<tr><td><strong>${escapar(x.nombre)}</strong></td><td>${x.estudiantes}</td><td>${x.en_marcha}</td><td>${x.finalizadas}</td><td>${pct(x.porcentaje_finalizadas)}</td><td>${x.bitacoras_enviadas}</td></tr>`);
    const filaNota = (titulo, e) => `<tr><td><strong>${titulo}</strong></td><td>${e.publicadas}</td><td>${n(e.promedio)}</td><td>${n(e.minima)}</td><td>${n(e.maxima)}</td><td>${e.por_debajo_de_3}</td></tr>`;
    const filasEvaluadores = d.evaluadores.map((e) => `<tr><td><strong>${escapar(e.nombre)}</strong></td><td>${escapar(e.rol)}</td><td>${e.estudiantes}</td><td>${e.publicadas}</td><td>${n(e.promedio)}</td></tr>`);
    const filasInst = d.instituciones.map((i) => `<tr><td><strong>${escapar(i.nombre)}</strong><small>${escapar(i.ciudad)}</small></td><td>${badge(i.convenio_etiqueta, i.convenio === "VIGENTE" ? "success" : "warning")}</td><td>${i.estudiantes}</td><td>${i.asesores}</td></tr>`);
    pagina.innerHTML = `<header class="page-title"><div><span class="eyebrow">Autoevaluación y acreditación</span><h2>Reportes</h2><p>Indicadores del periodo para los informes MEN/CNA. Las notas son las publicadas y se muestran por separado.</p></div>
        <div class="form-actions" style="margin:0"><label class="field" style="min-width:140px"><span>Periodo</span><select data-rep-periodo>${opciones}</select></label>
        <button class="btn btn-secondary" type="button" data-rep-descargar="practices.csv">Descargar detalle (Excel)</button><button class="btn btn-primary" type="button" data-rep-descargar="summary.pdf">Informe PDF</button></div></header>
      <section class="stats-grid">
        ${tarjeta("Estudiantes matriculados", String(d.cobertura.estudiantes_matriculados), `${d.cobertura.sin_practica} sin práctica iniciada`)}
        ${tarjeta("Con práctica iniciada", pct(d.cobertura.porcentaje_con_practica), `${d.cobertura.con_practica} estudiantes · ${d.cobertura.solicitudes_en_tramite} solicitudes en trámite`, "green")}
        ${tarjeta("Prácticas finalizadas", pct(d.finalizacion.porcentaje_finalizadas), `${d.finalizacion.finalizadas} de ${d.finalizacion.practicas}`, "green")}
        ${tarjeta("Expedientes aprobados", pct(d.documentos.porcentaje_aprobados), `${d.documentos.total} documentos vigentes`, "orange")}
      </section>
      ${bloque("Por nivel de práctica", "Estudiantes con práctica iniciada o finalizada en el periodo.", tabla(["Nivel", "Estudiantes", "En marcha", "Finalizadas", "% finalizadas", "Bitácoras enviadas"], filasNivel, "Sin niveles."))}
      ${bloque("Evaluaciones publicadas", "Nota académica (docente) y nota de sitio (asesor), cada una por separado.", tabla(["Evaluación", "Publicadas", "Promedio", "Mínima", "Máxima", "Menores a 3,0"], [filaNota("Nota académica · docente supervisor", ev.docente), filaNota("Nota de sitio · asesor", ev.asesor)], ""))}
      ${bloque("Docentes y asesores", "Estudiantes que evalúa cada uno y lo que ya publicó.", tabla(["Evaluador", "Rol", "Estudiantes", "Publicadas", "Promedio"], filasEvaluadores, "Aún no hay evaluadores con estudiantes en el periodo."))}
      ${bloque("Instituciones receptoras", "Con prácticas en el periodo y estado de su convenio.", tabla(["Institución", "Convenio", "Estudiantes", "Asesores"], filasInst, "Aún no hay instituciones con prácticas iniciadas."))}`;
  }

  async function descargar(archivo, boton) {
    if (estado.descargando) return;
    estado.descargando = true;
    boton.disabled = true;
    try {
      const consulta = estado.periodoId ? `?periodo_id=${encodeURIComponent(estado.periodoId)}` : "";
      await api.descargar(`/reports/${archivo}${consulta}`, archivo === "summary.pdf" ? "informe-practicas.pdf" : "practicas.csv");
    } catch (error) {
      showToast(mensaje(error));
    } finally {
      estado.descargando = false;
      boton.disabled = false;
    }
  }

  pagina.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.repDescargar) descargar(b.dataset.repDescargar, b);
    else if (b.hasAttribute("data-rep-reintentar")) cargar();
  });
  pagina.addEventListener("change", (e) => {
    if (e.target.matches("[data-rep-periodo]")) { estado.periodoId = e.target.value; cargar(); }
  });
  cargar();
}

/**
 * Reportes de gestión para autoevaluación y acreditación (MEN/CNA): resumen del periodo, detalle en CSV y PDF.
 * Solo el Director. Las notas son las publicadas y se muestran por separado (docente y asesor, sin promedio entre ambas).
 */
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import * as periodRepository from "../repositories/periodRepository.js";
import * as reportRepository from "../repositories/reportRepository.js";
import { ApiError } from "../utils/apiError.js";
import { DocumentoPdf } from "../utils/pdf.js";

const ZONA = "America/Bogota";
const ESTADO = {
  ENVIADA: "Solicitud enviada", DEVUELTA: "Solicitud devuelta", DOCUMENTOS_APROBADOS: "Documentos aprobados", PLAZA_SELECCIONADA: "Plaza elegida",
  PENDIENTE_DOCUMENTOS: "Pendiente de documentos", ACTIVA: "En curso", PENDIENTE_EVALUACION: "Pendiente de evaluación", FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada", RECHAZADA: "Rechazada",
};
const DOC_ESTADO = { EN_REVISION: "En revisión", APROBADO: "Aprobado", RECHAZADO: "Rechazado", PENDIENTE: "Pendiente" };
const CONVENIO = { VIGENTE: "Vigente", EN_TRAMITE: "En trámite", SUSPENDIDO: "Suspendido", VENCIDO: "Vencido" };
const BITACORA = { BLOQUEADA: "Bloqueada", BORRADOR: "Borrador", DEVUELTA: "Devuelta", ENVIADA: "Enviada", EN_EVALUACION: "En evaluación", EVALUADA: "Evaluada" };

const porcentaje = (parte, total) => (total ? Math.round((parte / total) * 1000) / 10 : null);

async function resolverPeriodo(periodoId) {
  const periodo = periodoId ? await periodRepository.buscarPorId(periodoId) : (await periodRepository.buscarActivo()) ?? (await periodRepository.listar())[0];
  if (!periodo) throw ApiError.noEncontrado(periodoId ? "El periodo no existe." : "Aún no hay periodos.", "PERIOD_NOT_FOUND");
  return periodo;
}

/** Indicadores del periodo (por defecto el activo). */
export async function resumen({ periodo_id } = {}) {
  const periodo = await resolverPeriodo(periodo_id);
  const [cob, estados, niveles, notas, evaluadores, insts, convenios, docs] = await Promise.all([
    reportRepository.cobertura(periodo.id), reportRepository.porEstado(periodo.id), reportRepository.porNivel(periodo.id),
    reportRepository.notasPorTipo(periodo.id), reportRepository.porEvaluador(periodo.id), reportRepository.instituciones(periodo.id),
    reportRepository.conveniosPorEstado(), reportRepository.documentos(periodo.id),
  ]);
  const finalizadas = estados.find((e) => e.estado === "FINALIZADA")?.total ?? 0;
  const nota = (tipo) => notas.find((n) => n.tipo === tipo) ?? { publicadas: 0, promedio: null, minima: null, maxima: null, por_debajo_de_3: 0 };
  const docsTotal = docs.reduce((s, d) => s + d.total, 0);
  return {
    periodo: { id: periodo.id, codigo: periodo.codigo, nombre: periodo.nombre, estado: periodo.estado },
    generado_en: new Date().toISOString(),
    cobertura: {
      estudiantes_matriculados: cob.matriculados, con_practica: cob.con_practica, sin_practica: Math.max(cob.matriculados - cob.con_practica, 0),
      porcentaje_con_practica: porcentaje(cob.con_practica, cob.matriculados), solicitudes_en_tramite: cob.en_tramite, solicitudes_rechazadas_o_canceladas: cob.rechazadas_o_canceladas,
    },
    finalizacion: { practicas: cob.con_practica, finalizadas, porcentaje_finalizadas: porcentaje(finalizadas, cob.con_practica) },
    por_estado: estados.map((e) => ({ estado: e.estado, etiqueta: ESTADO[e.estado] ?? e.estado, total: e.total })),
    por_nivel: niveles.map((n) => ({ ...n, porcentaje_finalizadas: porcentaje(n.finalizadas, n.estudiantes) })),
    evaluaciones: { docente: nota("DOCENTE_SUPERVISOR"), asesor: nota("ASESOR_SITIO") },
    evaluadores: evaluadores.map((e) => ({ ...e, rol: e.tipo === "DOCENTE_SUPERVISOR" ? "Docente supervisor" : "Asesor de sitio" })),
    instituciones: insts.map((i) => ({ ...i, convenio_etiqueta: CONVENIO[i.convenio] ?? i.convenio })),
    convenios: convenios.map((c) => ({ estado: c.estado, etiqueta: CONVENIO[c.estado] ?? c.estado, total: c.total })),
    documentos: { total: docsTotal, por_estado: docs.map((d) => ({ estado: d.estado, etiqueta: DOC_ESTADO[d.estado] ?? d.estado, total: d.total })),
      porcentaje_aprobados: porcentaje(docs.find((d) => d.estado === "APROBADO")?.total ?? 0, docsTotal) },
  };
}

// ───────────── CSV ─────────────
const celda = (v) => {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // evita que Excel interprete el texto como fórmula
  return /[",;\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const fechaCorta = (v) => (v ? new Date(v).toLocaleDateString("es-CO", { timeZone: ZONA }) : "");

/** Detalle por práctica en CSV (UTF-8 con BOM, separador «;» para que Excel en español lo abra en columnas). */
export async function detalleCsv({ periodo_id } = {}, contexto) {
  const periodo = await resolverPeriodo(periodo_id);
  const filas = await reportRepository.detalle(periodo.id);
  const encabezado = ["Documento", "Estudiante", "Semestre", "Nivel de práctica", "Institución", "Ciudad", "Docente supervisor", "Asesor de sitio", "Estado de la práctica", "Estado de la bitácora", "Bitácora enviada", "Nota docente", "Nota asesor"];
  const lineas = filas.map((f) => [f.documento, f.estudiante, f.semestre, f.nivel, f.institucion, f.ciudad, f.docente, f.asesor, ESTADO[f.estado] ?? f.estado, BITACORA[f.bitacora] ?? "", fechaCorta(f.bitacora_enviada_en), f.nota_docente, f.nota_asesor]);
  await registrarAuditoria({ contexto, accion: "REPORTE_EXPORTADO", entidad: "periodos_academicos", entidad_id: periodo.id, valor_nuevo: { formato: "CSV", filas: filas.length } });
  const contenido = `﻿${[encabezado, ...lineas].map((l) => l.map(celda).join(";")).join("\r\n")}\r\n`;
  return { contenido: Buffer.from(contenido, "utf8"), nombre_archivo: `practicas-${periodo.codigo}.csv` };
}

// ───────────── PDF ─────────────
const num = (v) => (v == null ? "—" : String(v));
const pct = (v) => (v == null ? "—" : `${v} %`);

/** Resumen del periodo en PDF, listo para anexar a informes de autoevaluación. */
export async function resumenPdf({ periodo_id } = {}, contexto) {
  const r = await resumen({ periodo_id });
  const doc = new DocumentoPdf({ titulo: `Informe de prácticas ${r.periodo.codigo}`, autor: "Sistema de Gestión de Prácticas Pedagógicas UDI", pie: "Informe generado por el sistema" });
  doc.titulo(`Informe de prácticas pedagógicas · ${r.periodo.codigo}`);
  doc.parrafo(`${r.periodo.nombre} · Generado el ${new Date(r.generado_en).toLocaleString("es-CO", { timeZone: ZONA })}`);
  doc.seccion("Cobertura");
  doc.campo("Estudiantes matriculados", num(r.cobertura.estudiantes_matriculados));
  doc.campo("Con práctica iniciada", `${num(r.cobertura.con_practica)} (${pct(r.cobertura.porcentaje_con_practica)})`);
  doc.campo("Sin práctica", num(r.cobertura.sin_practica));
  doc.campo("Solicitudes en trámite (aún no inician)", num(r.cobertura.solicitudes_en_tramite));
  doc.campo("Solicitudes rechazadas o canceladas", num(r.cobertura.solicitudes_rechazadas_o_canceladas));
  doc.campo("Prácticas finalizadas", `${num(r.finalizacion.finalizadas)} de ${num(r.finalizacion.practicas)} (${pct(r.finalizacion.porcentaje_finalizadas)})`);
  doc.seccion("Prácticas por estado");
  r.por_estado.forEach((e) => doc.campo(e.etiqueta, num(e.total)));
  doc.seccion("Por nivel de práctica");
  r.por_nivel.forEach((n) => doc.parrafo(`${n.nombre}: ${n.estudiantes} estudiantes · ${n.finalizadas} finalizadas (${pct(n.porcentaje_finalizadas)}) · ${n.en_marcha} en marcha · ${n.bitacoras_enviadas} bitácoras enviadas`));
  doc.seccion("Evaluaciones publicadas (cada una por separado, sin promedio entre ambas)");
  for (const [titulo, e] of [["Nota académica (docente supervisor)", r.evaluaciones.docente], ["Nota de sitio (asesor)", r.evaluaciones.asesor]]) {
    doc.parrafo(`${titulo}: ${e.publicadas} publicadas · promedio ${num(e.promedio)} · mínima ${num(e.minima)} · máxima ${num(e.maxima)} · ${e.por_debajo_de_3} por debajo de 3,0`);
  }
  doc.seccion("Evaluadores");
  r.evaluadores.forEach((e) => doc.parrafo(`${e.nombre} (${e.rol}): ${e.estudiantes} estudiantes · ${e.publicadas} evaluaciones publicadas · promedio ${num(e.promedio)}`));
  doc.seccion("Instituciones receptoras");
  r.instituciones.forEach((i) => doc.parrafo(`${i.nombre} (${i.ciudad}) · convenio ${i.convenio_etiqueta}${i.fin_convenio ? ` hasta ${fechaCorta(i.fin_convenio)}` : ""} · ${i.estudiantes} estudiantes · ${i.asesores} asesor(es)`));
  doc.seccion("Expedientes documentales");
  doc.campo("Documentos vigentes", num(r.documentos.total));
  doc.campo("Aprobados", pct(r.documentos.porcentaje_aprobados));
  await registrarAuditoria({ contexto, accion: "REPORTE_EXPORTADO", entidad: "periodos_academicos", entidad_id: r.periodo.id, valor_nuevo: { formato: "PDF" } });
  return { contenido: doc.generar(), nombre_archivo: `informe-practicas-${r.periodo.codigo}.pdf` };
}

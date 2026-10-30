/**
 * Servicio del dashboard.
 * Arma los indicadores y la tabla de seguimiento de prácticas según el rol activo:
 * el Director ve todo, el Docente y el Asesor solo lo suyo, y el Estudiante su propia práctica.
 */
import * as assignmentRepository from "../repositories/assignmentRepository.js";
import * as dashboardRepository from "../repositories/dashboardRepository.js";
import * as documentRepository from "../repositories/documentRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";
import { ApiError } from "../utils/apiError.js";
import { ROLES } from "../utils/constants.js";
import { alcancePorRol } from "./logbookService.js";

const { mapearAsignacion } = assignmentRepository;

// Tipo de evaluación que corresponde a cada rol evaluador.
const TIPO_POR_ROL = Object.freeze({
  [ROLES.DOCENTE_SUPERVISOR]: "DOCENTE_SUPERVISOR",
  [ROLES.ASESOR_SITIO]: "ASESOR_SITIO",
});
// Estados de bitácora en los que ya fue enviada por el estudiante.
const BITACORA_ENVIADA = ["ENVIADA", "EN_EVALUACION", "EVALUADA"];

/** El periodo pedido (404 si no existe) o el activo; sin ninguno de los dos no se filtra por periodo. */
async function resolverPeriodo(periodoId) {
  if (periodoId) {
    const periodo = await periodRepository.buscarPorId(periodoId);
    if (!periodo) throw ApiError.noEncontrado("El periodo académico no existe.", "PERIOD_NOT_FOUND");
    return periodo;
  }
  return (await periodRepository.buscarActivo()) ?? null;
}

// Reduce un periodo a los campos que necesita el frontend.
const armarPeriodo = (p) => (p ? { id: p.id, codigo: p.codigo, nombre: p.nombre, estado: p.estado } : null);

/**
 * Qué muestra una evaluación en la tabla. La nota solo aparece publicada (el borrador es de su autor y se consulta en
 * /evaluations). El estudiante nunca ve estados internos: lo no publicado es "PENDIENTE".
 */
function armarEvaluacion(estado, nota, publicadaEn, rol) {
  if (!estado) return null;
  const publicada = estado === "PUBLICADA";
  return {
    estado: rol === ROLES.ESTUDIANTE && !publicada ? "PENDIENTE" : estado,
    nota: publicada ? nota : null,
    publicada_en: publicada ? publicadaEn : null,
  };
}

/** Fila de la tabla de seguimiento, ajustada a lo que el rol puede ver (guía §11 y matriz de permisos). */
export function armarFilaPractica(fila, rol) {
    // Docente y Asesor: ven su propia evaluación y un estado simple de la bitácora.
  const evaluador = rol in TIPO_POR_ROL;
  const docente = armarEvaluacion(fila.docente_eval_estado, fila.docente_eval_nota, fila.docente_eval_publicada_en, rol);
  const asesor = armarEvaluacion(fila.asesor_eval_estado, fila.asesor_eval_nota, fila.asesor_eval_publicada_en, rol);

  const resultado = { ...mapearAsignacion(fila) };
  const enviada = BITACORA_ENVIADA.includes(fila.bitacora_estado);

  if (evaluador) {
    // Docente y asesor: sin expediente legal, solo su propia evaluación y un estado simple de la bitácora.
    const propia = TIPO_POR_ROL[rol] === "DOCENTE_SUPERVISOR" ? docente : asesor;
    resultado.bitacora = { id: enviada ? fila.bitacora_id : null, estado: enviada ? fila.bitacora_estado : "EN_DESARROLLO", enviada_en: enviada ? fila.enviada_en : null };
    resultado.mi_evaluacion = propia ?? { estado: "SIN_ENTREGA", nota: null, publicada_en: null };
    return resultado;
  }

    // Director y Estudiante: ven bitácora, estado del expediente legal y evaluaciones.
  resultado.bitacora = fila.bitacora_id ? { id: fila.bitacora_id, estado: fila.bitacora_estado, enviada_en: fila.enviada_en } : null;
  resultado.documentos = { estado: fila.expediente_estado, aprobados: fila.aprobados_obligatorios, total: fila.total_obligatorios };
  resultado.evaluaciones = { docente, asesor };
    // Estado global: SIN_ENTREGA, PENDIENTE, PARCIAL (una evaluación publicada) o COMPLETA (ambas).
  const publicadas = [docente, asesor].filter((e) => e?.estado === "PUBLICADA").length;
  resultado.evaluacion_global = !docente && !asesor ? "SIN_ENTREGA" : publicadas === 2 ? "COMPLETA" : publicadas === 1 ? "PARCIAL" : "PENDIENTE";
  return resultado;
}

/** Tabla de seguimiento: filas filtradas por el alcance del rol y paginadas. */
export async function listarPracticas(filtros, auth) {
  const { page_size: _p, page: _pg, todos_los_periodos: todos, ...criterios } = filtros;
  const periodo = todos && !filtros.periodo_id ? null : await resolverPeriodo(filtros.periodo_id);
  const { filas, total } = await dashboardRepository.listarPracticas(
    { ...criterios, periodo_id: periodo?.id },
    alcancePorRol(auth),
    { limit: filtros.limit, offset: filtros.offset }
  );
  return { filas: filas.map((f) => armarFilaPractica(f, auth.rolActivo)), total, periodo: armarPeriodo(periodo) };
}

/** Indicadores y alertas del rol activo para el periodo (activo si no se indica otro). */
export async function resumen({ periodo_id }, auth) {
  const periodo = await resolverPeriodo(periodo_id);
  const periodoId = periodo?.id ?? null;
  const base = { rol: auth.rolActivo, periodo: armarPeriodo(periodo) };

    // Director: contadores de prácticas, evaluaciones, instituciones y expedientes, más alertas.
  if (auth.rolActivo === ROLES.DIRECTOR_PROGRAMA) {
    const [practicas, evaluaciones, instituciones, { resumen: expedientes }] = await Promise.all([
      dashboardRepository.contarPracticas({ periodoId }),
      dashboardRepository.contarEvaluaciones({ periodoId }),
      dashboardRepository.contarInstituciones(),
      documentRepository.listarExpedientes({ periodo_id: periodoId ?? undefined, limit: 1, offset: 0 }),
    ]);
    return {
      ...base,
      indicadores: {
        practicas_activas: practicas.activas,
        practicas_finalizadas: practicas.finalizadas,
        expedientes_completos: expedientes.completos,
        practicas_en_evaluacion: practicas.en_evaluacion,
        evaluaciones_pendientes: evaluaciones.sin_publicar,
        evaluaciones_publicadas: evaluaciones.publicadas,
        instituciones_activas: instituciones.activas,
      },
      alertas: {
        expedientes_por_auditar: expedientes.en_revision,
        expedientes_por_corregir: expedientes.por_corregir,
        practicas_sin_docente: practicas.sin_docente,
        practicas_sin_asesor: practicas.sin_asesor,
        convenios_en_tramite: instituciones.convenios_en_tramite,
      },
    };
  }

    // Docente y Asesor: contadores de sus estudiantes y evaluaciones.
  const tipo = TIPO_POR_ROL[auth.rolActivo];
  if (tipo) {
    const c = await dashboardRepository.contarDeEvaluador({ periodoId, tipo }, alcancePorRol(auth));
    return {
      ...base,
      indicadores: {
        estudiantes: c.estudiantes,
        en_desarrollo: c.en_desarrollo,
        pendientes: c.pendientes,
        en_borrador: c.en_borrador,
        evaluados: c.publicadas,
      },
    };
  }

    // Estudiante: su práctica del periodo (o null si no tiene una).
  // Estudiante: su práctica del periodo (o null si no tiene una).
  const { filas } = await dashboardRepository.listarPracticas({ periodo_id: periodoId ?? undefined }, alcancePorRol(auth), { limit: 1, offset: 0 });
  return { ...base, practica: filas[0] ? armarFilaPractica(filas[0], auth.rolActivo) : null };
}

// ───────────────────────── Acciones inmediatas ─────────────────────────

/** Una tarjeta de acción: qué hacer, cuántos casos hay, qué tan urgente es y a qué pantalla lleva. */
const tarjeta = (codigo, titulo, total, tipo, destino, casos = [], suma = true) => ({ codigo, titulo, total, tipo, destino, casos, suma });

// Umbrales de las tarjetas de Dirección (ajustables): días y cantidades a partir de los cuales algo se considera atrasado.
export const UMBRALES = Object.freeze({
  DIAS_DEVUELTA_SIN_RESPUESTA: 5,
  DIAS_SIN_AVANCE_DE_BITACORA: 7, // días desde el inicio de la práctica sin que el estudiante abra su bitácora
  MAX_PRACTICANTES_POR_ASESOR: 5,
  DIAS_AVISO_CIERRE_DE_PERIODO: 15,
  CASOS_POR_TARJETA: 3,
});

const nombreCompleto = (fila) => `${fila.nombres} ${fila.apellidos}`.trim();
const plural = (n, singular, plural_) => (n === 1 ? singular : plural_);
/** Un caso concreto dentro de una tarjeta: a quién se refiere, el detalle y a qué pantalla lleva. */
const caso = (id, titulo, detalle, destino) => ({ id, titulo, detalle, destino: { ...destino, id } });
const haceDias = (n) => (n === 0 ? "hoy" : `hace ${n} ${plural(n, "día", "días")}`);

/** Días que faltan para una fecha (columna `date` de PostgreSQL, como Date o texto «AAAA-MM-DD»), contando días de calendario. */
function diasHasta(fecha, hoy = new Date()) {
  const [y, m, d] = typeof fecha === "string" ? fecha.slice(0, 10).split("-").map(Number) : [fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate()];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
}

/**
 * "Qué hay que hacer ahora" según el rol (Director o Docente). Devuelve todas las tarjetas del rol con su total;
 * `pendientes` suma solo las de tipo "accion" (las informativas, tipo "info", no cuentan como trabajo pendiente). Las tarjetas no se
 * califican como urgentes o importantes: eso es subjetivo y lo decide quien las lee; se entregan en el orden del flujo.
 */
export async function acciones({ periodo_id }, auth) {
  const periodo = await resolverPeriodo(periodo_id);
  if (!periodo) throw ApiError.noEncontrado("No hay un periodo activo.", "PERIOD_NOT_FOUND");
  const base = { rol: auth.rolActivo, periodo: armarPeriodo(periodo) };
  let tarjetas;

  if (auth.rolActivo === ROLES.DIRECTOR_PROGRAMA) {
    const U = UMBRALES;
    const limite = U.CASOS_POR_TARJETA;
    const periodoId = periodo.id;
    const [p, niveles, instituciones, practicas, porRevisar, listasAsignar, sinSolicitud, devueltas, sinAsesorPlaza, listasCerrar, sinAvance, sobrecargados, sinEnviar] = await Promise.all([
      dashboardRepository.contarPendientesDeDireccion({ periodoId }),
      dashboardRepository.configuracionDeNiveles({ periodoId }),
      dashboardRepository.contarInstituciones(),
      dashboardRepository.contarPracticas({ periodoId }),
      dashboardRepository.solicitudesPorEtapa({ periodoId, completo: false, limite }),
      dashboardRepository.solicitudesPorEtapa({ periodoId, completo: true, limite }),
      dashboardRepository.estudiantesSinSolicitud({ periodoId, limite }),
      dashboardRepository.devueltasSinRespuesta({ periodoId, dias: U.DIAS_DEVUELTA_SIN_RESPUESTA, limite }),
      dashboardRepository.solicitudesSinAsesorEnPlaza({ periodoId, limite }),
      dashboardRepository.practicasListasParaCerrar({ periodoId, limite }),
      dashboardRepository.practicasSinAvanceDeBitacora({ periodoId, dias: U.DIAS_SIN_AVANCE_DE_BITACORA, limite }),
      dashboardRepository.asesoresSobrecargados({ periodoId, maximo: U.MAX_PRACTICANTES_POR_ASESOR, limite }),
      dashboardRepository.bitacorasSinEnviar({ periodoId, limite }),
    ]);
    // Un nivel sin docente solo es tarea si ya tiene estudiantes matriculados en el periodo.
    const sinDocente = niveles.filter((n) => !n.docente_id && n.estudiantes > 0);
    const conDocente = niveles.filter((n) => n.docente_id);
    const enSolicitudes = (f, detalle) => caso(f.id, nombreCompleto(f), detalle(f), { pantalla: "solicitudes" });
    const enPractica = (f, detalle, pestana) => caso(f.id, nombreCompleto(f), detalle(f), { pantalla: "practica", ...(pestana ? { pestana } : {}) });
    const esperando = (f) => `${f.nivel} · enviada ${haceDias(f.dias)}`;

    // El aviso de cierre solo aparece cuando el periodo está por terminar y quedan bitácoras sin enviar.
    const diasParaCierre = periodo.fecha_fin ? diasHasta(periodo.fecha_fin) : null;
    const cierreCerca = diasParaCierre !== null && diasParaCierre >= 0 && diasParaCierre <= U.DIAS_AVISO_CIERRE_DE_PERIODO;
    const tarjetaCierre = tarjeta(
      "CIERRE_DE_PERIODO",
      cierreCerca ? `Bitácoras sin enviar: el periodo cierra ${diasParaCierre === 0 ? "hoy" : `en ${diasParaCierre} ${plural(diasParaCierre, "día", "días")}`}` : "Bitácoras sin enviar antes del cierre del periodo",
      cierreCerca ? sinEnviar.total : 0,
      "accion",
      { pantalla: "seguimiento" },
      sinEnviar.casos.map((f) => enPractica(f, (x) => `${x.nivel} · bitácora sin enviar`)),
      false // ya está contada en «sin avance de bitácora» o en las prácticas activas
    );

    tarjetas = [
      tarjeta("DOCUMENTOS_POR_REVISAR", "Solicitudes con documentos por revisar", p.documentos_por_revisar, "accion", { pantalla: "solicitudes", filtro: { estado: "ENVIADA" } }, porRevisar.casos.map((f) => enSolicitudes(f, esperando))),
      tarjeta("SOLICITUDES_LISTAS_PARA_ASIGNAR", "Solicitudes con documentos aprobados, listas para validar la plaza y asignar", p.listas_para_asignar, "accion", { pantalla: "solicitudes", filtro: { estado: "ENVIADA" } }, listasAsignar.casos.map((f) => enSolicitudes(f, esperando))),
      tarjeta("PRACTICAS_LISTAS_PARA_CERRAR", "Prácticas listas para finalizar", p.listas_para_cerrar, "accion", { pantalla: "seguimiento", filtro: { grupo: "EN_EVALUACION" } }, listasCerrar.casos.map((f) => enPractica(f, (x) => `${x.nivel} · evaluaciones publicadas ${haceDias(x.dias)}`, "evaluaciones"))),
      tarjeta("SOLICITUDES_SIN_ASESOR_EN_PLAZA", "Solicitudes que piden una institución sin asesor de sitio", sinAsesorPlaza.total, "accion", { pantalla: "solicitudes", filtro: { estado: "ENVIADA" } }, sinAsesorPlaza.casos.map((f) => enSolicitudes(f, (x) => `Pide ${x.institucion}`))),
      tarjeta("NIVELES_SIN_DOCENTE", "Niveles sin docente asignado", sinDocente.length, "accion", { pantalla: "docentes_nivel", filtro: { nivel_ids: sinDocente.map((n) => n.nivel_id) } }),
      tarjetaCierre,
      tarjeta("ESTUDIANTES_SIN_SOLICITUD", "Estudiantes matriculados que aún no envían su solicitud", sinSolicitud.total, "accion", { pantalla: "usuarios", filtro: { rol: "ESTUDIANTE", practica: "SIN_SOLICITUD" } }, sinSolicitud.casos.map((f) => caso(f.id, nombreCompleto(f), `${f.semestre}° semestre`, { pantalla: "perfil" }))),
      tarjeta("DEVUELTAS_SIN_RESPUESTA", `Solicitudes devueltas hace más de ${U.DIAS_DEVUELTA_SIN_RESPUESTA} días sin respuesta del estudiante`, devueltas.total, "accion", { pantalla: "solicitudes", filtro: { estado: "DEVUELTA" } }, devueltas.casos.map((f) => enSolicitudes(f, (x) => `${x.nivel} · devuelta ${haceDias(x.dias)}`))),
      tarjeta("PRACTICAS_SIN_AVANCE_DE_BITACORA", `Prácticas activas cuyo estudiante no ha abierto su bitácora tras ${U.DIAS_SIN_AVANCE_DE_BITACORA} días`, sinAvance.total, "accion", { pantalla: "seguimiento", filtro: { grupo: "EN_CURSO" } }, sinAvance.casos.map((f) => enPractica(f, (x) => `${x.nivel} · inició ${haceDias(x.dias)}`))),
      tarjeta("ASESORES_SOBRECARGADOS", `Asesores de sitio con más de ${U.MAX_PRACTICANTES_POR_ASESOR} practicantes`, sobrecargados.total, "accion", { pantalla: "usuarios", filtro: { rol: "ASESOR_SITIO" } }, sobrecargados.casos.map((f) => caso(f.id, nombreCompleto(f), `${f.practicantes} practicantes · ${f.institucion}`, { pantalla: "asesor_perfil" }))),
      tarjeta("NIVELES_SIN_CUESTIONARIO", "Niveles con docente pero sin cuestionario habilitado", conDocente.filter((n) => !n.tiene_cuestionario).length, "accion", { pantalla: "cuestionarios" }),
      tarjeta("NIVELES_SIN_GUIA", "Niveles con docente pero sin guía de criterios", conDocente.filter((n) => !n.tiene_guia).length, "accion", { pantalla: "docentes_nivel" }),
      tarjeta("PRACTICAS_SIN_ASESOR", "Prácticas activas sin asesor de sitio", practicas.sin_asesor, "accion", { pantalla: "seguimiento", filtro: { grupo: "VIGENTES" } }),
      tarjeta("CONVENIOS_EN_TRAMITE", "Convenios en trámite", instituciones.convenios_en_tramite, "info", { pantalla: "instituciones", filtro: { convenio: "EN_TRAMITE" } }),
      tarjeta("SOLICITUDES_DEVUELTAS", "Solicitudes devueltas, esperando al estudiante", p.devueltas_al_estudiante, "info", { pantalla: "solicitudes", filtro: { estado: "DEVUELTA" } }),
    ];
  } else if (auth.rolActivo === ROLES.DOCENTE_SUPERVISOR) {
    const [propios, ev] = await Promise.all([
      dashboardRepository.configuracionDeNiveles({ periodoId: periodo.id, docenteId: auth.usuario.id }),
      dashboardRepository.contarEvaluacionesDelDocente({ periodoId: periodo.id, docenteId: auth.usuario.id }),
    ]);
    tarjetas = [
      tarjeta("EVALUACIONES_POR_CALIFICAR", "Bitácoras entregadas por calificar", ev.por_calificar, "accion", { pantalla: "evaluaciones", filtro: { estado: "PENDIENTE" } }),
      tarjeta("EVALUACIONES_EN_BORRADOR", "Evaluaciones en borrador por publicar", ev.en_borrador, "accion", { pantalla: "evaluaciones", filtro: { estado: "BORRADOR" } }),
      tarjeta("NIVELES_SIN_GUIA", "Niveles sin guía de criterios (PDF)", propios.filter((n) => !n.tiene_guia).length, "accion", { pantalla: "mi_grupo", filtro: { pestana: "criterios", nivel_ids: propios.filter((n) => !n.tiene_guia).map((n) => n.nivel_id) } }),
      tarjeta("NIVELES_SIN_CUESTIONARIO", "Niveles sin cuestionario habilitado", propios.filter((n) => !n.tiene_cuestionario).length, "accion", { pantalla: "mi_grupo", filtro: { pestana: "cuestionario", nivel_ids: propios.filter((n) => !n.tiene_cuestionario).map((n) => n.nivel_id) } }),
      tarjeta("CUESTIONARIOS_SIN_PUBLICAR", "Cuestionarios en borrador sin publicar", propios.filter((n) => n.tiene_borrador).length, "info", { pantalla: "mi_grupo", filtro: { pestana: "cuestionario" } }),
    ];
  } else {
    throw ApiError.prohibido("Tu rol no tiene tarjetas de acción.");
  }

  return {
    ...base,
    pendientes: tarjetas.filter((t) => t.tipo !== "info" && t.suma).reduce((suma, t) => suma + t.total, 0),
    tarjetas,
  };
}

/**
 * Niveles que atiende el docente en el periodo, con cuántos estudiantes tiene cada uno y si ya configuró su guía de
 * criterios y su cuestionario. Es la base de la pantalla «Mi grupo de práctica».
 */
export async function misNiveles({ periodo_id }, auth) {
  const periodo = await resolverPeriodo(periodo_id);
  if (!periodo) throw ApiError.noEncontrado("No hay un periodo activo.", "PERIOD_NOT_FOUND");
  const niveles = await dashboardRepository.configuracionDeNiveles({ periodoId: periodo.id, docenteId: auth.usuario.id });
  return {
    periodo: armarPeriodo(periodo),
    niveles: niveles.map((n) => ({
      id: n.nivel_id,
      nombre: n.nivel_nombre,
      estudiantes: n.estudiantes,
      tiene_guia: n.tiene_guia,
      tiene_cuestionario: n.tiene_cuestionario,
      tiene_borrador: n.tiene_borrador,
    })),
  };
}

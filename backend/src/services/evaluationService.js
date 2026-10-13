/**
 * Servicio de evaluaciones.
 * El Docente Supervisor y el Asesor de Sitio evalúan de forma independiente (nota de 0 a 5 y retroalimentación);
 * no se calcula ningún promedio. El Director puede reabrir una evaluación publicada y cierra la práctica cuando ambas están publicadas.
 * Todas las operaciones que cambian estados usan transacciones con bloqueo de filas para evitar condiciones de carrera.
 */
import { crearNotificacion, registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { withTransaction } from "../database/transaction.js";
import * as assignmentRepository from "../repositories/assignmentRepository.js";
import * as documentRepository from "../repositories/documentRepository.js";
import * as evaluationRepository from "../repositories/evaluationRepository.js";
import * as logbookRepository from "../repositories/logbookRepository.js";
import { ApiError } from "../utils/apiError.js";
import { EVALUACION, ROLES } from "../utils/constants.js";
import * as logbookService from "./logbookService.js";

const { ALCANCE } = assignmentRepository;
const { mapearAsignacion } = assignmentRepository;

/** Cada evaluador solo trabaja el tipo de evaluación que le corresponde por su rol. */
const TIPO_POR_ROL = Object.freeze({
  [ROLES.DOCENTE_SUPERVISOR]: "DOCENTE_SUPERVISOR",
  [ROLES.ASESOR_SITIO]: "ASESOR_SITIO",
});
// Nombre legible del tipo de evaluador, usado en los mensajes de notificación.
const NOMBRE_TIPO = Object.freeze({ DOCENTE_SUPERVISOR: "docente supervisor", ASESOR_SITIO: "asesor de sitio" });
// La bitácora debe haber sido enviada para poder evaluarse.
const ESTADOS_BITACORA_EVALUABLE = ["ENVIADA", "EN_EVALUACION", "EVALUADA"];

// ¿El usuario actúa como Docente Supervisor o Asesor de Sitio?
const esEvaluador = (auth) => auth.rolActivo in TIPO_POR_ROL;

// ───────────────────────── Acceso y visibilidad ─────────────────────────

/**
 * Qué evaluaciones puede ver cada rol:
 *  - Dirección: todas (el contenido de un borrador no se muestra).
 *  - Docente y asesor: únicamente la evaluación de su propio tipo en sus estudiantes (no ven la del otro evaluador,
 *    así las evaluaciones se mantienen independientes).
 *  - Estudiante: solo las publicadas de su práctica.
 */
const puedeVer = (auth, evaluacion) => {
  switch (auth.rolActivo) {
    case ROLES.DIRECTOR_PROGRAMA: return true;
    case ROLES.ESTUDIANTE: return evaluacion.estado === "PUBLICADA";
    case ROLES.DOCENTE_SUPERVISOR:
    case ROLES.ASESOR_SITIO: return evaluacion.tipo_evaluador === TIPO_POR_ROL[auth.rolActivo];
    default: return false;
  }
};

/**
 * Carga la evaluación y valida el alcance. Quien no tiene acceso (otro docente, asesor de otra institución,
 * estudiante ante un borrador) recibe "no existe" para no revelar que la evaluación existe.
 */
async function cargarAutorizada(id, auth) {
  const evaluacion = await evaluationRepository.buscarPorId(id);
  const asignacion = evaluacion
    ? await assignmentRepository.buscarPorId(evaluacion.asignacion_id, logbookService.alcancePorRol(auth))
    : null;
  if (!evaluacion || !asignacion || !puedeVer(auth, evaluacion)) {
    throw ApiError.noEncontrado("La evaluación no existe.", "EVALUATION_NOT_FOUND");
  }
  return { evaluacion, asignacion };
}

/** Impide que un rol que no es evaluador registre evaluaciones. */
function exigirEvaluador(auth) {
  if (!esEvaluador(auth)) throw ApiError.prohibido("Solo el docente supervisor o el asesor de sitio registran evaluaciones.");
}

/** La evaluación solo se trabaja con la práctica en evaluación y la bitácora entregada. */
function exigirEvaluable({ evaluacion, asignacion, bitacora }) {
  if (asignacion.estado === "FINALIZADA") {
    throw ApiError.reglaDeNegocio("La práctica ya fue finalizada: las evaluaciones están cerradas.", "PRACTICE_FINISHED");
  }
  if (asignacion.estado !== "PENDIENTE_EVALUACION" || !ESTADOS_BITACORA_EVALUABLE.includes(bitacora.estado)) {
    throw ApiError.reglaDeNegocio("La práctica no está en evaluación.", "EVALUATION_NOT_AVAILABLE", [
      { estado_practica: asignacion.estado, estado_bitacora: bitacora.estado },
    ]);
  }
  if (evaluacion.estado === "PUBLICADA") {
    throw ApiError.conflicto(
      "Esta evaluación ya fue publicada. Para modificarla, Dirección debe reabrirla.",
      "EVALUATION_ALREADY_PUBLISHED"
    );
  }
}

// ───────────────────────── Vista ─────────────────────────

/** Convierte los datos del evaluador en { id, nombre_completo }. */
const armarEvaluador = (fila) =>
  fila.evaluador_id || fila.evaluador_nombres
    ? { id: fila.evaluador_id ?? null, nombre_completo: `${fila.evaluador_nombres} ${fila.evaluador_apellidos}` }
    : null;

/**
 * Quién evalúa: si ya se publicó, quien publicó; si no, el docente o asesor vigente de la asignación
 * (puede haber cambiado desde que se envió la bitácora).
 */
const evaluadorVisible = (tipo, estado, fila, asignacion) => {
  if (estado === "PUBLICADA") return armarEvaluador(fila);
  const vigente = tipo === "DOCENTE_SUPERVISOR" ? asignacion.docente : asignacion.asesor;
  return vigente ? { id: vigente.id, nombre_completo: vigente.nombre_completo } : null;
};

/** La nota y la retroalimentación de un borrador solo las ve su autor; todos los demás solo ven lo publicado. */
const contenidoVisible = (auth, estado) => esEvaluador(auth) || estado === "PUBLICADA";

/** Arma la evaluación para el frontend ocultando nota/comentarios de borradores a quien no es su autor, e indicando si es editable o reabrible. */
function armarEvaluacion(fila, auth, asignacion) {
  const visible = contenidoVisible(auth, fila.estado);
  const enEvaluacion = asignacion.estado === "PENDIENTE_EVALUACION";
  const propia = esEvaluador(auth);
  return {
    id: fila.id,
    tipo: fila.tipo_evaluador,
    estado: fila.estado,
    nota: visible ? fila.nota : null,
    retroalimentacion: visible ? fila.retroalimentacion : null,
    evaluador: evaluadorVisible(fila.tipo_evaluador, fila.estado, fila, asignacion),
    publicada_en: fila.publicada_en,
    reabierta_en: auth.rolActivo === ROLES.ESTUDIANTE ? null : fila.reabierta_en,
    motivo_reapertura: auth.rolActivo === ROLES.ESTUDIANTE ? null : fila.motivo_reapertura,
    editable: propia && enEvaluacion && fila.estado !== "PUBLICADA",
    reabrible: auth.rolActivo === ROLES.DIRECTOR_PROGRAMA && enEvaluacion && fila.estado === "PUBLICADA",
  };
}

/** Fila de la cola: la asignación (alcance ya aplicado en SQL) más el estado de la evaluación. */
function armarFila(fila, auth) {
  const asignacion = mapearAsignacion(fila);
  const evaluacion = armarEvaluacion(
    {
      id: fila.evaluacion_id, tipo_evaluador: fila.tipo_evaluador, estado: fila.evaluacion_estado, nota: fila.nota,
      retroalimentacion: fila.retroalimentacion, publicada_en: fila.publicada_en, reabierta_en: fila.reabierta_en,
      motivo_reapertura: null, evaluador_id: fila.evaluador_id,
      evaluador_nombres: fila.evaluador_nombres, evaluador_apellidos: fila.evaluador_apellidos,
    },
    auth,
    asignacion
  );
  // La cola no necesita el motivo ni el detalle: se ven al abrir la evaluación.
  const { motivo_reapertura: _motivo, retroalimentacion: _retro, ...resumen } = evaluacion;
  return {
    ...resumen,
    bitacora: { id: fila.bitacora_id, estado: fila.bitacora_estado, enviada_en: fila.enviada_en },
    asignacion: {
      id: asignacion.id, estado: asignacion.estado, periodo: asignacion.periodo, nivel: asignacion.nivel,
      estudiante: { id: asignacion.estudiante.id, nombre_completo: asignacion.estudiante.nombre_completo, documento: asignacion.estudiante.documento },
      institucion: asignacion.institucion, docente: asignacion.docente, asesor: asignacion.asesor,
    },
  };
}

// ───────────────────────── Casos de uso ─────────────────────────

/** Cola de evaluaciones según el rol activo (ver `puedeVer`). Incluye un resumen por estado para los contadores. */
export async function listar(filtros, auth) {
  const { limit, offset, ...criterios } = filtros;
  const resultado = await evaluationRepository.listar(
    {
      ...criterios,
      forzarTipo: TIPO_POR_ROL[auth.rolActivo] ?? null,
      soloPublicadas: auth.rolActivo === ROLES.ESTUDIANTE,
    },
    logbookService.alcancePorRol(auth),
    { limit, offset }
  );
  return { filas: resultado.filas.map((fila) => armarFila(fila, auth)), total: resultado.total, resumen: resultado.resumen };
}

/**
 * Detalle: la evaluación y, para Dirección y evaluadores, la entrega en solo lectura (reflexión, evidencias,
 * preguntas y respuestas). El estudiante solo recibe la evaluación publicada.
 */
export async function obtener(id, auth) {
  const { evaluacion, asignacion } = await cargarAutorizada(id, auth);
  const mapeada = mapearAsignacion(asignacion);
  const resultado = {
    evaluacion: armarEvaluacion(evaluacion, auth, mapeada),
    asignacion: {
      id: mapeada.id, estado: mapeada.estado, periodo: mapeada.periodo, nivel: mapeada.nivel,
      estudiante: { id: mapeada.estudiante.id, nombre_completo: mapeada.estudiante.nombre_completo, documento: mapeada.estudiante.documento },
      institucion: mapeada.institucion, docente: mapeada.docente, asesor: mapeada.asesor,
    },
  };
  if (auth.rolActivo !== ROLES.ESTUDIANTE) {
    resultado.bitacora = await logbookService.obtener(evaluacion.bitacora_id, auth);
  }
  return resultado;
}

/**
 * Bloquea en el mismo orden que el resto del sistema (asignación → bitácora → evaluación) y devuelve lo bloqueado.
 * Si la bitácora se devolvió mientras tanto, la evaluación ya fue retirada y se responde como inexistente.
 */
async function bloquearParaEvaluar(evaluacionId, asignacionId, bitacoraId, client) {
  const asignacion = await documentRepository.bloquearAsignacion(asignacionId, client);
  const bitacora = await logbookRepository.buscarPorId(bitacoraId, client, { bloquear: true });
  const evaluacion = await evaluationRepository.buscarPorId(evaluacionId, client, { bloquear: true });
  if (!asignacion || !bitacora || !evaluacion) {
    throw ApiError.noEncontrado("La evaluación ya no está disponible (la bitácora pudo haberse devuelto).", "EVALUATION_NOT_FOUND");
  }
  return { asignacion, bitacora, evaluacion };
}

/** Autoguardado del borrador del evaluador. Puede estar incompleto; la primera vez la bitácora pasa a EN_EVALUACION. */
export async function guardarBorrador(id, { nota, retroalimentacion }, auth) {
  exigirEvaluador(auth);
  const { evaluacion: previa } = await cargarAutorizada(id, auth);

  await withTransaction(async (client) => {
    const bloqueado = await bloquearParaEvaluar(id, previa.asignacion_id, previa.bitacora_id, client);
    exigirEvaluable(bloqueado);
    await evaluationRepository.guardarBorrador({ id, nota, retroalimentacion }, client);
    if (bloqueado.bitacora.estado === "ENVIADA") {
      await logbookRepository.cambiarEstado({ id: bloqueado.bitacora.id, estado: "EN_EVALUACION" }, client);
    }
  });
  return obtener(id, auth);
}

// Crea una notificación solo si el destinatario tiene cuenta en Firebase.
const notificar = (firebaseUid, datos) => (firebaseUid ? crearNotificacion(firebaseUid, datos) : Promise.resolve(false));

/**
 * Publica la evaluación (transaccional): exige una nota entre 0 y 5, registra quién publicó y deja la bitácora en
 * EN_EVALUACION o, si ya están publicadas las dos evaluaciones, en EVALUADA. No se calcula ningún promedio.
 * La publicación es inmutable; para corregirla Dirección debe reabrirla.
 */
export async function publicar(id, entrada, auth, contexto) {
  exigirEvaluador(auth);
  const { evaluacion: previa } = await cargarAutorizada(id, auth);

  const resultado = await withTransaction(async (client) => {
    const bloqueado = await bloquearParaEvaluar(id, previa.asignacion_id, previa.bitacora_id, client);
    exigirEvaluable(bloqueado);

        // Si no llega la nota en la petición se usa la del borrador; sin nota no se puede publicar.
    const nota = entrada.nota ?? bloqueado.evaluacion.nota;
    const retroalimentacion =
      entrada.retroalimentacion !== undefined ? entrada.retroalimentacion : bloqueado.evaluacion.retroalimentacion;
    if (nota === null || nota === undefined) {
      throw ApiError.reglaDeNegocio(
        `Ingresa la nota (entre ${EVALUACION.NOTA_MINIMA.toFixed(2)} y ${EVALUACION.NOTA_MAXIMA.toFixed(2)}) para publicar la evaluación.`,
        "GRADE_REQUIRED"
      );
    }

        // Se publica y se revisa si ya están publicadas las dos evaluaciones para marcar la bitácora como EVALUADA.
    await evaluationRepository.publicar({ id, nota, retroalimentacion, evaluadorId: auth.usuario.id }, client);
    const todas = await evaluationRepository.listarDeAsignacion(bloqueado.asignacion.id, client);
    const completas = todas.length === EVALUACION.TIPOS.length && todas.every((e) => e.estado === "PUBLICADA");
    await logbookRepository.cambiarEstado({ id: bloqueado.bitacora.id, estado: completas ? "EVALUADA" : "EN_EVALUACION" }, client);
    return { ...bloqueado, nota, completas };
  });

  const { evaluacion, asignacion, bitacora } = resultado;
  await registrarAuditoria({
    contexto,
    accion: "EVALUACION_PUBLICADA",
    entidad: "evaluaciones",
    entidad_id: id,
    valor_anterior: { estado: evaluacion.estado },
    valor_nuevo: {
      estado: "PUBLICADA", tipo: evaluacion.tipo_evaluador, nota: resultado.nota,
      bitacora_estado: resultado.completas ? "EVALUADA" : "EN_EVALUACION", bitacora_id: bitacora.id,
    },
  });
  await notificar(asignacion.estudiante_firebase_uid, {
    tipo: "EVALUACION_PUBLICADA",
    titulo: "Tienes una evaluación nueva",
    mensaje: `Tu ${NOMBRE_TIPO[evaluacion.tipo_evaluador]} publicó su evaluación de tu bitácora.`,
    entidad: { tipo: "evaluacion", id },
  });
    // Cuando ambas están publicadas se avisa a los Directores que la práctica puede finalizarse.
  if (resultado.completas) {
    const aviso = {
      tipo: "PRACTICA_LISTA_PARA_CERRAR",
      titulo: "Una práctica está lista para finalizar",
      mensaje: "El docente supervisor y el asesor de sitio ya publicaron sus evaluaciones.",
      entidad: { tipo: "asignacion_practica", id: asignacion.id },
    };
    for (const director of await documentRepository.listarDirectores()) await notificar(director.firebase_uid, aviso);
  }
  return obtener(id, auth);
}

/**
 * Dirección reabre una evaluación publicada (con motivo) para que su autor la corrija. Mientras esté reabierta el
 * estudiante deja de verla y la bitácora vuelve a EN_EVALUACION. No se puede reabrir con la práctica finalizada.
 */
export async function reabrir(id, { motivo }, auth, contexto) {
  const previa = await evaluationRepository.buscarPorId(id);
  if (!previa) throw ApiError.noEncontrado("La evaluación no existe.", "EVALUATION_NOT_FOUND");

  const bloqueado = await withTransaction(async (client) => {
    const datos = await bloquearParaEvaluar(id, previa.asignacion_id, previa.bitacora_id, client);
    if (datos.evaluacion.estado !== "PUBLICADA") {
      throw ApiError.conflicto("La evaluación no está publicada, no hay nada que reabrir.", "EVALUATION_NOT_PUBLISHED");
    }
    if (datos.asignacion.estado === "FINALIZADA") {
      throw ApiError.reglaDeNegocio("La práctica ya fue finalizada: las evaluaciones no pueden reabrirse.", "PRACTICE_FINISHED");
    }
    if (datos.asignacion.estado !== "PENDIENTE_EVALUACION") {
      throw ApiError.reglaDeNegocio("La práctica no está en evaluación.", "EVALUATION_NOT_AVAILABLE");
    }
    await evaluationRepository.reabrir({ id, motivo }, client);
    await logbookRepository.cambiarEstado({ id: datos.bitacora.id, estado: "EN_EVALUACION" }, client);
    return datos;
  });

  await registrarAuditoria({
    contexto,
    accion: "EVALUACION_REABIERTA",
    entidad: "evaluaciones",
    entidad_id: id,
    valor_anterior: { estado: "PUBLICADA", nota: bloqueado.evaluacion.nota },
    valor_nuevo: { estado: "BORRADOR", motivo, tipo: bloqueado.evaluacion.tipo_evaluador, bitacora_estado: "EN_EVALUACION" },
  });
  await notificar(bloqueado.evaluacion.evaluador_firebase_uid, {
    tipo: "EVALUACION_REABIERTA",
    titulo: "Dirección reabrió una evaluación tuya",
    mensaje: motivo,
    prioridad: "alta",
    entidad: { tipo: "evaluacion", id },
  });
  await notificar(bloqueado.asignacion.estudiante_firebase_uid, {
    tipo: "EVALUACION_REABIERTA",
    titulo: "Una evaluación está en revisión",
    mensaje: `Tu ${NOMBRE_TIPO[bloqueado.evaluacion.tipo_evaluador]} está revisando su evaluación; la verás de nuevo cuando la publique.`,
    entidad: { tipo: "evaluacion", id },
  });
  return obtener(id, auth);
}

/**
 * Cierre de la práctica (solo Dirección): exige las dos evaluaciones publicadas. Pasa la asignación a FINALIZADA,
 * después de lo cual ya no se editan ni reabren las evaluaciones. Las notas se conservan por separado.
 */
export async function finalizarPractica(asignacionId, contexto) {
  const previa = await assignmentRepository.buscarPorId(asignacionId, ALCANCE.director());
  if (!previa) throw ApiError.noEncontrado("La asignación no existe.", "ASSIGNMENT_NOT_FOUND");

  const { evaluaciones, asignacion } = await withTransaction(async (client) => {
    const bloqueada = await documentRepository.bloquearAsignacion(asignacionId, client);
    if (bloqueada.estado === "FINALIZADA") {
      throw ApiError.conflicto("La práctica ya fue finalizada.", "ASSIGNMENT_ALREADY_FINISHED");
    }
    if (bloqueada.estado !== "PENDIENTE_EVALUACION") {
      throw ApiError.reglaDeNegocio(
        `Solo puede finalizarse una práctica en evaluación (estado actual: ${bloqueada.estado}).`,
        "INVALID_ASSIGNMENT_TRANSITION",
        [{ estado_actual: bloqueada.estado }]
      );
    }
        // Para finalizar deben estar publicadas las evaluaciones de ambos tipos.
    const vigentes = await evaluationRepository.listarDeAsignacion(asignacionId, client);
    const pendientes = EVALUACION.TIPOS.filter((tipo) => vigentes.find((e) => e.tipo_evaluador === tipo)?.estado !== "PUBLICADA");
    if (pendientes.length) {
      throw ApiError.reglaDeNegocio(
        "No se puede finalizar: faltan evaluaciones por publicar.",
        "EVALUATIONS_PENDING",
        pendientes.map((tipo) => ({ tipo, estado: vigentes.find((e) => e.tipo_evaluador === tipo)?.estado ?? "SIN_EVALUACION" }))
      );
    }
    await documentRepository.cambiarEstadoAsignacion(asignacionId, "FINALIZADA", client);
    return { evaluaciones: vigentes, asignacion: bloqueada };
  });

  const fila = await assignmentRepository.buscarPorId(asignacionId, ALCANCE.director());
  await registrarAuditoria({
    contexto,
    accion: "PRACTICA_FINALIZADA",
    entidad: "asignaciones_practica",
    entidad_id: asignacionId,
    valor_anterior: { estado: "PENDIENTE_EVALUACION" },
    valor_nuevo: {
      estado: "FINALIZADA",
      notas: Object.fromEntries(evaluaciones.map((e) => [e.tipo_evaluador, e.nota])),
    },
  });
  const aviso = {
    tipo: "PRACTICA_FINALIZADA",
    titulo: "La práctica fue finalizada",
    mensaje: `${fila.estudiante_nombres} ${fila.estudiante_apellidos} completó su práctica (${fila.nivel_nombre}).`,
    entidad: { tipo: "asignacion_practica", id: asignacionId },
  };
  await notificar(asignacion.estudiante_firebase_uid, { ...aviso, mensaje: "Tu práctica fue finalizada. Ya puedes consultar tus evaluaciones." });
  await notificar(fila.docente_firebase_uid, aviso);
  await notificar(fila.asesor_firebase_uid, aviso);

  return {
    asignacion_id: asignacionId,
    estado: "FINALIZADA",
    // Sin promedio: cada evaluación se informa por separado.
    evaluaciones: evaluaciones.map((e) => ({ tipo: e.tipo_evaluador, nota: e.nota, publicada_en: e.publicada_en })),
  };
}

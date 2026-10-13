/**
 * Servicio de asignaciones de práctica.
 * Contiene las reglas de negocio para asignar un estudiante a una institución, un docente supervisor y un asesor de sitio:
 * valida matrícula, nivel, convenio y vinculación del asesor; guarda en PostgreSQL dentro de una transacción;
 * registra la auditoría y notifica a los participantes (ambas son de "mejor esfuerzo": si fallan no revierten la operación).
 */
import { crearNotificacion, registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { withTransaction } from "../database/transaction.js";
import * as evaluationRepository from "../repositories/evaluationRepository.js";
import * as assignmentRepository from "../repositories/assignmentRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";
import { ApiError } from "../utils/apiError.js";
import { ROLES } from "../utils/constants.js";
import { calcularCambios } from "../utils/diff.js";

const { ALCANCE, mapearAsignacion } = assignmentRepository;

// Mientras la asignación esté en alguno de estos estados todavía puede editarse o cancelarse.
/** Estados en los que todavía se puede reasignar o cancelar. */
const ESTADOS_ABIERTOS = ["PENDIENTE_DOCUMENTOS", "ACTIVA", "PENDIENTE_EVALUACION"];
// Únicos campos que el Director puede cambiar en una asignación.
const CAMPOS_EDITABLES = ["institucion_id", "docente_supervisor_id", "asesor_sitio_id", "fecha_inicio", "fecha_fin"];

/** Traduce el rol activo del usuario en el alcance de datos que puede consultar (cada rol ve solo lo suyo). */
function alcanceDe(auth) {
  switch (auth.rolActivo) {
    case ROLES.DIRECTOR_PROGRAMA:
      return ALCANCE.director();
    case ROLES.DOCENTE_SUPERVISOR:
      return ALCANCE.docente(auth.usuario.id);
    case ROLES.ASESOR_SITIO:
      return ALCANCE.asesor(auth.usuario.id);
    case ROLES.ESTUDIANTE:
      return ALCANCE.estudiante(auth.usuario.id);
    default:
      throw ApiError.prohibido();
  }
}

/** Carga una asignación o responde 404 si no existe (o no está en el alcance del usuario). */
async function cargarFilaODetener(id, alcance = ALCANCE.director()) {
  const fila = await assignmentRepository.buscarPorId(id, alcance);
  if (!fila) throw ApiError.noEncontrado("La asignación no existe.", "ASSIGNMENT_NOT_FOUND");
  return fila;
}

// Resumen mínimo de la asignación que se guarda en la auditoría.
const resumen = (fila) => ({
  institucion_id: fila.institucion_id,
  docente_supervisor_id: fila.docente_id,
  asesor_sitio_id: fila.asesor_id,
  fecha_inicio: fila.fecha_inicio,
  fecha_fin: fila.fecha_fin,
  estado: fila.estado,
});

// ───────── Validaciones de negocio ─────────
// ───────────────────────── Validaciones de negocio ─────────────────────────

/** La institución debe existir, estar activa y tener convenio VIGENTE. */
async function validarInstitucion(institucionId) {
  const institucion = await assignmentRepository.buscarInstitucion(institucionId);
  if (!institucion) throw ApiError.reglaDeNegocio("La institución no existe.", "INSTITUTION_NOT_FOUND");
  if (!institucion.activa || institucion.estado_convenio !== "VIGENTE") {
    throw ApiError.reglaDeNegocio(
      "Solo se pueden asignar instituciones activas con convenio vigente.",
      "INSTITUTION_NOT_AVAILABLE",
      [{ institucion_id: institucionId, activa: institucion.activa, estado_convenio: institucion.estado_convenio }]
    );
  }
}

/** El docente debe tener rol Docente Supervisor y estar ACTIVO. */
async function validarDocente(docenteId) {
  const persona = await assignmentRepository.buscarPersonaConRoles(docenteId);
  if (!persona || !persona.roles.includes(ROLES.DOCENTE_SUPERVISOR)) {
    throw ApiError.reglaDeNegocio("El docente indicado no existe o no tiene el rol de Docente Supervisor.", "TEACHER_INVALID");
  }
  if (persona.estado !== "ACTIVO") {
    throw ApiError.reglaDeNegocio("El docente indicado no está activo.", "TEACHER_INACTIVE");
  }
}

/** El asesor debe tener rol Asesor de Sitio, estar ACTIVO y pertenecer a la institución en ese periodo. */
async function validarAsesor(asesorId, institucionId, periodoId) {
  const persona = await assignmentRepository.buscarPersonaConRoles(asesorId);
  if (!persona || !persona.roles.includes(ROLES.ASESOR_SITIO)) {
    throw ApiError.reglaDeNegocio("El asesor indicado no existe o no tiene el rol de Asesor de Sitio.", "ADVISOR_INVALID");
  }
  if (persona.estado !== "ACTIVO") {
    throw ApiError.reglaDeNegocio("El asesor indicado no está activo.", "ADVISOR_INACTIVE");
  }
  if (!(await assignmentRepository.tieneVinculacionVigente({ asesorId, institucionId, periodoId }))) {
    throw ApiError.reglaDeNegocio(
      "El asesor no pertenece a la institución seleccionada en este periodo.",
      "ADVISOR_NOT_IN_INSTITUTION"
    );
  }
}

/** Usa el periodo indicado o, si no se indica, el periodo activo; no permite periodos cerrados. */
async function resolverPeriodoDeCreacion(periodoId) {
  const periodo = periodoId ? await periodRepository.buscarPorId(periodoId) : await periodRepository.buscarActivo();
  if (!periodo) {
    throw ApiError.reglaDeNegocio(
      periodoId ? "El periodo académico indicado no existe." : "No hay un periodo académico activo.",
      periodoId ? "PERIOD_NOT_FOUND" : "NO_ACTIVE_PERIOD"
    );
  }
  if (periodo.estado === "CERRADO") {
    throw ApiError.reglaDeNegocio("El periodo académico está cerrado.", "PERIOD_CLOSED");
  }
  return periodo;
}

// ───────────────────────── Notificaciones (mejor esfuerzo) ─────────────────────────

/** Crea una notificación para una persona (si tiene cuenta de Firebase). */
const notificar = (persona, { tipo, titulo, mensaje, asignacionId }) =>
  persona?.firebase_uid
    ? crearNotificacion(persona.firebase_uid, { tipo, titulo, mensaje, entidad: { tipo: "asignacion", id: asignacionId } })
    : Promise.resolve(false);

/** Avisa a estudiante, docente y asesor con el detalle "nivel · institución". Cada aviso es opcional. */
async function notificarParticipantes(fila, { estudiante, docente, asesor }) {
  const detalle = `${fila.nivel_nombre} · ${fila.institucion_nombre}`;
  const mapa = mapearAsignacion(fila, { conUid: true });
  await Promise.all([
    estudiante && notificar(mapa.estudiante, { ...estudiante, mensaje: estudiante.mensaje ?? detalle, asignacionId: fila.id }),
    docente && notificar(mapa.docente, { ...docente, mensaje: docente.mensaje ?? detalle, asignacionId: fila.id }),
    asesor && notificar(mapa.asesor, { ...asesor, mensaje: asesor.mensaje ?? detalle, asignacionId: fila.id }),
  ]);
}

// ───────────────────────── Casos de uso ─────────────────────────

/** Lista asignaciones; por defecto muestra el periodo activo. */
export async function listar(filtros, auth) {
  const alcance = alcanceDe(auth);
  let periodoId = filtros.periodo_id;
  if (!periodoId && !filtros.todos_los_periodos) periodoId = (await periodRepository.buscarActivo())?.id;
  return assignmentRepository.listar({ ...filtros, periodo_id: periodoId }, alcance);
}

/** Detalle de una asignación dentro del alcance del usuario. */
export async function obtener(id, auth) {
  return mapearAsignacion(await cargarFilaODetener(id, alcanceDe(auth)));
}

/** Estudiantes matriculados en el periodo que todavía no tienen asignación. */
export async function listarEstudiantesSinAsignacion({ periodo_id, q, limit, offset }) {
  const periodo = periodo_id ? await periodRepository.buscarPorId(periodo_id) : await periodRepository.buscarActivo();
  if (!periodo) return { filas: [], total: 0 };
  return assignmentRepository.listarEstudiantesSinAsignacion({ periodoId: periodo.id, q, limit, offset });
}

/** Crea una asignación. Verifica matrícula activa, estudiante activo, nivel correcto para el semestre, que no tenga otra asignación vigente, y que institución, docente y asesor sean válidos. */
export async function crear(datos, contexto) {
  const periodo = await resolverPeriodoDeCreacion(datos.periodo_id);

  const matricula = await assignmentRepository.buscarMatricula(datos.estudiante_id, periodo.id);
  if (!matricula) {
    throw ApiError.reglaDeNegocio("El estudiante no tiene matrícula en ese periodo.", "ENROLLMENT_NOT_FOUND");
  }
  if (matricula.estado !== "ACTIVA") {
    throw ApiError.reglaDeNegocio("La matrícula del estudiante no está activa.", "ENROLLMENT_NOT_ACTIVE");
  }
  const estudiante = await assignmentRepository.buscarPersonaConRoles(datos.estudiante_id);
  if (!estudiante || estudiante.estado !== "ACTIVO") {
    throw ApiError.reglaDeNegocio("El estudiante no está activo.", "STUDENT_INACTIVE");
  }

  const nivel = await assignmentRepository.buscarNivel(datos.nivel_practica_id);
  if (!nivel || !nivel.activo) throw ApiError.reglaDeNegocio("El nivel de práctica no existe o está inactivo.", "LEVEL_NOT_FOUND");
  if (nivel.programa_id !== matricula.programa_id || nivel.semestre !== matricula.semestre) {
    throw ApiError.reglaDeNegocio(
      `${nivel.nombre} corresponde al semestre ${nivel.semestre}, pero el estudiante cursa el semestre ${matricula.semestre}.`,
      "LEVEL_MISMATCH",
      [{ nivel_semestre: nivel.semestre, estudiante_semestre: matricula.semestre }]
    );
  }

  if (await assignmentRepository.existeAsignacionVigente(matricula.id)) {
    throw ApiError.conflicto(
      "El estudiante ya tiene una práctica asignada en este periodo. Cancélala o reasígnala.",
      "ASSIGNMENT_ALREADY_EXISTS"
    );
  }

  await validarInstitucion(datos.institucion_id);
  if (datos.docente_supervisor_id) await validarDocente(datos.docente_supervisor_id);
  if (datos.asesor_sitio_id) await validarAsesor(datos.asesor_sitio_id, datos.institucion_id, periodo.id);

    // Se guarda en una transacción para que todo se confirme junto o nada.
  const { id } = await withTransaction((client) =>
    assignmentRepository.crear(
      {
        matriculaId: matricula.id,
        nivelId: nivel.id,
        institucionId: datos.institucion_id,
        docenteId: datos.docente_supervisor_id,
        asesorId: datos.asesor_sitio_id,
        fecha_inicio: datos.fecha_inicio,
        fecha_fin: datos.fecha_fin,
        asignadaPorId: contexto.actor.usuario_id,
      },
      client
    )
  );

  const fila = await cargarFilaODetener(id);
    // Auditoría y notificaciones se hacen después de confirmar, para no bloquear la operación académica.
  await registrarAuditoria({
    contexto,
    accion: "ASIGNACION_CREADA",
    entidad: "asignaciones_practica",
    entidad_id: id,
    valor_nuevo: { ...resumen(fila), estudiante_id: fila.estudiante_id, nivel: fila.nivel_codigo, periodo: fila.periodo_codigo },
  });
  await notificarParticipantes(fila, {
    estudiante: { tipo: "ASIGNACION_CREADA", titulo: "Tienes una práctica asignada" },
    docente: { tipo: "ASIGNACION_NUEVA_TUTORIA", titulo: "Se te asignó un estudiante para supervisar" },
    asesor: { tipo: "ASIGNACION_NUEVO_PRACTICANTE", titulo: "Se te asignó un practicante en tu institución" },
  });
  return mapearAsignacion(fila);
}

/** Actualiza institución, docente, asesor o fechas. Si cambia la institución y no se indica asesor nuevo, se libera el asesor anterior. */
export async function actualizar(id, entrada, contexto) {
  const fila = await cargarFilaODetener(id);
  if (!ESTADOS_ABIERTOS.includes(fila.estado)) {
    throw ApiError.reglaDeNegocio("La asignación está cerrada y no puede modificarse.", "ASSIGNMENT_CLOSED");
  }

  const propuesto = { ...entrada };
  const institucionCambia = propuesto.institucion_id !== undefined && propuesto.institucion_id !== fila.institucion_id;
  let asesorLiberado = false;
  // El asesor pertenece a una institución: si esta cambia y no se indica asesor nuevo, se libera el cargo.
  if (institucionCambia && propuesto.asesor_sitio_id === undefined && fila.asesor_id) {
    propuesto.asesor_sitio_id = null;
    asesorLiberado = true;
  }

  const actualPlano = {
    institucion_id: fila.institucion_id,
    docente_supervisor_id: fila.docente_id,
    asesor_sitio_id: fila.asesor_id,
    fecha_inicio: fila.fecha_inicio,
    fecha_fin: fila.fecha_fin,
  };
  const diff = calcularCambios(actualPlano, propuesto, CAMPOS_EDITABLES);
  if (!diff.hayCambios) return mapearAsignacion(fila);

  const fechaInicio = "fecha_inicio" in diff.nuevo ? diff.nuevo.fecha_inicio : fila.fecha_inicio;
  const fechaFin = "fecha_fin" in diff.nuevo ? diff.nuevo.fecha_fin : fila.fecha_fin;
  if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
    throw ApiError.reglaDeNegocio("La fecha final no puede ser anterior a la inicial.", "INVALID_DATES");
  }

    // Un evaluador que ya publicó su evaluación no puede ser reemplazado.
  const publicadas = await assignmentRepository.tiposEvaluacionPublicada(id);
  if ("docente_supervisor_id" in diff.nuevo) {
    if (publicadas.includes("DOCENTE_SUPERVISOR")) {
      throw ApiError.reglaDeNegocio("El docente ya publicó su evaluación: no puede reemplazarse.", "EVALUATOR_LOCKED");
    }
    if (diff.nuevo.docente_supervisor_id) await validarDocente(diff.nuevo.docente_supervisor_id);
  }
  if (institucionCambia) await validarInstitucion(diff.nuevo.institucion_id);

  const institucionFinal = diff.nuevo.institucion_id ?? fila.institucion_id;
  const asesorFinal = "asesor_sitio_id" in diff.nuevo ? diff.nuevo.asesor_sitio_id : fila.asesor_id;
  if ("asesor_sitio_id" in diff.nuevo && publicadas.includes("ASESOR_SITIO")) {
    throw ApiError.reglaDeNegocio("El asesor ya publicó su evaluación: no puede reemplazarse.", "EVALUATOR_LOCKED");
  }
  if (asesorFinal && (asesorFinal !== fila.asesor_id || institucionCambia)) {
    await validarAsesor(asesorFinal, institucionFinal, fila.periodo_id);
  }

    // Se aplica el cambio y se reasignan las evaluaciones pendientes en una sola transacción.
  await withTransaction(async (client) => {
    await assignmentRepository.actualizar(id, diff.nuevo, client);
    // Si la bitácora ya se envió, la evaluación sin publicar pasa al nuevo evaluador (y no hereda el borrador del anterior).
    if ("docente_supervisor_id" in diff.nuevo) {
      await evaluationRepository.reasignarPendiente(
        { asignacionId: id, tipo: "DOCENTE_SUPERVISOR", evaluadorId: diff.nuevo.docente_supervisor_id }, client
      );
    }
    if ("asesor_sitio_id" in diff.nuevo) {
      await evaluationRepository.reasignarPendiente(
        { asignacionId: id, tipo: "ASESOR_SITIO", evaluadorId: diff.nuevo.asesor_sitio_id }, client
      );
    }
  });

  const despues = await cargarFilaODetener(id);
  await registrarAuditoria({
    contexto,
    accion: "ASIGNACION_ACTUALIZADA",
    entidad: "asignaciones_practica",
    entidad_id: id,
    valor_anterior: diff.anterior,
    valor_nuevo: { ...diff.nuevo, ...(asesorLiberado ? { asesor_liberado_por_cambio_de_institucion: true } : {}) },
  });

  const docenteCambio = fila.docente_id !== despues.docente_id;
  const asesorCambio = fila.asesor_id !== despues.asesor_id;
  const detalle = `${despues.nivel_nombre} · ${despues.institucion_nombre}`;
  await notificarParticipantes(despues, {
    estudiante: { tipo: "ASIGNACION_ACTUALIZADA", titulo: "Tu asignación de práctica fue actualizada" },
    docente: docenteCambio && despues.docente_id
      ? { tipo: "ASIGNACION_NUEVA_TUTORIA", titulo: "Se te asignó un estudiante para supervisar" }
      : null,
    asesor: asesorCambio && despues.asesor_id
      ? { tipo: "ASIGNACION_NUEVO_PRACTICANTE", titulo: "Se te asignó un practicante en tu institución" }
      : null,
  });
    // Quienes dejan de estar asignados también deben enterarse.
  // Quienes dejan de estar asignados también deben enterarse.
  const quitados = [];
  if (docenteCambio && fila.docente_id) quitados.push(mapearAsignacion(fila, { conUid: true }).docente);
  if (asesorCambio && fila.asesor_id) quitados.push(mapearAsignacion(fila, { conUid: true }).asesor);
  await Promise.all(
    quitados.map((persona) =>
      notificar(persona, {
        tipo: "ASIGNACION_RETIRADA",
        titulo: "Ya no estás asignado a un estudiante",
        mensaje: detalle,
        asignacionId: id,
      })
    )
  );
  return mapearAsignacion(despues);
}

/** Cancela una asignación (pide confirmación si la práctica ya está en curso) y avisa a los participantes. */
export async function cancelar(id, { motivo, confirmar = false }, contexto) {
  const fila = await cargarFilaODetener(id);
  if (fila.estado === "CANCELADA") {
    throw ApiError.conflicto("La asignación ya está cancelada.", "ASSIGNMENT_ALREADY_CANCELLED");
  }
  if (!ESTADOS_ABIERTOS.includes(fila.estado)) {
    throw ApiError.reglaDeNegocio("Una asignación finalizada no puede cancelarse.", "ASSIGNMENT_CLOSED");
  }
  if (fila.estado !== "PENDIENTE_DOCUMENTOS" && !confirmar) {
    throw ApiError.conflicto(
      "La práctica ya está en curso. Confirma para cancelarla.",
      "CONFIRMATION_REQUIRED",
      [{ estado_actual: fila.estado }]
    );
  }
  await withTransaction((client) => assignmentRepository.cancelar(id, motivo, client));
  const despues = await cargarFilaODetener(id);
  await registrarAuditoria({
    contexto,
    accion: "ASIGNACION_CANCELADA",
    entidad: "asignaciones_practica",
    entidad_id: id,
    valor_anterior: { estado: fila.estado },
    valor_nuevo: { estado: "CANCELADA", motivo },
  });
  const aviso = { tipo: "ASIGNACION_CANCELADA", titulo: "Una asignación de práctica fue cancelada" };
  await notificarParticipantes(despues, { estudiante: aviso, docente: despues.docente_id ? aviso : null, asesor: despues.asesor_id ? aviso : null });
  return mapearAsignacion(despues);
}

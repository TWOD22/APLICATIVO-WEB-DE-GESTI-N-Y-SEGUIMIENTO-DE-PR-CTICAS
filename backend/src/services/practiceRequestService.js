/**
 * Servicio de solicitudes de práctica (flujo v2, lado del estudiante).
 * El estudiante no elige libremente: el sistema calcula su nivel siguiente (sin saltarse ninguno) y él lo confirma.
 * Flujo: BORRADOR (sube documentos) → ENVIADA (Dirección revisa). La plaza y la asignación llegan en la Fase 2b.
 */
import { crearNotificacion, registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { withTransaction } from "../database/transaction.js";
import * as assignmentRepository from "../repositories/assignmentRepository.js";
import * as documentRepository from "../repositories/documentRepository.js";
import * as enrollmentRepository from "../repositories/enrollmentRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";
import * as practiceRequestRepository from "../repositories/practiceRequestRepository.js";
import { ApiError } from "../utils/apiError.js";
import { ROLES } from "../utils/constants.js";

const { ALCANCE, mapearAsignacion } = assignmentRepository;

// Estados de la solicitud que el estudiante puede enviar a Dirección.
const ESTADOS_ENVIABLES = ["BORRADOR", "DEVUELTA"];

// Solo un estudiante puede usar estas operaciones.
function exigirEstudiante(auth) {
  if (auth.rolActivo !== ROLES.ESTUDIANTE) throw ApiError.prohibido();
}

// Estado del nivel en la trayectoria, en palabras del estudiante.
function estadoDelNivel(asignacionEstado) {
  if (!asignacionEstado) return "PENDIENTE";
  if (asignacionEstado === "FINALIZADA") return "FINALIZADA";
  if (asignacionEstado === "BORRADOR") return "EN_SOLICITUD";
  return "EN_CURSO";
}

/**
 * Trayectoria del estudiante: qué práctica ya hizo, cuál sigue y si tiene una solicitud abierta.
 * `nivel_propuesto` es el primer nivel no finalizado; es null si ya hay una práctica abierta o si terminó todo.
 */
export async function obtenerTrayectoria(auth) {
  exigirEstudiante(auth);
  const matricula = await enrollmentRepository.buscarMatriculaActual(auth.usuario.id);
  if (!matricula) {
    throw ApiError.reglaDeNegocio("No tienes una matrícula registrada.", "ENROLLMENT_NOT_FOUND");
  }
  const filas = await practiceRequestRepository.trayectoria({ estudianteId: auth.usuario.id, programaId: matricula.programa_id });
  const niveles = filas.map((f) => ({
    id: f.nivel_id, codigo: f.nivel_codigo, nombre: f.nivel_nombre, semestre: f.semestre, orden: f.orden,
    estado: estadoDelNivel(f.asignacion_estado),
    asignacion_id: f.asignacion_id ?? null,
    asignacion_estado: f.asignacion_estado ?? null,
    periodo_codigo: f.periodo_codigo ?? null,
  }));

  const siguiente = niveles.find((n) => n.estado !== "FINALIZADA") ?? null;
  const abierta = siguiente && siguiente.estado !== "PENDIENTE" ? siguiente : null;
  const nivelPropuesto = siguiente && siguiente.estado === "PENDIENTE"
    ? { id: siguiente.id, codigo: siguiente.codigo, nombre: siguiente.nombre, semestre: siguiente.semestre }
    : null;

  let solicitud = null;
  if (abierta?.asignacion_id) {
    const fila = await assignmentRepository.buscarPorId(abierta.asignacion_id, ALCANCE.estudiante(auth.usuario.id));
    solicitud = fila ? mapearAsignacion(fila) : null;
  }
  return {
    programa: { id: matricula.programa_id, nombre: matricula.programa_nombre },
    niveles,
    nivel_propuesto: nivelPropuesto,
    solicitud_abierta: solicitud,
    trayectoria_completa: niveles.length > 0 && niveles.every((n) => n.estado === "FINALIZADA"),
  };
}

/** Crea la solicitud en BORRADOR para el nivel propuesto. Rechaza otro nivel o una práctica ya abierta. */
export async function crear({ nivel_practica_id }, auth, contexto) {
  exigirEstudiante(auth);
  const periodo = await periodRepository.buscarActivo();
  if (!periodo) throw ApiError.reglaDeNegocio("No hay un periodo académico activo.", "NO_ACTIVE_PERIOD");

  const matricula = await assignmentRepository.buscarMatricula(auth.usuario.id, periodo.id);
  if (!matricula) throw ApiError.reglaDeNegocio("No tienes matrícula en el periodo activo.", "ENROLLMENT_NOT_FOUND");
  if (matricula.estado !== "ACTIVA") {
    throw ApiError.reglaDeNegocio("Tu matrícula no está activa.", "ENROLLMENT_NOT_ACTIVE");
  }

  const trayectoria = await obtenerTrayectoria(auth);
  if (trayectoria.solicitud_abierta) {
    throw ApiError.conflicto(
      "Ya tienes una práctica en curso o una solicitud abierta.",
      "ASSIGNMENT_ALREADY_EXISTS",
      [{ asignacion_id: trayectoria.solicitud_abierta.id, estado: trayectoria.solicitud_abierta.estado }]
    );
  }
  if (!trayectoria.nivel_propuesto) {
    throw ApiError.reglaDeNegocio("Ya completaste todos los niveles de práctica.", "TRAJECTORY_COMPLETE");
  }
  if (nivel_practica_id !== trayectoria.nivel_propuesto.id) {
    throw ApiError.reglaDeNegocio(
      `Tu siguiente práctica es ${trayectoria.nivel_propuesto.nombre}: no puedes saltarte niveles.`,
      "LEVEL_NOT_ALLOWED",
      [{ nivel_propuesto_id: trayectoria.nivel_propuesto.id }]
    );
  }
  // Respaldo ante dos solicitudes simultáneas: la matrícula del periodo no puede tener otra práctica abierta.
  if (await assignmentRepository.existeAsignacionVigente(matricula.id)) {
    throw ApiError.conflicto("Ya tienes una práctica asignada en este periodo.", "ASSIGNMENT_ALREADY_EXISTS");
  }

  const { id } = await withTransaction((client) =>
    practiceRequestRepository.crearBorrador(
      { matriculaId: matricula.id, nivelId: nivel_practica_id, solicitadaPorId: auth.usuario.id },
      client
    )
  );
  await registrarAuditoria({
    contexto,
    accion: "SOLICITUD_CREADA",
    entidad: "asignaciones_practica",
    entidad_id: id,
    valor_nuevo: { nivel: trayectoria.nivel_propuesto.codigo, periodo: periodo.codigo, estado: "BORRADOR" },
  });
  return mapearAsignacion(await assignmentRepository.buscarPorId(id, ALCANCE.estudiante(auth.usuario.id)));
}

// Carga la solicitud del estudiante o responde 404 (si es de otra persona también 404, para no revelar que existe).
async function cargarPropia(id, auth) {
  const fila = await assignmentRepository.buscarPorId(id, ALCANCE.estudiante(auth.usuario.id));
  if (!fila) throw ApiError.noEncontrado("La solicitud no existe.", "REQUEST_NOT_FOUND");
  return fila;
}

/**
 * Envía la solicitud a Dirección (flujo v2.1: documentos y plaza viajan juntos).
 * Exige la plaza elegida y todos los documentos obligatorios cargados (o corregidos, si fue devuelta).
 */
export async function enviar(id, auth, contexto) {
  exigirEstudiante(auth);
  const fila = await cargarPropia(id, auth);
  if (!ESTADOS_ENVIABLES.includes(fila.estado)) {
    throw ApiError.reglaDeNegocio("Esta solicitud ya fue enviada o no admite envío.", "REQUEST_NOT_SUBMITTABLE", [{ estado_actual: fila.estado }]);
  }

  await withTransaction(async (client) => {
    const bloqueada = await practiceRequestRepository.bloquear(id, client);
    if (!bloqueada || !ESTADOS_ENVIABLES.includes(bloqueada.estado)) {
      throw ApiError.reglaDeNegocio("Esta solicitud ya fue enviada o no admite envío.", "REQUEST_NOT_SUBMITTABLE");
    }
    if (!bloqueada.institucion_solicitada_id) {
      throw ApiError.reglaDeNegocio(
        "Elige la institución donde quieres hacer tu práctica antes de enviar la solicitud.",
        "SITE_REQUIRED"
      );
    }
    const documentos = await practiceRequestRepository.estadoDocumentosObligatorios(id, client);
    if (documentos.faltantes.length) {
      throw ApiError.reglaDeNegocio(
        "Faltan documentos obligatorios por cargar o corregir.",
        "DOCUMENTS_INCOMPLETE",
        documentos.faltantes.map((f) => ({ tipo_id: f.tipo_id, nombre: f.nombre, estado: f.estado ?? "SIN_CARGAR" }))
      );
    }
    await practiceRequestRepository.marcarEnviada(id, client);
  });

  const despues = mapearAsignacion(await cargarPropia(id, auth));
  await registrarAuditoria({
    contexto,
    accion: "SOLICITUD_ENVIADA",
    entidad: "asignaciones_practica",
    entidad_id: id,
    valor_anterior: { estado: fila.estado },
    valor_nuevo: { estado: "ENVIADA" },
  });
  // Aviso a Dirección (mejor esfuerzo, igual que el resto de notificaciones de esta fase).
  const directores = await documentRepository.listarDirectores();
  await Promise.all(
    directores
      .filter((d) => d.firebase_uid)
      .map((d) =>
        crearNotificacion(d.firebase_uid, {
          tipo: "SOLICITUD_ENVIADA",
          titulo: fila.estado === "DEVUELTA" ? "Un estudiante reenvió su solicitud" : "Hay una solicitud de práctica por revisar",
          mensaje: `${despues.estudiante.nombre_completo} · ${despues.nivel.nombre}`,
          entidad: { tipo: "asignacion", id },
        })
      )
  );
  return despues;
}

/** El estudiante descarta su borrador (solo mientras no se haya enviado). */
export async function descartar(id, auth, contexto) {
  exigirEstudiante(auth);
  const fila = await cargarPropia(id, auth);
  if (fila.estado !== "BORRADOR") {
    throw ApiError.reglaDeNegocio("Solo se puede descartar una solicitud que aún no se envió.", "REQUEST_NOT_DISCARDABLE", [{ estado_actual: fila.estado }]);
  }
  await withTransaction((client) => practiceRequestRepository.descartar(id, client));
  await registrarAuditoria({
    contexto,
    accion: "SOLICITUD_DESCARTADA",
    entidad: "asignaciones_practica",
    entidad_id: id,
    valor_anterior: { estado: "BORRADOR" },
  });
  return { id, descartada: true };
}

// ───────────────────────── Elección de plaza ─────────────────────────

// Estados desde los que el estudiante puede elegir o cambiar su plaza: mientras arma el expediente (BORRADOR)
// o lo corrige tras una devolución. Una vez enviada, solo Dirección puede cambiarla (con motivo).
const ESTADOS_ELEGIR_PLAZA = ["BORRADOR", "DEVUELTA"];

/** Instituciones con convenio vigente donde se puede pedir plaza. */
export async function listarPlazas() {
  return practiceRequestRepository.listarPlazasDisponibles();
}

/** El estudiante elige su plaza mientras arma su expediente. Dirección la valida (o la cambia) al revisar la solicitud. */
export async function elegirPlaza(id, { institucion_id }, auth, contexto) {
  exigirEstudiante(auth);
  const fila = await cargarPropia(id, auth);
  if (!ESTADOS_ELEGIR_PLAZA.includes(fila.estado)) {
    throw ApiError.reglaDeNegocio(
      "Ya enviaste tu solicitud: si la plaza debe cambiar, Dirección lo hará al revisarla.",
      "SITE_NOT_ALLOWED_YET",
      [{ estado_actual: fila.estado }]
    );
  }
  const institucion = await assignmentRepository.buscarInstitucion(institucion_id);
  if (!institucion) throw ApiError.reglaDeNegocio("La institución no existe.", "INSTITUTION_NOT_FOUND");
  if (!institucion.activa || institucion.estado_convenio !== "VIGENTE") {
    throw ApiError.reglaDeNegocio(
      "Solo puedes elegir instituciones activas con convenio vigente.",
      "INSTITUTION_NOT_AVAILABLE"
    );
  }

  await withTransaction(async (client) => {
    const bloqueada = await practiceRequestRepository.bloquear(id, client);
    if (!bloqueada || !ESTADOS_ELEGIR_PLAZA.includes(bloqueada.estado)) {
      throw ApiError.reglaDeNegocio("La solicitud cambió de estado: recarga e inténtalo de nuevo.", "SITE_NOT_ALLOWED_YET");
    }
    await practiceRequestRepository.guardarPlazaElegida(id, institucion.id, client);
  });

  await registrarAuditoria({
    contexto,
    accion: "PLAZA_ELEGIDA",
    entidad: "asignaciones_practica",
    entidad_id: id,
    valor_anterior: { institucion_solicitada_id: fila.institucion_solicitada_id ?? null },
    valor_nuevo: { institucion_solicitada_id: institucion.id, institucion: institucion.nombre },
  });
  return mapearAsignacion(await cargarPropia(id, auth));
}

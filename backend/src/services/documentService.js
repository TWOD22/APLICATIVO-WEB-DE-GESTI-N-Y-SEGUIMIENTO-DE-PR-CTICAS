/**
 * Servicio de documentos legales.
 * Flujo: el estudiante sube un PDF por cada requisito → el Director lo aprueba o lo devuelve con observación →
 * cuando TODOS los obligatorios están aprobados se habilita la bitácora (y se bloquea de nuevo si alguno deja de estarlo).
 * Los archivos viven en el almacenamiento; en PostgreSQL se guardan versiones, estados y revisiones.
 */
import { createHash, randomUUID } from "node:crypto";
import { crearUrlFirmada, eliminarArchivo, subirArchivo } from "../adapters/storageAdapter.js";
import { crearNotificacion, registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { logger } from "../config/logger.js";
import { withTransaction } from "../database/transaction.js";
import * as assignmentRepository from "../repositories/assignmentRepository.js";
import * as documentRepository from "../repositories/documentRepository.js";
import { ApiError } from "../utils/apiError.js";
import { esPdfLegible, sanitizarNombre } from "../utils/archivos.js";
import { ROLES } from "../utils/constants.js";

const { ALCANCE } = assignmentRepository;

/** Estados de la práctica en los que el estudiante todavía puede cargar documentos. */
const ESTADOS_CARGA = ["PENDIENTE_DOCUMENTOS", "ACTIVA"];
/** Estados en los que Dirección ya no puede revisar documentos. */
const ESTADOS_CERRADOS = ["CANCELADA", "FINALIZADA"];

// Decisiones de revisión: a qué estado pasa el documento y desde qué estados se permite.
const DECISIONES = {
  APROBAR: { destino: "APROBADO", desde: ["EN_REVISION"] },
  RECHAZAR: { destino: "POR_CORREGIR", desde: ["EN_REVISION", "APROBADO"] },
  PENDIENTE: { destino: "EN_REVISION", desde: ["APROBADO", "POR_CORREGIR"] },
};

// ───────────────────────── Utilidades ─────────────────────────

/** Solo el Director y el Estudiante acceden al expediente legal; Docente y Asesor no. */
function alcanceDocumental(auth) {
  if (auth.rolActivo === ROLES.DIRECTOR_PROGRAMA) return ALCANCE.director();
  if (auth.rolActivo === ROLES.ESTUDIANTE) return ALCANCE.estudiante(auth.usuario.id);
  // Docentes y asesores no tienen acceso al expediente legal.
  throw ApiError.prohibido("Tu rol no tiene acceso a los documentos legales.", "LEGAL_DOCUMENTS_FORBIDDEN");
}

/** Carga la asignación dentro del alcance del usuario o responde 404. */
async function cargarAsignacionODetener(id, auth) {
  const fila = await assignmentRepository.buscarPorId(id, alcanceDocumental(auth));
  if (!fila) throw ApiError.noEncontrado("La asignación no existe.", "ASSIGNMENT_NOT_FOUND");
  return fila;
}

/** Da forma a un requisito con su documento vigente para el frontend (estado, versión, archivo y si se puede subir). */
function armarItem(fila, { puedeSubir }) {
  const estado = fila.estado ?? "SIN_CARGAR";
  return {
    requisito_id: fila.requisito_id,
    tipo: {
      id: fila.tipo_id,
      codigo: fila.codigo,
      nombre: fila.nombre,
      descripcion: fila.descripcion,
      tipos_mime_permitidos: fila.tipos_mime_permitidos,
      tamano_maximo_bytes: fila.tamano_maximo_bytes,
    },
    obligatorio: fila.obligatorio,
    estado,
    documento_id: fila.documento_id,
    numero_version: fila.numero_version,
    total_versiones: fila.total_versiones,
    archivo: fila.documento_id ? { nombre: fila.archivo_nombre, tamano_bytes: fila.archivo_tamano } : null,
    observacion: estado === "POR_CORREGIR" ? fila.observacion_revision : null,
    enviado_en: fila.enviado_en,
    revisado_en: fila.revisado_en,
    // Una versión aprobada no se sobrescribe: solo Dirección puede devolverla a revisión.
    puede_subir: puedeSubir && estado !== "APROBADO",
  };
}

/** Cuenta documentos por estado y determina si el expediente está completo (todos los obligatorios aprobados). */
function armarResumen(filas) {
  const por = (estado) => filas.filter((f) => (f.estado ?? "SIN_CARGAR") === estado).length;
  const obligatorios = filas.filter((f) => f.obligatorio);
  const aprobadosObligatorios = obligatorios.filter((f) => f.estado === "APROBADO").length;
  return {
    total: filas.length,
    aprobados: por("APROBADO"),
    en_revision: por("EN_REVISION"),
    por_corregir: por("POR_CORREGIR"),
    sin_cargar: por("SIN_CARGAR"),
    total_obligatorios: obligatorios.length,
    aprobados_obligatorios: aprobadosObligatorios,
    expediente_completo: aprobadosObligatorios === obligatorios.length,
  };
}

// Crea una notificación solo si el destinatario tiene cuenta en Firebase.
const notificar = (firebaseUid, datos) =>
  firebaseUid ? crearNotificacion(firebaseUid, datos) : Promise.resolve(false);

/** Avisa a todos los Directores activos. */
async function notificarDirectores(datos) {
  const directores = await documentRepository.listarDirectores();
  await Promise.all(directores.map((d) => notificar(d.firebase_uid, datos)));
}

/**
 * Regla central (documento maestro 4.3): la bitácora se habilita cuando TODOS los requisitos obligatorios
 * tienen una versión vigente aprobada. Se ejecuta dentro de la transacción que ya bloquea la asignación.
 * Devuelve { completo, cambio: null | "HABILITADA" | "BLOQUEADA" | "ALERTA" }.
 */
async function recalcularHabilitacion(client, asignacion) {
  const { total, aprobados } = await documentRepository.contarObligatorios(asignacion.id, client);
  const completo = aprobados === total;
  const bitacora = await documentRepository.buscarBitacoraDeAsignacion(asignacion.id, client);

  if (completo && asignacion.estado === "PENDIENTE_DOCUMENTOS") {
    await documentRepository.cambiarEstadoAsignacion(asignacion.id, "ACTIVA", client);
    if (bitacora?.estado === "BLOQUEADA") await documentRepository.cambiarEstadoBitacora(bitacora.id, "BORRADOR", client);
    return { completo, cambio: "HABILITADA" };
  }
  if (!completo && asignacion.estado === "ACTIVA") {
    if (!bitacora || ["BORRADOR", "BLOQUEADA"].includes(bitacora.estado)) {
      await documentRepository.cambiarEstadoAsignacion(asignacion.id, "PENDIENTE_DOCUMENTOS", client);
      if (bitacora?.estado === "BORRADOR") await documentRepository.cambiarEstadoBitacora(bitacora.id, "BLOQUEADA", client);
      return { completo, cambio: "BLOQUEADA" };
    }
    return { completo, cambio: "ALERTA" };
  }
  // Una entrega ya enviada no se elimina por una revisión posterior: solo se alerta a Dirección.
  if (!completo && asignacion.estado === "PENDIENTE_EVALUACION") return { completo, cambio: "ALERTA" };
  return { completo, cambio: null };
}

/** Informa a quien corresponda tras recalcular la habilitación (estudiante, o auditoría + Directores si la bitácora ya estaba enviada). */
async function avisarCambioDeHabilitacion({ resultado, asignacion, contexto }) {
  if (resultado.cambio === "HABILITADA") {
    await notificar(asignacion.estudiante_firebase_uid, {
      tipo: "BITACORA_HABILITADA",
      titulo: "Tu bitácora ya está habilitada",
      mensaje: "Dirección aprobó todos tus documentos legales. Ya puedes diligenciar tu bitácora.",
      entidad: { tipo: "asignacion", id: asignacion.id },
    });
  } else if (resultado.cambio === "BLOQUEADA") {
    await notificar(asignacion.estudiante_firebase_uid, {
      tipo: "BITACORA_BLOQUEADA",
      titulo: "Tu bitácora volvió a bloquearse",
      mensaje: "Un documento legal dejó de estar aprobado. Tu borrador se conserva.",
      entidad: { tipo: "asignacion", id: asignacion.id },
    });
  } else if (resultado.cambio === "ALERTA") {
    await registrarAuditoria({
      contexto,
      accion: "EXPEDIENTE_MODIFICADO_CON_BITACORA_EN_CURSO",
      entidad: "asignaciones_practica",
      entidad_id: asignacion.id,
      valor_nuevo: { estado_asignacion: asignacion.estado },
    });
    await notificarDirectores({
      tipo: "ALERTA_EXPEDIENTE",
      titulo: "Un documento aprobado cambió después de la entrega",
      mensaje: "Revisa el expediente: la bitácora ya estaba enviada y no se modificó.",
      prioridad: "alta",
      entidad: { tipo: "asignacion", id: asignacion.id },
    });
  }
}

// ───────────────────────── Casos de uso ─────────────────────────

/** Requisitos de la práctica con el estado de cada documento (Director: cualquiera; Estudiante: la suya). */
export async function listarDeAsignacion(asignacionId, auth) {
  const fila = await cargarAsignacionODetener(asignacionId, auth);
  const requisitos = await documentRepository.listarRequisitos(asignacionId);
  const puedeSubir = auth.rolActivo === ROLES.ESTUDIANTE && ESTADOS_CARGA.includes(fila.estado);
  return {
    asignacion: {
      id: fila.id,
      estado: fila.estado,
      periodo: { id: fila.periodo_id, codigo: fila.periodo_codigo },
      nivel: { id: fila.nivel_id, codigo: fila.nivel_codigo, nombre: fila.nivel_nombre },
      institucion: { id: fila.institucion_id, nombre: fila.institucion_nombre },
      estudiante: {
        id: fila.estudiante_id,
        nombre_completo: `${fila.estudiante_nombres} ${fila.estudiante_apellidos}`,
        documento: fila.estudiante_documento,
      },
    },
    documentos: requisitos.map((r) => armarItem(r, { puedeSubir })),
    resumen: armarResumen(requisitos),
  };
}

/** El estudiante sube (o reemplaza) el PDF de un requisito. Valida estado de la práctica, tamaño, tipo, extensión y contenido real; guarda como nueva versión. */
export async function subir({ asignacionId, tipoId, contenido, tipoMime, nombreArchivo }, auth, contexto) {
  if (auth.rolActivo !== ROLES.ESTUDIANTE) throw ApiError.prohibido();
  const asignacion = await assignmentRepository.buscarPorId(asignacionId, ALCANCE.estudiante(auth.usuario.id));
  if (!asignacion) throw ApiError.noEncontrado("La asignación no existe.", "ASSIGNMENT_NOT_FOUND");
  if (!ESTADOS_CARGA.includes(asignacion.estado)) {
    throw ApiError.reglaDeNegocio("La práctica ya no admite carga de documentos.", "ASSIGNMENT_CLOSED");
  }
  const requisito = await documentRepository.buscarRequisito(asignacionId, tipoId);
  if (!requisito) {
    throw ApiError.noEncontrado("Ese documento no es un requisito de tu práctica.", "REQUIREMENT_NOT_FOUND");
  }

    // ── Validación del archivo (se confía en el contenido real, no solo en lo que declara el cliente) ──
  // ── Validación del archivo (se confía en el contenido real, no solo en lo que declara el cliente) ──
  if (!Buffer.isBuffer(contenido) || contenido.length === 0) {
    throw ApiError.solicitudInvalida("Adjunta el archivo en el cuerpo de la solicitud.", [], "FILE_REQUIRED");
  }
  if (contenido.length > requisito.tamano_maximo_bytes) {
    throw ApiError.demasiadoGrande(
      `El archivo supera el máximo de ${Math.floor(requisito.tamano_maximo_bytes / 1024 / 1024)} MB para este documento.`,
      "FILE_TOO_LARGE"
    );
  }
  const mime = String(tipoMime ?? "").split(";")[0].trim().toLowerCase();
  if (!requisito.tipos_mime_permitidos.includes(mime)) {
    throw ApiError.reglaDeNegocio("El formato del archivo no está permitido. Sube un PDF.", "FILE_TYPE_NOT_ALLOWED", [
      { permitidos: requisito.tipos_mime_permitidos },
    ]);
  }
  const nombre = sanitizarNombre(nombreArchivo, `${requisito.codigo}.pdf`);
  if (!nombre.toLowerCase().endsWith(".pdf")) {
    throw ApiError.reglaDeNegocio("El archivo debe tener extensión .pdf.", "FILE_EXTENSION_NOT_ALLOWED");
  }
  if (!esPdfLegible(contenido)) {
    throw ApiError.reglaDeNegocio("El archivo no es un PDF válido o está incompleto.", "FILE_NOT_READABLE");
  }

    // Un documento aprobado no se puede sobrescribir.
  const previo = await documentRepository.buscarDocumentoActual(asignacionId, tipoId);
  if (previo?.estado === "APROBADO") {
    throw ApiError.reglaDeNegocio(
      "Este documento ya fue aprobado. Si necesitas cambiarlo, solicita a Dirección que lo devuelva a revisión.",
      "DOCUMENT_APPROVED_LOCKED"
    );
  }

  // ── 1) Archivo en el almacenamiento (fuera de la transacción) ──
  const archivoId = randomUUID();
  const ruta = `documentos_legales/${asignacion.periodo_id}/${asignacion.estudiante_id}/${tipoId}/${archivoId}.pdf`;
  const hash = createHash("sha256").update(contenido).digest("hex");
  const { bucket } = await subirArchivo({ ruta, contenido, tipoMime: mime });

  // ── 2) Registro en PostgreSQL; si algo falla se retira el archivo huérfano ──
  let versionNueva;
  try {
        // La transacción bloquea la asignación para que dos cargas simultáneas no generen versiones repetidas.
    versionNueva = await withTransaction(async (client) => {
      const bloqueada = await documentRepository.bloquearAsignacion(asignacionId, client);
      if (!bloqueada || !ESTADOS_CARGA.includes(bloqueada.estado)) {
        throw ApiError.reglaDeNegocio("La práctica ya no admite carga de documentos.", "ASSIGNMENT_CLOSED");
      }
      const actual = await documentRepository.buscarDocumentoActual(asignacionId, tipoId, client);
      if (actual?.estado === "APROBADO") {
        throw ApiError.reglaDeNegocio("Este documento ya fue aprobado.", "DOCUMENT_APPROVED_LOCKED");
      }
            // La versión anterior pasa a REEMPLAZADO y se crea la nueva con número consecutivo.
      const numeroVersion = (await documentRepository.ultimaVersion(asignacionId, tipoId, client)) + 1;
      if (actual) await documentRepository.reemplazarVersionActual(actual.id, client);
      await documentRepository.crearArchivo(
        {
          id: archivoId, bucket, ruta, nombreOriginal: nombre, tipoMime: mime,
          tamanoBytes: contenido.length, hashSha256: hash, subidoPorId: auth.usuario.id,
        },
        client
      );
      await documentRepository.crearDocumento({ asignacionId, tipoId, archivoId, numeroVersion }, client);
      return numeroVersion;
    });
  } catch (error) {
        // Si falló PostgreSQL, se borra el archivo ya subido para no dejar huérfanos.
    try {
      await eliminarArchivo(ruta);
    } catch (errorLimpieza) {
      logger.error({ err: errorLimpieza, archivo_id: archivoId }, "No se pudo retirar un archivo huérfano del almacenamiento");
    }
    throw error;
  }

    // Auditoría y avisos a los Directores (mejor esfuerzo).
  await registrarAuditoria({
    contexto,
    accion: "DOCUMENTO_CARGADO",
    entidad: "documentos_legales_estudiantes",
    entidad_id: asignacionId,
    valor_nuevo: { tipo: requisito.codigo, version: versionNueva, archivo: nombre, tamano_bytes: contenido.length, hash_sha256: hash },
  });
  await notificarDirectores({
    tipo: "DOCUMENTO_PENDIENTE_REVISION",
    titulo: "Hay un documento por revisar",
    mensaje: `${asignacion.estudiante_nombres} ${asignacion.estudiante_apellidos} cargó: ${requisito.nombre}`,
    entidad: { tipo: "asignacion", id: asignacionId },
  });

  const filas = await documentRepository.listarRequisitos(asignacionId);
  return armarItem(filas.find((f) => f.tipo_id === tipoId), { puedeSubir: true });
}

/** El Director aprueba, rechaza o devuelve a revisión un documento. Recalcula si la bitácora debe habilitarse o bloquearse. */
export async function revisar(documentoId, { decision, motivo, observacion }, contexto) {
  const regla = DECISIONES[decision];
  const previo = await documentRepository.buscarDocumento(documentoId);
  if (!previo) throw ApiError.noEncontrado("El documento no existe.", "DOCUMENT_NOT_FOUND");
    // El rechazo exige motivo/observación para que el estudiante sepa qué corregir.
  const observacionFinal = decision === "RECHAZAR" ? (motivo ? `${motivo}. ${observacion}` : observacion) : null;

  const { documento, asignacion, resultado } = await withTransaction(async (client) => {
    // Mismo orden de bloqueo que la carga (asignación primero) para evitar interbloqueos.
    const bloqueada = await documentRepository.bloquearAsignacion(previo.asignacion_id, client);
    const doc = await documentRepository.buscarDocumento(documentoId, client, { bloquear: true });
    if (!doc) throw ApiError.noEncontrado("El documento no existe.", "DOCUMENT_NOT_FOUND");
    if (!doc.es_version_actual) {
      throw ApiError.conflicto("Solo se puede revisar la versión vigente del documento.", "DOCUMENT_NOT_CURRENT");
    }
    if (ESTADOS_CERRADOS.includes(bloqueada.estado)) {
      throw ApiError.reglaDeNegocio("La práctica está cerrada: ya no se pueden revisar documentos.", "ASSIGNMENT_CLOSED");
    }
    if (!regla.desde.includes(doc.estado)) {
      throw ApiError.reglaDeNegocio(
        `No se puede ${decision === "APROBAR" ? "aprobar" : decision === "RECHAZAR" ? "rechazar" : "devolver a revisión"} un documento en estado ${doc.estado}.`,
        "INVALID_DOCUMENT_TRANSITION",
        [{ estado_actual: doc.estado }]
      );
    }
    await documentRepository.registrarRevision(
      documentoId,
      { estado: regla.destino, observacion: observacionFinal, revisorId: contexto.actor.usuario_id },
      client
    );
    const resultado = await recalcularHabilitacion(client, bloqueada);
    return { documento: doc, asignacion: bloqueada, resultado };
  });

  await registrarAuditoria({
    contexto,
    accion: `DOCUMENTO_${regla.destino}`,
    entidad: "documentos_legales_estudiantes",
    entidad_id: documentoId,
    valor_anterior: { estado: documento.estado },
    valor_nuevo: { estado: regla.destino, ...(observacionFinal ? { observacion: observacionFinal } : {}), tipo: documento.tipo_codigo },
  });
    // Notificación al estudiante según la decisión.
  const aviso = {
    APROBADO: { tipo: "DOCUMENTO_APROBADO", titulo: "Un documento fue aprobado", mensaje: documento.tipo_nombre },
    POR_CORREGIR: { tipo: "DOCUMENTO_DEVUELTO", titulo: "Un documento necesita corrección", mensaje: `${documento.tipo_nombre}: ${observacionFinal}` },
    EN_REVISION: { tipo: "DOCUMENTO_EN_REVISION", titulo: "Un documento volvió a revisión", mensaje: documento.tipo_nombre },
  }[regla.destino];
  await notificar(asignacion.estudiante_firebase_uid, { ...aviso, entidad: { tipo: "documento", id: documentoId } });
  await avisarCambioDeHabilitacion({ resultado, asignacion, contexto });

  return {
    documento_id: documentoId,
    estado: regla.destino,
    observacion: observacionFinal,
    expediente_completo: resultado.completo,
    bitacora: resultado.cambio,
  };
}

/** "Aprobar expediente completo": solo si no hay documentos devueltos ni requisitos obligatorios sin cargar. */
export async function aprobarExpediente(asignacionId, contexto) {
  const existe = await assignmentRepository.buscarPorId(asignacionId, ALCANCE.director());
  if (!existe) throw ApiError.noEncontrado("La asignación no existe.", "ASSIGNMENT_NOT_FOUND");

    // Todo en una transacción: aprobar los documentos en revisión y recalcular la habilitación de la bitácora.
  const { asignacion, aprobados, resultado } = await withTransaction(async (client) => {
    const bloqueada = await documentRepository.bloquearAsignacion(asignacionId, client);
    if (ESTADOS_CERRADOS.includes(bloqueada.estado)) {
      throw ApiError.reglaDeNegocio("La práctica está cerrada: ya no se pueden revisar documentos.", "ASSIGNMENT_CLOSED");
    }
    const requisitos = await documentRepository.listarRequisitos(asignacionId, client);
        // No se aprueba el expediente si hay documentos devueltos o faltan obligatorios.
    const devueltos = requisitos.filter((r) => r.estado === "POR_CORREGIR");
    if (devueltos.length) {
      throw ApiError.reglaDeNegocio("Hay documentos rechazados: no se puede aprobar el expediente.", "REJECTED_DOCUMENT_EXISTS",
        devueltos.map((r) => ({ tipo: r.nombre })));
    }
    const faltantes = requisitos.filter((r) => r.obligatorio && !r.documento_id);
    if (faltantes.length) {
      throw ApiError.reglaDeNegocio("Faltan documentos obligatorios por cargar.", "DOCUMENTS_MISSING",
        faltantes.map((r) => ({ tipo: r.nombre })));
    }
    const aprobados = await documentRepository.aprobarEnRevision(asignacionId, contexto.actor.usuario_id, client);
    const resultado = await recalcularHabilitacion(client, bloqueada);
    return { asignacion: bloqueada, aprobados, resultado };
  });

  if (aprobados.length) {
    await registrarAuditoria({
      contexto,
      accion: "EXPEDIENTE_APROBADO",
      entidad: "asignaciones_practica",
      entidad_id: asignacionId,
      valor_nuevo: { documentos_aprobados: aprobados.length },
    });
    await notificar(asignacion.estudiante_firebase_uid, {
      tipo: "DOCUMENTO_APROBADO",
      titulo: "Tu expediente fue aprobado",
      mensaje: `Dirección aprobó ${aprobados.length} documento(s).`,
      entidad: { tipo: "asignacion", id: asignacionId },
    });
    await avisarCambioDeHabilitacion({ resultado, asignacion, contexto });
  }
  return { aprobados: aprobados.length, expediente_completo: resultado.completo, bitacora: resultado.cambio };
}

/** URL firmada de corta duración. Solo Director y el propio estudiante; las consultas de Dirección se auditan. */
export async function urlDeDescarga(documentoId, auth, contexto) {
  const doc = await documentRepository.buscarDocumento(documentoId);
  if (!doc) throw ApiError.noEncontrado("El documento no existe.", "DOCUMENT_NOT_FOUND");
  const esDirector = auth.rolActivo === ROLES.DIRECTOR_PROGRAMA;
  if (!esDirector && !(auth.rolActivo === ROLES.ESTUDIANTE && doc.estudiante_id === auth.usuario.id)) {
    // Quien no es dueño recibe "no existe" para no revelar documentos ajenos.
    if (auth.rolActivo === ROLES.ESTUDIANTE) throw ApiError.noEncontrado("El documento no existe.", "DOCUMENT_NOT_FOUND");
    throw ApiError.prohibido("Tu rol no tiene acceso a los documentos legales.", "LEGAL_DOCUMENTS_FORBIDDEN");
  }
    // Se entrega una URL temporal (no el archivo directo).
  const { url, expira_en_segundos } = await crearUrlFirmada(doc.ruta);
  if (esDirector) {
    await registrarAuditoria({
      contexto,
      accion: "DOCUMENTO_CONSULTADO",
      entidad: "documentos_legales_estudiantes",
      entidad_id: documentoId,
      valor_nuevo: { tipo: doc.tipo_codigo, estudiante_id: doc.estudiante_id, version: doc.numero_version },
    });
  }
  return { documento_id: documentoId, archivo_nombre: doc.archivo_nombre, url, expira_en_segundos };
}

/** Pantalla "Auditoría documental" del Director: un expediente por práctica, con resumen. */
export async function listarExpedientes(filtros) {
  const { filas, total, resumen } = await documentRepository.listarExpedientes(filtros);
  return {
    total,
    resumen,
    filas: filas.map((f) => ({
      asignacion_id: f.asignacion_id,
      asignacion_estado: f.asignacion_estado,
      expediente_estado: f.expediente_estado,
      periodo: { id: f.periodo_id, codigo: f.periodo_codigo },
      nivel: { id: f.nivel_id, codigo: f.nivel_codigo, nombre: f.nivel_nombre },
      estudiante: {
        id: f.estudiante_id,
        nombre_completo: `${f.estudiante_nombres} ${f.estudiante_apellidos}`,
        documento: f.estudiante_documento,
      },
      institucion: { id: f.institucion_id, nombre: f.institucion_nombre },
      documentos: {
        total: f.total_requisitos, aprobados: f.aprobados, en_revision: f.en_revision,
        por_corregir: f.por_corregir, sin_cargar: f.sin_cargar,
      },
    })),
  };
}

/**
 * Servicio de la guía de criterios: el PDF con el que el docente evalúa un nivel en un periodo.
 * Solo el docente asignado a ese nivel y periodo la sube (cada carga crea una versión nueva y la anterior queda
 * guardada). La leen el Director, el docente del nivel, los estudiantes de ese nivel y los asesores con
 * practicantes en él. La lectura entrega una URL firmada temporal.
 */
import { createHash, randomUUID } from "node:crypto";
import { crearUrlFirmada, eliminarArchivo, subirArchivo } from "../adapters/storageAdapter.js";
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { withTransaction } from "../database/transaction.js";
import * as criteriaGuideRepository from "../repositories/criteriaGuideRepository.js";
import * as documentRepository from "../repositories/documentRepository.js";
import * as levelTeacherRepository from "../repositories/levelTeacherRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";
import { ApiError } from "../utils/apiError.js";
import { esPdfLegible, sanitizarNombre } from "../utils/archivos.js";
import { ROLES } from "../utils/constants.js";
import { logger } from "../config/logger.js";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

async function cargarNivelYPeriodo(nivelId, periodoId) {
  const nivel = await levelTeacherRepository.buscarNivel(nivelId);
  if (!nivel) throw ApiError.noEncontrado("El nivel de práctica no existe.", "LEVEL_NOT_FOUND");
  const periodo = await periodRepository.buscarPorId(periodoId);
  if (!periodo) throw ApiError.noEncontrado("El periodo no existe.", "PERIOD_NOT_FOUND");
  return { nivel, periodo };
}

/** El docente solo gestiona la guía de los niveles que tiene asignados en ese periodo. */
async function exigirDocenteDelNivel(auth, nivelId, periodoId, db) {
  const vigente = await levelTeacherRepository.buscarVigente(nivelId, periodoId, db);
  if (auth.rolActivo !== ROLES.DOCENTE_SUPERVISOR || !vigente || vigente.docente_id !== auth.usuario.id) {
    throw ApiError.prohibido("Solo el docente asignado a este nivel puede gestionar su guía de criterios.", "NOT_LEVEL_TEACHER");
  }
}

/** Quién puede leerla: Director, docente del nivel, estudiante o asesor con práctica en ese nivel y periodo. */
async function puedeLeer(auth, nivelId, periodoId) {
  switch (auth.rolActivo) {
    case ROLES.DIRECTOR_PROGRAMA: return true;
    case ROLES.DOCENTE_SUPERVISOR: {
      const vigente = await levelTeacherRepository.buscarVigente(nivelId, periodoId);
      return vigente?.docente_id === auth.usuario.id;
    }
    case ROLES.ESTUDIANTE: return criteriaGuideRepository.estudianteTieneNivel(auth.usuario.id, nivelId, periodoId);
    case ROLES.ASESOR_SITIO: return criteriaGuideRepository.asesorTieneNivel(auth.usuario.id, nivelId, periodoId);
    default: return false;
  }
}

function exigirPeriodoAbierto(periodo) {
  if (periodo.estado === "CERRADO") {
    throw ApiError.reglaDeNegocio("El periodo está cerrado: no se puede cambiar la guía de criterios.", "PERIOD_CLOSED");
  }
}

const aVersion = (f) => ({
  id: f.id, version: f.version, vigente: f.vigente, subida_en: f.creado_en,
  archivo_nombre: f.archivo_nombre, tamano_bytes: Number(f.tamano_bytes), docente: f.docente_nombre,
});

/**
 * Guía vigente (con URL firmada) y, para Dirección y el docente, el historial de versiones.
 * Si aún no hay guía responde `guia: null`.
 */
export async function obtener(nivelId, periodoId, auth) {
  const { nivel, periodo } = await cargarNivelYPeriodo(nivelId, periodoId);
  if (!(await puedeLeer(auth, nivel.id, periodo.id))) {
    throw ApiError.noEncontrado("No hay una guía de criterios disponible para ti en este nivel.", "GUIDE_NOT_FOUND");
  }
  const versiones = await criteriaGuideRepository.listarVersiones(nivel.id, periodo.id);
  const vigente = versiones.find((v) => v.vigente) ?? null;
  const resultado = {
    nivel: { id: nivel.id, codigo: nivel.codigo, nombre: nivel.nombre },
    periodo: { id: periodo.id, codigo: periodo.codigo },
    guia: null,
  };
  if (vigente) {
    const { url, expira_en_segundos } = await crearUrlFirmada(vigente.ruta);
    resultado.guia = { ...aVersion(vigente), url, expira_en_segundos };
  }
  if (auth.rolActivo === ROLES.DIRECTOR_PROGRAMA || auth.rolActivo === ROLES.DOCENTE_SUPERVISOR) {
    resultado.versiones = versiones.map(aVersion);
  }
  return resultado;
}

/** El docente del nivel sube el PDF: crea la versión siguiente y deja la anterior como histórica. */
export async function subir({ nivelId, periodoId, contenido, tipoMime, nombreArchivo }, auth, contexto) {
  const { nivel, periodo } = await cargarNivelYPeriodo(nivelId, periodoId);
  await exigirDocenteDelNivel(auth, nivel.id, periodo.id);
  exigirPeriodoAbierto(periodo);

  if (!Buffer.isBuffer(contenido) || contenido.length === 0) {
    throw ApiError.solicitudInvalida("Adjunta el archivo en el cuerpo de la solicitud.", [], "FILE_REQUIRED");
  }
  if (contenido.length > TAMANO_MAXIMO_BYTES) {
    throw ApiError.demasiadoGrande("El archivo supera el máximo de 10 MB.", "FILE_TOO_LARGE");
  }
  const mime = String(tipoMime ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "application/pdf") {
    throw ApiError.reglaDeNegocio("El formato del archivo no está permitido. Sube un PDF.", "FILE_TYPE_NOT_ALLOWED");
  }
  const nombre = sanitizarNombre(nombreArchivo, `guia-criterios-${nivel.codigo}.pdf`);
  if (!nombre.toLowerCase().endsWith(".pdf")) {
    throw ApiError.reglaDeNegocio("El archivo debe tener extensión .pdf.", "FILE_EXTENSION_NOT_ALLOWED");
  }
  if (!esPdfLegible(contenido)) {
    throw ApiError.reglaDeNegocio("El archivo no es un PDF válido o está incompleto.", "FILE_NOT_READABLE");
  }

  const archivoId = randomUUID();
  const ruta = `guias_criterios/${periodo.id}/${nivel.id}/${archivoId}.pdf`;
  const hash = createHash("sha256").update(contenido).digest("hex");
  const { bucket } = await subirArchivo({ ruta, contenido, tipoMime: mime });

  let version;
  try {
    version = await withTransaction(async (client) => {
      const vigente = await criteriaGuideRepository.bloquearDocenteNivel(nivel.id, periodo.id, client);
      if (!vigente || vigente.docente_id !== auth.usuario.id) {
        throw ApiError.prohibido("Ya no eres el docente de este nivel.", "NOT_LEVEL_TEACHER");
      }
      const numero = (await criteriaGuideRepository.ultimaVersion(nivel.id, periodo.id, client)) + 1;
      await criteriaGuideRepository.desmarcarVigente(nivel.id, periodo.id, client);
      await documentRepository.crearArchivo(
        { id: archivoId, bucket, ruta, nombreOriginal: nombre, tipoMime: mime, tamanoBytes: contenido.length, hashSha256: hash, subidoPorId: auth.usuario.id },
        client
      );
      await criteriaGuideRepository.crear(
        { nivelId: nivel.id, periodoId: periodo.id, docenteId: auth.usuario.id, archivoId, version: numero },
        client
      );
      return numero;
    });
  } catch (error) {
    try {
      await eliminarArchivo(ruta);
    } catch (errorLimpieza) {
      logger.error({ err: errorLimpieza, archivo_id: archivoId }, "No se pudo retirar un archivo huérfano del almacenamiento");
    }
    throw error;
  }

  await registrarAuditoria({
    contexto,
    accion: "GUIA_CRITERIOS_CARGADA",
    entidad: "guias_criterios",
    entidad_id: nivel.id,
    valor_nuevo: { nivel: nivel.codigo, periodo_id: periodo.id, version, archivo: nombre, tamano_bytes: contenido.length, hash_sha256: hash },
  });
  return obtener(nivel.id, periodo.id, auth);
}

/** Una guía anterior pasa a ser la vigente (la que ven los estudiantes). */
export async function activarVersion({ nivelId, periodoId, guiaId }, auth, contexto) {
  const { nivel, periodo } = await cargarNivelYPeriodo(nivelId, periodoId);
  await exigirDocenteDelNivel(auth, nivel.id, periodo.id);
  exigirPeriodoAbierto(periodo);
  const version = await withTransaction(async (client) => {
    const bloqueo = await criteriaGuideRepository.bloquearDocenteNivel(nivel.id, periodo.id, client);
    if (!bloqueo || bloqueo.docente_id !== auth.usuario.id) throw ApiError.prohibido("Ya no eres el docente de este nivel.", "NOT_LEVEL_TEACHER");
    const objetivo = await criteriaGuideRepository.buscarVersion(guiaId, nivel.id, periodo.id, client);
    if (!objetivo) throw ApiError.noEncontrado("Esa versión de la guía no existe.", "GUIDE_VERSION_NOT_FOUND");
    if (!objetivo.vigente) {
      await criteriaGuideRepository.desmarcarVigente(nivel.id, periodo.id, client);
      await criteriaGuideRepository.marcarVigente(objetivo.id, client);
    }
    return objetivo;
  });
  await registrarAuditoria({
    contexto, accion: "GUIA_CRITERIOS_ACTIVADA", entidad: "guias_criterios", entidad_id: nivel.id,
    valor_nuevo: { nivel: nivel.codigo, periodo_id: periodo.id, version: version.version },
  });
  return obtener(nivel.id, periodo.id, auth);
}

/** Elimina una versión. La vigente solo se puede eliminar si es la única: antes hay que elegir otra como vigente. */
export async function eliminarVersion({ nivelId, periodoId, guiaId }, auth, contexto) {
  const { nivel, periodo } = await cargarNivelYPeriodo(nivelId, periodoId);
  await exigirDocenteDelNivel(auth, nivel.id, periodo.id);
  exigirPeriodoAbierto(periodo);
  const version = await withTransaction(async (client) => {
    const bloqueo = await criteriaGuideRepository.bloquearDocenteNivel(nivel.id, periodo.id, client);
    if (!bloqueo || bloqueo.docente_id !== auth.usuario.id) throw ApiError.prohibido("Ya no eres el docente de este nivel.", "NOT_LEVEL_TEACHER");
    const objetivo = await criteriaGuideRepository.buscarVersion(guiaId, nivel.id, periodo.id, client);
    if (!objetivo) throw ApiError.noEncontrado("Esa versión de la guía no existe.", "GUIDE_VERSION_NOT_FOUND");
    if (objetivo.vigente) {
      const total = (await criteriaGuideRepository.listarVersiones(nivel.id, periodo.id, client)).length;
      if (total > 1) {
        throw ApiError.reglaDeNegocio(
          "Esta es la versión vigente. Elige primero otra versión como vigente y luego elimina esta.", "GUIDE_VERSION_CURRENT"
        );
      }
    }
    await criteriaGuideRepository.eliminarVersion(objetivo.id, client);
    return objetivo;
  });
  await registrarAuditoria({
    contexto, accion: "GUIA_CRITERIOS_ELIMINADA", entidad: "guias_criterios", entidad_id: nivel.id,
    valor_anterior: { nivel: nivel.codigo, periodo_id: periodo.id, version: version.version },
  });
  return obtener(nivel.id, periodo.id, auth);
}

/**
 * Servicio de evidencias de la bitácora (fotos JPG/PNG o PDF).
 * Valida el archivo por su contenido real, lo guarda en el almacenamiento privado y registra sus metadatos en PostgreSQL.
 * Solo el estudiante dueño puede subir, editar o retirar evidencias, y solo mientras la bitácora sea editable.
 */
import { createHash, randomUUID } from "node:crypto";
import { crearUrlFirmada, eliminarArchivo, subirArchivo } from "../adapters/storageAdapter.js";
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { logger } from "../config/logger.js";
import { withTransaction } from "../database/transaction.js";
import * as documentRepository from "../repositories/documentRepository.js";
import * as logbookRepository from "../repositories/logbookRepository.js";
import { ApiError } from "../utils/apiError.js";
import { contenidoCoincideConTipo, sanitizarNombre } from "../utils/archivos.js";
import { BITACORA } from "../utils/constants.js";
import { cargarBitacoraAutorizada, exigirEditable, exigirEstudiante } from "./logbookService.js";

// Da forma a una evidencia para el frontend.
const armarEvidencia = (e) => ({
  id: e.id,
  nombre: e.nombre,
  tipo_mime: e.tipo_mime,
  tamano_bytes: e.tamano_bytes,
  descripcion: e.descripcion,
  orden: e.orden,
  es_imagen: e.tipo_mime.startsWith("image/"),
});

// Error estándar cuando se supera el máximo de evidencias por bitácora.
const limiteAlcanzado = () =>
  ApiError.reglaDeNegocio(`Cada bitácora admite máximo ${BITACORA.MAXIMO_EVIDENCIAS} evidencias.`, "EVIDENCE_LIMIT_REACHED");

/** Carga una evidencia (foto JPG/PNG o PDF, máx. 10 MB). El contenido se valida por su firma real, no por la cabecera. */
export async function subir({ bitacoraId, contenido, tipoMime, nombreArchivo, descripcion }, auth, contexto) {
  exigirEstudiante(auth);
  const { bitacora, asignacion } = await cargarBitacoraAutorizada(bitacoraId, auth);
  exigirEditable(bitacora, asignacion);

    // ── Validaciones del archivo: descripción, tamaño, tipo permitido, extensión y firma real del contenido ──
  if (descripcion && descripcion.length > 500) {
    throw ApiError.solicitudInvalida("La descripción admite máximo 500 caracteres.", [], "VALIDATION_ERROR");
  }
  if (!Buffer.isBuffer(contenido) || contenido.length === 0) {
    throw ApiError.solicitudInvalida("Adjunta el archivo en el cuerpo de la solicitud.", [], "FILE_REQUIRED");
  }
  if (contenido.length > BITACORA.MAXIMO_BYTES_EVIDENCIA) {
    throw ApiError.demasiadoGrande(
      `El archivo supera el máximo de ${Math.floor(BITACORA.MAXIMO_BYTES_EVIDENCIA / 1024 / 1024)} MB.`,
      "FILE_TOO_LARGE"
    );
  }
  const mime = String(tipoMime ?? "").split(";")[0].trim().toLowerCase();
  const tipo = BITACORA.TIPOS_EVIDENCIA[mime];
  if (!tipo) {
    throw ApiError.reglaDeNegocio("Formato no permitido. Sube una imagen JPG o PNG, o un PDF.", "FILE_TYPE_NOT_ALLOWED", [
      { permitidos: Object.keys(BITACORA.TIPOS_EVIDENCIA) },
    ]);
  }
  const nombre = sanitizarNombre(nombreArchivo, `evidencia.${tipo.ext}`);
  if (!tipo.extensiones.some((extension) => nombre.toLowerCase().endsWith(extension))) {
    throw ApiError.reglaDeNegocio(`La extensión del archivo no corresponde a ${mime}.`, "FILE_EXTENSION_NOT_ALLOWED");
  }
  if (!contenidoCoincideConTipo(contenido, mime)) {
    throw ApiError.reglaDeNegocio("El archivo está dañado o no corresponde a su formato.", "FILE_NOT_READABLE");
  }
    // Límite de evidencias por bitácora.
  if ((await logbookRepository.contarEvidencias(bitacora.id)).total >= BITACORA.MAXIMO_EVIDENCIAS) throw limiteAlcanzado();

  // 1) Archivo en el almacenamiento (fuera de la transacción)
  const archivoId = randomUUID();
  const ruta = `bitacoras/${asignacion.periodo_id}/${bitacora.id}/evidencias/${archivoId}.${tipo.ext}`;
  const hash = createHash("sha256").update(contenido).digest("hex");
  const { bucket } = await subirArchivo({ ruta, contenido, tipoMime: mime });

  // 2) Registro en PostgreSQL; si falla se retira el archivo huérfano
  let evidenciaId;
  try {
    evidenciaId = await withTransaction(async (client) => {
      const bloqueada = await documentRepository.bloquearAsignacion(asignacion.id, client);
      const actual = await logbookRepository.buscarPorId(bitacora.id, client, { bloquear: true });
      exigirEditable(actual, bloqueada);
      const { total, ultimo_orden } = await logbookRepository.contarEvidencias(bitacora.id, client);
      if (total >= BITACORA.MAXIMO_EVIDENCIAS) throw limiteAlcanzado();
      await documentRepository.crearArchivo(
        { id: archivoId, bucket, ruta, nombreOriginal: nombre, tipoMime: mime, tamanoBytes: contenido.length, hashSha256: hash, subidoPorId: auth.usuario.id },
        client
      );
      const creada = await logbookRepository.crearEvidencia(
        { bitacoraId: bitacora.id, archivoId, creadoPorId: auth.usuario.id, descripcion: descripcion || null, orden: ultimo_orden + 1 },
        client
      );
      return creada.id;
    });
  } catch (error) {
    try {
      await eliminarArchivo(ruta);
    } catch (errorLimpieza) {
      logger.error({ err: errorLimpieza, archivo_id: archivoId }, "No se pudo retirar una evidencia huérfana del almacenamiento");
    }
    throw error;
  }

  await registrarAuditoria({
    contexto,
    accion: "EVIDENCIA_CARGADA",
    entidad: "evidencias_bitacora",
    entidad_id: evidenciaId,
    valor_nuevo: { bitacora_id: bitacora.id, archivo: nombre, tipo_mime: mime, tamano_bytes: contenido.length, hash_sha256: hash },
  });
  return armarEvidencia(await logbookRepository.buscarEvidencia(evidenciaId, bitacora.id));
}

// Verifica permisos y que la bitácora sea editable; devuelve la evidencia a modificar.
async function cargarEvidenciaEditable(bitacoraId, evidenciaId, auth) {
  exigirEstudiante(auth);
  const { bitacora, asignacion } = await cargarBitacoraAutorizada(bitacoraId, auth);
  exigirEditable(bitacora, asignacion);
  const evidencia = await logbookRepository.buscarEvidencia(evidenciaId, bitacora.id);
  if (!evidencia) throw ApiError.noEncontrado("La evidencia no existe.", "EVIDENCE_NOT_FOUND");
  return { bitacora, asignacion, evidencia };
}

/** Ejecuta `cambio` con la asignación y la bitácora bloqueadas y el estado editable reconfirmado. */
async function cambiarEnTransaccion({ bitacora, asignacion }, cambio) {
  await withTransaction(async (client) => {
    const bloqueada = await documentRepository.bloquearAsignacion(asignacion.id, client);
    const actual = await logbookRepository.buscarPorId(bitacora.id, client, { bloquear: true });
    exigirEditable(actual, bloqueada);
    await cambio(client);
  });
}

/** Cambia la descripción de una evidencia. */
export async function actualizarDescripcion(bitacoraId, evidenciaId, { descripcion }, auth) {
  const contexto = await cargarEvidenciaEditable(bitacoraId, evidenciaId, auth);
  await cambiarEnTransaccion(contexto, (client) =>
    logbookRepository.actualizarDescripcionEvidencia(evidenciaId, descripcion || null, client)
  );
  return armarEvidencia(await logbookRepository.buscarEvidencia(evidenciaId, bitacoraId));
}

/** Retiro lógico: el registro y el archivo se conservan para trazabilidad (no se borra nada físicamente). */
export async function eliminar(bitacoraId, evidenciaId, auth, contexto) {
  const cargado = await cargarEvidenciaEditable(bitacoraId, evidenciaId, auth);
  await cambiarEnTransaccion(cargado, (client) => logbookRepository.retirarEvidencia(evidenciaId, client));
  await registrarAuditoria({
    contexto,
    accion: "EVIDENCIA_ELIMINADA",
    entidad: "evidencias_bitacora",
    entidad_id: evidenciaId,
    valor_anterior: { bitacora_id: bitacoraId, archivo: cargado.evidencia.nombre },
  });
}

/** URL firmada de corta duración para ver una evidencia (dueño, Dirección y evaluadores con acceso a la bitácora). */
export async function urlDeDescarga(bitacoraId, evidenciaId, auth) {
  const { bitacora } = await cargarBitacoraAutorizada(bitacoraId, auth);
  const evidencia = await logbookRepository.buscarEvidencia(evidenciaId, bitacora.id);
  if (!evidencia) throw ApiError.noEncontrado("La evidencia no existe.", "EVIDENCE_NOT_FOUND");
  const { url, expira_en_segundos } = await crearUrlFirmada(evidencia.ruta);
  return { evidencia_id: evidenciaId, nombre: evidencia.nombre, tipo_mime: evidencia.tipo_mime, url, expira_en_segundos };
}

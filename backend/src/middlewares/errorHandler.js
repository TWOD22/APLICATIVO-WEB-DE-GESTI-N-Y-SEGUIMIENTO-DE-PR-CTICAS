/**
 * Manejador central de errores.
 * Convierte cualquier error (ApiError, Zod, PostgreSQL, JSON inválido, CORS) en la respuesta
 * uniforme { error: { code, message, details, request_id } } sin filtrar detalles internos.
 */
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/apiError.js";

/** Traduce errores de PostgreSQL a errores de la API con mensajes seguros. */
function traducirErrorPg(error) {
  switch (error.code) {
    case "23505":
      return ApiError.conflicto("Ya existe un registro con esos datos.", "DUPLICATE_RECORD");
    case "23503":
      return ApiError.conflicto("La operación referencia o afecta registros relacionados.", "RELATED_RECORD_CONFLICT");
    case "23502":
      return ApiError.solicitudInvalida("Falta un dato obligatorio.", [], "MISSING_REQUIRED_FIELD");
    case "22P02":
    case "22007":
    case "22008":
      return ApiError.solicitudInvalida("Uno de los valores enviados tiene un formato inválido.", [], "INVALID_VALUE");
    case "23514":
      // Los RAISE de nuestras funciones de validación no traen constraint y su mensaje es seguro.
      return error.constraint
        ? ApiError.reglaDeNegocio("Los datos no cumplen una regla de integridad.", "INTEGRITY_RULE_VIOLATION")
        : ApiError.reglaDeNegocio(error.message, "INTEGRITY_RULE_VIOLATION");
    default:
      return null;
  }
}

/** Último middleware de Express: recibe todos los errores y responde con el formato normalizado. */
export function errorHandler(error, req, res, _next) {
    // `apiError` termina siendo el error ya traducido; si no se reconoce, se responde 500 genérico.
  let apiError = null;

  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = ApiError.solicitudInvalida(
      "Hay datos inválidos en la solicitud.",
      error.issues.map((i) => ({ campo: i.path.join("."), codigo: i.code, mensaje: i.message })),
      "VALIDATION_ERROR"
    );
  } else if (error?.type === "entity.too.large") {
    apiError = ApiError.demasiadoGrande("El cuerpo de la solicitud supera el tamaño permitido.");
  } else if (error?.type === "entity.parse.failed") {
    apiError = ApiError.solicitudInvalida("El cuerpo de la solicitud no es un JSON válido.", [], "INVALID_JSON");
  } else if (error?.code === "CORS_ORIGIN_DENIED") {
    apiError = ApiError.prohibido("Origen no permitido.", "CORS_ORIGIN_DENIED");
  } else if (typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) {
    apiError = traducirErrorPg(error);
  }

    // Error desconocido: se registra completo en el log técnico, pero al cliente solo se le da un mensaje genérico.
  if (!apiError) {
    logger.error({ err: error, request_id: req.id, ruta: req.originalUrl.split("?")[0], metodo: req.method }, "Error no controlado");
    apiError = new ApiError({
      codigo: "INTERNAL_ERROR",
      estado_http: 500,
      mensaje: "Ocurrió un error interno. Intenta de nuevo o contacta a soporte con el identificador de la solicitud.",
    });
  }

  if (res.headersSent) return;
  res.status(apiError.estado_http).json({
    error: {
      code: apiError.codigo,
      message: apiError.mensaje,
      details: apiError.detalles ?? [],
      request_id: req.id,
    },
  });
}

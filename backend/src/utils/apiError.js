/**
 * Error controlado de la API. El middleware final lo convierte en la respuesta
 * normalizada { error: { code, message, details, request_id } }.
 */
export class ApiError extends Error {
  constructor({ codigo, estado_http, mensaje, detalles = [] }) {
    super(mensaje);
    this.name = "ApiError";
    this.codigo = codigo;
    this.estado_http = estado_http;
    this.mensaje = mensaje;
    this.detalles = detalles;
  }

    // Fábricas estáticas: una por tipo de error HTTP (400, 401, 403, 404, 409, 413, 422, 429, 502).
  static solicitudInvalida(mensaje = "La solicitud no es válida.", detalles = [], codigo = "BAD_REQUEST") {
    return new ApiError({ codigo, estado_http: 400, mensaje, detalles });
  }

  static noAutenticado(mensaje = "Debes iniciar sesión para continuar.", codigo = "UNAUTHENTICATED") {
    return new ApiError({ codigo, estado_http: 401, mensaje });
  }

  static prohibido(mensaje = "No tienes permiso para realizar esta acción.", codigo = "FORBIDDEN", detalles = []) {
    return new ApiError({ codigo, estado_http: 403, mensaje, detalles });
  }

  static noEncontrado(mensaje = "El recurso solicitado no existe.", codigo = "NOT_FOUND") {
    return new ApiError({ codigo, estado_http: 404, mensaje });
  }

  static conflicto(mensaje, codigo = "CONFLICT", detalles = []) {
    return new ApiError({ codigo, estado_http: 409, mensaje, detalles });
  }

  static demasiadoGrande(mensaje = "El archivo supera el tamaño permitido.", codigo = "PAYLOAD_TOO_LARGE") {
    return new ApiError({ codigo, estado_http: 413, mensaje });
  }

  static reglaDeNegocio(mensaje, codigo = "BUSINESS_RULE_VIOLATION", detalles = []) {
    return new ApiError({ codigo, estado_http: 422, mensaje, detalles });
  }

  static limiteExcedido(mensaje = "Has superado el límite de solicitudes. Intenta de nuevo en unos minutos.") {
    return new ApiError({ codigo: "RATE_LIMITED", estado_http: 429, mensaje });
  }

  static servicioExterno(mensaje = "Un servicio externo no respondió correctamente.", codigo = "UPSTREAM_ERROR") {
    return new ApiError({ codigo, estado_http: 502, mensaje });
  }
}

/**
 * Middleware de validación de entrada con Zod.
 */
import { ApiError } from "../utils/apiError.js";

/**
 * Valida body, query y params con esquemas Zod y reemplaza los valores por los ya
 * normalizados (coerciones, defaults, trim). Uso: validar({ body, query, params }).
 */
export function validar(esquemas) {
  return (req, _res, next) => {
    const detalles = [];
    for (const origen of ["params", "query", "body"]) {
      const esquema = esquemas[origen];
      if (!esquema) continue;
      const resultado = esquema.safeParse(req[origen] ?? {});
      if (resultado.success) {
        req[origen] = resultado.data;
      } else {
        for (const problema of resultado.error.issues) {
          detalles.push({
            origen,
            campo: problema.path.join("."),
            codigo: problema.code,
            mensaje: problema.message,
          });
        }
      }
    }
    if (detalles.length) {
      return next(ApiError.solicitudInvalida("Hay datos inválidos en la solicitud.", detalles, "VALIDATION_ERROR"));
    }
    return next();
  };
}

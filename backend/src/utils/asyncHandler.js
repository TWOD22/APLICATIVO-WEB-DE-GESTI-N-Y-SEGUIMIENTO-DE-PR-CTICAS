/**
 * Envoltorio para controladores async: reenvía los errores a `next` para que los atienda el errorHandler.
 */
/** Envuelve un handler async para que sus errores lleguen al middleware de errores. */
export const asyncHandler = (funcion) => (req, res, next) =>
  Promise.resolve(funcion(req, res, next)).catch(next);

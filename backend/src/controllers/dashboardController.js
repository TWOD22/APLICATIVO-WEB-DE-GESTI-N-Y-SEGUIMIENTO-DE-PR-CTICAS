/**
 * Controlador del dashboard.
 */
import * as dashboardService from "../services/dashboardService.js";
import { armarMetaPaginacion, calcularPaginacion } from "../utils/pagination.js";
import { responderListado, responderOk } from "../utils/respuesta.js";

/** Indicadores de resumen. */
export const resumen = async (req, res) => responderOk(res, await dashboardService.resumen(req.query, req.auth));

/** Tabla de seguimiento de prácticas. */
export const listarPracticas = async (req, res) => {
  const paginacion = calcularPaginacion(req.query);
  const { filas, total, periodo } = await dashboardService.listarPracticas(
    { ...req.query, limit: paginacion.limit, offset: paginacion.offset },
    req.auth
  );
  responderListado(res, filas, { ...armarMetaPaginacion(paginacion, total), periodo });
};

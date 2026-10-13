/**
 * Controlador de notificaciones.
 */
import * as notificationService from "../services/notificationService.js";
import { armarMetaPaginacion, calcularPaginacion } from "../utils/pagination.js";
import { responderListado, responderOk } from "../utils/respuesta.js";

/** Lista las notificaciones del usuario. */
export const listar = async (req, res) => {
  const paginacion = calcularPaginacion(req.query);
  const { filas, total, no_leidas } = await notificationService.listar(
    { page: paginacion.page, page_size: paginacion.page_size, solo_no_leidas: req.query.solo_no_leidas },
    req.auth
  );
  responderListado(res, filas, { ...armarMetaPaginacion(paginacion, total), no_leidas });
};

/** Marca una como leída. */
export const marcarLeida = async (req, res) => responderOk(res, await notificationService.marcarLeida(req.params.id, req.auth));

/** Marca todas como leídas. */
export const marcarTodasLeidas = async (req, res) => responderOk(res, await notificationService.marcarTodasComoLeidas(req.auth));

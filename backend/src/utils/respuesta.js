/**
 * Funciones para responder con el contrato { data, meta }: 200 (responderOk), 201 (responderCreado),
 * listados paginados (responderListado) y 204 sin contenido (responderSinContenido).
 */
/** Helpers del contrato de respuestas: { data, meta: { request_id, ... } }. */
const meta = (res, extra = {}) => ({ ...extra, request_id: res.req?.id });

export const responderOk = (res, data, extra) => res.status(200).json({ data, meta: meta(res, extra) });

export const responderCreado = (res, data, extra) => res.status(201).json({ data, meta: meta(res, extra) });

export const responderListado = (res, filas, paginacion) =>
  res.status(200).json({ data: filas, meta: meta(res, paginacion) });

export const responderSinContenido = (res) => res.status(204).send();

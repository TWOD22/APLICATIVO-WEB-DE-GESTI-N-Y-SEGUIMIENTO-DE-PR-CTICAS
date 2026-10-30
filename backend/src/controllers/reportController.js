/** Controlador de reportes del Director (resumen en JSON, detalle en CSV, informe en PDF). */
import * as reportService from "../services/reportService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderOk } from "../utils/respuesta.js";

const enviarArchivo = (res, { contenido, nombre_archivo: nombre }, tipo) =>
  res.status(200).set({
    "Content-Type": tipo,
    "Content-Disposition": `attachment; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    "Content-Length": contenido.length,
    "Cache-Control": "private, no-store",
  }).send(contenido);

export const resumen = async (req, res) => responderOk(res, await reportService.resumen(req.query));
export const detalleCsv = async (req, res) => enviarArchivo(res, await reportService.detalleCsv(req.query, construirContexto(req)), "text/csv; charset=utf-8");
export const resumenPdf = async (req, res) => enviarArchivo(res, await reportService.resumenPdf(req.query, construirContexto(req)), "application/pdf");

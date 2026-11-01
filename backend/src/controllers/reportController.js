/** Controlador de reportes del Director (resumen en JSON, detalle en CSV, informe en PDF). */
import * as reportService from "../services/reportService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderOk } from "../utils/respuesta.js";

/** Responde con un archivo descargable: fija el tipo, el nombre (codificado en UTF-8) y evita que se guarde en caché. */
const enviarArchivo = (res, { contenido, nombre_archivo: nombre }, tipo) =>
  res.status(200).set({
    "Content-Type": tipo,
    "Content-Disposition": `attachment; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    "Content-Length": contenido.length,
    "Cache-Control": "private, no-store",
  }).send(contenido);

/** GET: indicadores del periodo (por defecto el activo) en JSON. */
export const resumen = async (req, res) => responderOk(res, await reportService.resumen(req.query));
/** GET: detalle por práctica en CSV (UTF-8 con BOM, separador «;», para abrir en Excel en español). */
export const detalleCsv = async (req, res) => enviarArchivo(res, await reportService.detalleCsv(req.query, construirContexto(req)), "text/csv; charset=utf-8");
/** GET: resumen del periodo en PDF, para anexar a informes de autoevaluación. */
export const resumenPdf = async (req, res) => enviarArchivo(res, await reportService.resumenPdf(req.query, construirContexto(req)), "application/pdf");

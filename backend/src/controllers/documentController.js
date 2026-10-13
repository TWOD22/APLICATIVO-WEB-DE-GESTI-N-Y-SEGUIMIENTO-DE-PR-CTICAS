/**
 * Controlador de documentos legales.
 */
import * as documentService from "../services/documentService.js";
import { construirContexto } from "../utils/contexto.js";
import { armarMetaPaginacion, calcularPaginacion } from "../utils/pagination.js";
import { responderCreado, responderListado, responderOk } from "../utils/respuesta.js";

// Decodifica el nombre del archivo enviado en la cabecera X-File-Name (viene codificado en URL).
const decodificar = (valor) => {
  try {
    return valor ? decodeURIComponent(valor) : undefined;
  } catch {
    return valor;
  }
};

/** Documentos de una asignación. */
export const listarDeAsignacion = async (req, res) =>
  responderOk(res, await documentService.listarDeAsignacion(req.params.id, req.auth));

/** Sube el PDF de un documento legal. */
export const subir = async (req, res) =>
  responderCreado(
    res,
    await documentService.subir(
      {
        asignacionId: req.params.id,
        tipoId: req.params.tipoId,
        contenido: req.body, // Buffer (express.raw) cuando el Content-Type es application/pdf
        tipoMime: req.get("content-type"),
        nombreArchivo: decodificar(req.get("x-file-name")),
      },
      req.auth,
      construirContexto(req)
    )
  );

/** Aprueba o devuelve un documento. */
export const revisar = async (req, res) =>
  responderOk(res, await documentService.revisar(req.params.id, req.body, construirContexto(req)));

/** Aprueba todo el expediente. */
export const aprobarExpediente = async (req, res) =>
  responderOk(res, await documentService.aprobarExpediente(req.params.id, construirContexto(req)));

/** URL temporal de descarga. */
export const urlDeDescarga = async (req, res) =>
  responderOk(res, await documentService.urlDeDescarga(req.params.id, req.auth, construirContexto(req)));

/** Expedientes para la auditoría documental del Director. */
export const listarExpedientes = async (req, res) => {
  const paginacion = calcularPaginacion(req.query);
  const { filas, total, resumen } = await documentService.listarExpedientes({
    ...req.query, limit: paginacion.limit, offset: paginacion.offset,
  });
  responderListado(res, filas, { ...armarMetaPaginacion(paginacion, total), resumen });
};

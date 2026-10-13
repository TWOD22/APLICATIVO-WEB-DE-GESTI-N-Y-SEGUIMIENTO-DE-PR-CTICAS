/**
 * Controlador de bitácoras y evidencias.
 */
import * as evidenceService from "../services/evidenceService.js";
import * as exportService from "../services/exportService.js";
import * as logbookService from "../services/logbookService.js";
import { ApiError } from "../utils/apiError.js";
import { construirContexto } from "../utils/contexto.js";
import { responderCreado, responderOk, responderSinContenido } from "../utils/respuesta.js";
import { llaveIdempotencia } from "../validators/logbookSchemas.js";

// Decodifica el nombre de archivo de la cabecera X-File-Name.
const decodificar = (valor) => {
  try {
    return valor ? decodeURIComponent(valor) : undefined;
  } catch {
    return valor;
  }
};

/** Bitácora de una asignación. */
export const obtenerDeAsignacion = async (req, res) =>
  responderOk(res, await logbookService.obtenerDeAsignacion(req.params.id, req.auth));

/** POST = obtener o crear: 201 la primera vez, 200 si ya existía. */
export const crearDeAsignacion = async (req, res) => {
  const vista = await logbookService.obtenerDeAsignacion(req.params.id, req.auth);
  return vista.creada ? responderCreado(res, vista) : responderOk(res, vista);
};

/** Detalle de la bitácora. */
export const obtener = async (req, res) => responderOk(res, await logbookService.obtener(req.params.id, req.auth));

/** Autoguarda el borrador. */
export const guardarBorrador = async (req, res) =>
  responderOk(res, await logbookService.guardarBorrador(req.params.id, req.body, req.auth));

/** Envío definitivo. */
export const enviar = async (req, res) => {
  const llave = llaveIdempotencia.safeParse(req.get("idempotency-key") ?? "");
  if (!llave.success) {
    throw ApiError.solicitudInvalida(
      "Falta la cabecera Idempotency-Key (entre 8 y 63 caracteres: letras, números, . _ : -).",
      llave.error.issues.map((i) => ({ origen: "headers", campo: "Idempotency-Key", mensaje: i.message })),
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  responderOk(res, await logbookService.enviar(req.params.id, req.body, llave.data, req.auth, construirContexto(req)));
};

/** Devolución por el Director. */
export const devolver = async (req, res) =>
  responderOk(res, await logbookService.devolver(req.params.id, req.body, construirContexto(req)));

/** Sube una evidencia. */
export const subirEvidencia = async (req, res) =>
  responderCreado(
    res,
    await evidenceService.subir(
      {
        bitacoraId: req.params.id,
        contenido: req.body, // Buffer (express.raw) cuando el Content-Type es imagen o PDF
        tipoMime: req.get("content-type"),
        nombreArchivo: decodificar(req.get("x-file-name")),
        descripcion: decodificar(req.get("x-evidence-description"))?.trim(),
      },
      req.auth,
      construirContexto(req)
    )
  );

/** Edita la descripción de una evidencia. */
export const actualizarEvidencia = async (req, res) =>
  responderOk(res, await evidenceService.actualizarDescripcion(req.params.id, req.params.evidenciaId, req.body, req.auth));

/** Elimina una evidencia. */
export const eliminarEvidencia = async (req, res) => {
  await evidenceService.eliminar(req.params.id, req.params.evidenciaId, req.auth, construirContexto(req));
  responderSinContenido(res);
};

/** URL temporal de la evidencia. */
export const urlDeEvidencia = async (req, res) =>
  responderOk(res, await evidenceService.urlDeDescarga(req.params.id, req.params.evidenciaId, req.auth));

/** Descarga la bitácora en PDF (no usa el contrato JSON: responde el archivo). */
export const exportar = async (req, res) => {
  const { contenido, nombre_archivo: nombre } = await exportService.exportarBitacora(req.params.id, req.auth, construirContexto(req));
  res
    .status(200)
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      "Content-Length": contenido.length,
      "Cache-Control": "private, no-store",
    })
    .send(contenido);
};

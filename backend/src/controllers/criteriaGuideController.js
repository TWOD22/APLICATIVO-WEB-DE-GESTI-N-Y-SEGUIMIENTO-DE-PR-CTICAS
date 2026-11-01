/**
 * Controlador de la guía de criterios por nivel y periodo.
 */
import * as criteriaGuideService from "../services/criteriaGuideService.js";
import { construirContexto } from "../utils/contexto.js";
import { responderCreado, responderOk } from "../utils/respuesta.js";

// El nombre del archivo viaja en X-File-Name codificado en URL.
const decodificar = (valor) => {
  try {
    return valor ? decodeURIComponent(valor) : undefined;
  } catch {
    return valor;
  }
};

/** GET: guía vigente (con URL firmada) y, para Dirección y el docente, el historial de versiones. */
export const obtener = async (req, res) =>
  responderOk(res, await criteriaGuideService.obtener(req.params.nivelId, req.params.periodoId, req.auth));

/** POST: el docente del nivel sube el PDF como versión nueva. El archivo va en el cuerpo y su nombre en X-File-Name. */
export const subir = async (req, res) =>
  responderCreado(
    res,
    await criteriaGuideService.subir(
      {
        nivelId: req.params.nivelId,
        periodoId: req.params.periodoId,
        contenido: req.body,
        tipoMime: req.get("content-type"),
        nombreArchivo: decodificar(req.get("x-file-name")),
      },
      req.auth,
      construirContexto(req)
    )
  );

/** POST: marca una versión anterior como la vigente. */
export const activarVersion = async (req, res) =>
  responderOk(res, await criteriaGuideService.activarVersion(req.params, req.auth, construirContexto(req)));

/** DELETE: elimina una versión; la vigente solo se puede eliminar si es la única. */
export const eliminarVersion = async (req, res) =>
  responderOk(res, await criteriaGuideService.eliminarVersion(req.params, req.auth, construirContexto(req)));

/**
 * Utilidades para archivos subidos: limpieza de nombres y verificación del contenido real (firma binaria).
 */
import path from "node:path";

/** Deja solo el nombre del archivo (sin rutas ni caracteres de control) y lo acota a 255 caracteres. */
export function sanitizarNombre(nombre, respaldo) {
  const limpio = path
    .basename(String(nombre ?? "").replace(/\\/g, "/"))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  return limpio || respaldo;
}

/** %PDF- en los primeros 1024 bytes y %%EOF en el final: descarta archivos truncados o disfrazados. */
export function esPdfLegible(contenido) {
  const inicio = contenido.subarray(0, 1024).toString("latin1");
  const final = contenido.subarray(Math.max(0, contenido.length - 4096)).toString("latin1");
  return inicio.includes("%PDF-") && final.includes("%%EOF");
}

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** ¿El contenido real coincide con el tipo declarado? (no basta con confiar en la cabecera del cliente) */
export function contenidoCoincideConTipo(contenido, tipoMime) {
  switch (tipoMime) {
    case "application/pdf":
      return esPdfLegible(contenido);
    case "image/png":
      return contenido.length > FIRMA_PNG.length && contenido.subarray(0, FIRMA_PNG.length).equals(FIRMA_PNG);
    case "image/jpeg":
      // Inicio FF D8 FF y marcador de fin FF D9 (se tolera relleno de ceros al final).
      return (
        contenido.length > 4 &&
        contenido[0] === 0xff && contenido[1] === 0xd8 && contenido[2] === 0xff &&
        contenido.subarray(Math.max(0, contenido.length - 64)).includes(Buffer.from([0xff, 0xd9]))
      );
    default:
      return false;
  }
}

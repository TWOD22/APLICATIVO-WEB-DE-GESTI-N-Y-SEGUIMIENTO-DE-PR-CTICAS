/**
 * Ayuda para leer el texto de un PDF generado por el sistema y poder verificarlo en las pruebas.
 */
/** Texto mostrado por cada Tj de un PDF generado por src/utils/pdf.js (las cadenas van en hexadecimal WinAnsi/Latin-1). */
export const textoDelPdf = (buffer) =>
  [...buffer.toString("latin1").matchAll(/<([0-9a-f]+)> Tj/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("\n");

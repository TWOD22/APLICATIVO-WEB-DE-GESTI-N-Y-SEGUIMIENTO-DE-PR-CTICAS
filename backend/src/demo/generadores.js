/** Archivos de ejemplo para la demostración: PDF con texto (documentos y guías) e imágenes PNG (evidencias). */
import { deflateSync } from "node:zlib";
import { DocumentoPdf } from "../utils/pdf.js";

/** PDF de un documento legal de ejemplo. Lleva claramente la leyenda de que es un documento de demostración. */
export function pdfDocumentoLegal({ tipo, estudiante, documento, institucion }) {
  const doc = new DocumentoPdf({ titulo: `${tipo} (demostración)`, autor: "Sistema de Prácticas UDI", pie: "Documento de ejemplo generado para la demostración del sistema" });
  doc.titulo(tipo);
  doc.parrafo("DOCUMENTO DE EJEMPLO · DATOS FICTICIOS PARA LA DEMOSTRACIÓN DEL SISTEMA", { negrita: true, tamano: 9 });
  doc.separador();
  doc.campo("Estudiante", estudiante);
  doc.campo("Documento de identidad", documento);
  if (institucion) doc.campo("Institución", institucion);
  doc.espacio(10);
  doc.parrafo("Este archivo no corresponde a un documento real. Se generó automáticamente para mostrar cómo el Director revisa, aprueba o devuelve los documentos legales que cada estudiante debe presentar antes de iniciar su práctica pedagógica.");
  return doc.generar();
}

/** PDF de la guía de criterios de evaluación de un nivel (borrador de ejemplo, no son los criterios reales). */
export function pdfGuiaCriterios({ nivel, docente }) {
  const doc = new DocumentoPdf({ titulo: `Guía de criterios · ${nivel}`, autor: docente, pie: "Guía de ejemplo para la demostración del sistema" });
  doc.titulo(`Guía de criterios de evaluación`);
  doc.parrafo(nivel, { negrita: true, tamano: 13 });
  doc.parrafo("BORRADOR DE EJEMPLO · Los criterios y porcentajes se reemplazarán por los oficiales del programa.", { tamano: 9, negrita: true });
  doc.separador();
  doc.seccion("1. Qué se evalúa");
  doc.parrafo("La bitácora semanal: reflexión pedagógica, respuestas al cuestionario del nivel y evidencias de las actividades desarrolladas con los niños.");
  doc.seccion("2. Criterios");
  for (const c of [
    "Claridad y profundidad de la reflexión (descripción, análisis y aprendizajes).",
    "Pertinencia de las actividades frente a la edad y las necesidades del grupo.",
    "Uso de referentes pedagógicos para justificar lo que se hace.",
    "Calidad y coherencia de las evidencias aportadas.",
    "Compromiso, puntualidad y relación con la comunidad educativa.",
  ]) doc.parrafo(`• ${c}`, { sangria: 8 });
  doc.seccion("3. Escala");
  doc.parrafo("Las notas van de 0.00 a 5.00. El docente supervisor y el asesor de sitio califican de forma independiente y no se promedian.");
  return doc.generar();
}

// ── PNG sin dependencias (para las evidencias) ──
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
/** Suma de verificación CRC-32 que exige el formato PNG. */
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** Bloque de un archivo PNG: tipo, datos y suma de verificación. */
const bloque = (tipo, datos) => {
  const cuerpo = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
};

/** Imagen PNG de colores suaves (un "afiche" con formas simples) para usar como evidencia de ejemplo. */
export function pngEvidencia({ variante = 0, ancho = 640, alto = 420 } = {}) {
  const paletas = [[[255, 214, 102], [255, 140, 105]], [[129, 212, 250], [186, 104, 200]], [[165, 214, 167], [255, 241, 118]], [[244, 143, 177], [144, 202, 249]]];
  const [a, b] = paletas[variante % paletas.length];
  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y++) {
    const fila = y * (ancho * 3 + 1);
    filas[fila] = 0;
    for (let x = 0; x < ancho; x++) {
      const t = (x / ancho + y / alto) / 2;
      let r = a[0] + (b[0] - a[0]) * t, g = a[1] + (b[1] - a[1]) * t, bl = a[2] + (b[2] - a[2]) * t;
      const dx = x - ancho * 0.3, dy = y - alto * 0.55; // un sol/círculo
      if (dx * dx + dy * dy < 80 * 80) { r = 255; g = 255; bl = 255; }
      const rx = x - ancho * 0.62, ry = y - alto * 0.42; // un rectángulo (una mesa/cartel)
      if (Math.abs(rx) < 110 && Math.abs(ry) < 70) { r *= 0.55; g *= 0.55; bl *= 0.7; }
      const o = fila + 1 + x * 3;
      filas[o] = r; filas[o + 1] = g; filas[o + 2] = bl;
    }
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0); cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = 8; cabecera[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque("IHDR", cabecera), bloque("IDAT", deflateSync(filas)), bloque("IEND", Buffer.alloc(0)),
  ]);
}

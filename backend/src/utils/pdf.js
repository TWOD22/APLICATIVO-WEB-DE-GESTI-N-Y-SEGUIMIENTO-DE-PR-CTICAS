/**
 * Generador de PDF mínimo y sin dependencias (texto con Helvetica estándar, varias páginas, A4).
 * Alcanza para constancias y exportaciones de texto: títulos, párrafos con ajuste de línea, pares etiqueta/valor,
 * líneas separadoras y pie con "Página n de N". Acentos y eñes se codifican en WinAnsi (cp1252).
 * Los anchos (milésimas de em) son las métricas oficiales de Helvetica y Helvetica-Bold para los códigos 32..255.
 */

import { deflateSync, inflateSync } from "node:zlib";

// Anchos de cada carácter de Helvetica (normal y negrita), necesarios para calcular dónde cortar las líneas.
const ANCHOS = {
  normal: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761,
    556, 556, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 556, 611, 556,
    556, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 556, 500, 667,
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
  ],
  negrita: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761,
    556, 611, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 611, 611, 611,
    611, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 611, 500, 667,
    278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
    611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
  ],
};


// ───────────────────────── Imágenes (JPEG y PNG) ─────────────────────────

// Imágenes: se aceptan JPEG y PNG (sin entrelazado) y se limita el tamaño para evitar archivos maliciosos.
const LIMITE_PIXELES = 50_000_000;
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Lee dimensiones y componentes de un JPEG (marcadores SOFn). Devuelve null si no es un JPEG de 8 bits válido. */
function leerJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marca = b[i + 1];
    if (marca === 0xff) { i += 1; continue; }
    if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { i += 2; continue; }
    if (i + 4 > b.length) return null;
    const longitud = b.readUInt16BE(i + 2);
    if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
      if (i + 10 > b.length || b[i + 4] !== 8) return null;
      const alto = b.readUInt16BE(i + 5);
      const ancho = b.readUInt16BE(i + 7);
      const componentes = b[i + 9];
      return ancho && alto ? { ancho, alto, componentes } : null;
    }
    i += 2 + longitud;
  }
  return null;
}

/** Separa los fragmentos de un PNG. Devuelve null si está dañado, es entrelazado o excede el límite de tamaño. */
function leerPng(b) {
  if (b.length < 33 || !b.subarray(0, 8).equals(FIRMA_PNG)) return null;
  let pos = 8;
  let cabecera = null;
  let paleta = null;
  const idat = [];
  while (pos + 8 <= b.length) {
    const longitud = b.readUInt32BE(pos);
    const tipo = b.toString("latin1", pos + 4, pos + 8);
    const inicio = pos + 8;
    if (inicio + longitud > b.length) return null;
    const datos = b.subarray(inicio, inicio + longitud);
    if (tipo === "IHDR" && longitud >= 13) {
      cabecera = { ancho: datos.readUInt32BE(0), alto: datos.readUInt32BE(4), profundidad: datos[8], tipoColor: datos[9], entrelazado: datos[12] };
    } else if (tipo === "PLTE") paleta = datos;
    else if (tipo === "IDAT") idat.push(datos);
    else if (tipo === "IEND") break;
    pos = inicio + longitud + 4;
  }
  if (!cabecera || !idat.length || cabecera.entrelazado !== 0) return null;
  if (!cabecera.ancho || !cabecera.alto || cabecera.ancho * cabecera.alto > LIMITE_PIXELES) return null;
  return { ...cabecera, paleta, datos: Buffer.concat(idat) };
}

const CANALES_PNG = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Revierte los filtros de línea de un PNG de 8 bits. */
function desfiltrar(crudo, ancho, alto, bpp) {
  const fila = ancho * bpp;
  const salida = Buffer.alloc(alto * fila);
  for (let y = 0; y < alto; y += 1) {
    const filtro = crudo[y * (fila + 1)];
    const origen = y * (fila + 1) + 1;
    const destino = y * fila;
    for (let x = 0; x < fila; x += 1) {
      const a = x >= bpp ? salida[destino + x - bpp] : 0;
      const arriba = y > 0 ? salida[destino - fila + x] : 0;
      const c = y > 0 && x >= bpp ? salida[destino - fila + x - bpp] : 0;
      let predicho = 0;
      if (filtro === 1) predicho = a;
      else if (filtro === 2) predicho = arriba;
      else if (filtro === 3) predicho = (a + arriba) >> 1;
      else if (filtro === 4) {
        const p = a + arriba - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - arriba);
        const pc = Math.abs(p - c);
        predicho = pa <= pb && pa <= pc ? a : pb <= pc ? arriba : c;
      } else if (filtro !== 0) throw new Error("Filtro PNG desconocido");
      salida[destino + x] = (crudo[origen + x] + predicho) & 0xff;
    }
  }
  return salida;
}

/**
 * Convierte un JPEG o PNG en la descripción de un objeto imagen PDF.
 * Soporta JPEG en gris/RGB, y PNG no entrelazado (gris, RGB, paleta, y gris/RGB con transparencia de 8 bits).
 * Devuelve null si el formato no se puede incrustar (el llamador debe tener un plan alternativo).
 */
export function prepararImagen(buffer) {
  try {
    const jpeg = leerJpeg(buffer);
    if (jpeg) {
      if (jpeg.componentes !== 1 && jpeg.componentes !== 3) return null;
      return {
        ancho: jpeg.ancho, alto: jpeg.alto, bpc: 8, filtro: "DCTDecode", datos: buffer,
        espacio: jpeg.componentes === 1 ? "/DeviceGray" : "/DeviceRGB",
      };
    }
    const png = leerPng(buffer);
    if (!png) return null;
    const { ancho, alto, profundidad, tipoColor } = png;
    const canales = CANALES_PNG[tipoColor];
    if (!canales) return null;
    const crudo = inflateSync(png.datos);

    if (tipoColor === 4 || tipoColor === 6) {
      if (profundidad !== 8 || crudo.length < alto * (1 + ancho * canales)) return null;
      const plano = desfiltrar(crudo, ancho, alto, canales);
      const colores = canales - 1;
      const color = Buffer.alloc(ancho * alto * colores);
      const alfa = Buffer.alloc(ancho * alto);
      let opaco = true;
      for (let p = 0; p < ancho * alto; p += 1) {
        plano.copy(color, p * colores, p * canales, p * canales + colores);
        alfa[p] = plano[p * canales + colores];
        if (alfa[p] !== 255) opaco = false;
      }
      return {
        ancho, alto, bpc: 8, filtro: "FlateDecode", datos: deflateSync(color),
        espacio: colores === 1 ? "/DeviceGray" : "/DeviceRGB",
        mascara: opaco ? null : deflateSync(alfa),
      };
    }

    const bitsPorFila = ancho * canales * profundidad;
    if (crudo.length < alto * (1 + Math.ceil(bitsPorFila / 8))) return null;
    let espacio = tipoColor === 0 ? "/DeviceGray" : "/DeviceRGB";
    if (tipoColor === 3) {
      if (!png.paleta || png.paleta.length < 3 || ![1, 2, 4, 8].includes(profundidad)) return null;
      const entradas = Math.floor(png.paleta.length / 3);
      espacio = `[/Indexed /DeviceRGB ${entradas - 1} <${png.paleta.subarray(0, entradas * 3).toString("hex")}>]`;
    } else if (![1, 2, 4, 8, 16].includes(profundidad) || (tipoColor === 2 && profundidad < 8)) return null;
    return {
      ancho, alto, bpc: profundidad, filtro: "FlateDecode", espacio, datos: png.datos,
      parametros: `/Predictor 15 /Colors ${canales} /BitsPerComponent ${profundidad} /Columns ${ancho}`,
    };
  } catch {
    return null;
  }
}

// Tamaño de página A4 y márgenes, en puntos PDF (1 punto = 1/72 de pulgada).
const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = { izquierdo: 56, derecho: 56, superior: 60, inferior: 64 };

// Caracteres de cp1252 fuera de Latin-1 (los demás códigos 160..255 coinciden con Unicode).
// Tabla de caracteres especiales de Windows-1252 (comillas tipográficas, guiones largos, €, etc.).
const CP1252 = new Map([
  [0x20ac, 128], [0x201a, 130], [0x0192, 131], [0x201e, 132], [0x2026, 133], [0x2020, 134], [0x2021, 135], [0x02c6, 136],
  [0x2030, 137], [0x0160, 138], [0x2039, 139], [0x0152, 140], [0x017d, 142], [0x2018, 145], [0x2019, 146], [0x201c, 147],
  [0x201d, 148], [0x2022, 149], [0x2013, 150], [0x2014, 151], [0x02dc, 152], [0x2122, 153], [0x0161, 154], [0x203a, 155],
  [0x0153, 156], [0x017e, 158], [0x0178, 159],
]);

/** Código WinAnsi de un carácter; lo que no existe en la fuente se muestra como "?". */
function codigoDe(caracter) {
  const punto = caracter.codePointAt(0);
  if (punto === 9) return 32;
  if (punto >= 32 && punto <= 126) return punto;
  if (punto >= 160 && punto <= 255) return punto;
  return CP1252.get(punto) ?? 63;
}

const anchoDe = (codigo, negrita) => (ANCHOS[negrita ? "negrita" : "normal"][codigo - 32] ?? 556) / 1000;

/** Quita caracteres de control (salvo salto de línea) y normaliza saltos de línea. */
const limpiar = (texto) =>
  String(texto ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

function medir(texto, tamano, negrita) {
  let suma = 0;
  for (const caracter of texto) suma += anchoDe(codigoDe(caracter), negrita);
  return suma * tamano;
}

/** Parte un texto en líneas que caben en `anchoMaximo` puntos. Respeta saltos de línea y parte palabras demasiado largas. */
export function ajustarTexto(texto, { tamano = 10.5, negrita = false, anchoMaximo }) {
  const lineas = [];
  for (const parrafo of limpiar(texto).split("\n")) {
    if (parrafo.trim() === "") {
      lineas.push("");
      continue;
    }
    let actual = "";
    const poner = (palabra) => {
      const candidata = actual ? `${actual} ${palabra}` : palabra;
      if (medir(candidata, tamano, negrita) <= anchoMaximo) {
        actual = candidata;
        return;
      }
      if (actual) lineas.push(actual);
      actual = "";
      if (medir(palabra, tamano, negrita) <= anchoMaximo) {
        actual = palabra;
        return;
      }
      for (const caracter of palabra) {
        if (medir(actual + caracter, tamano, negrita) > anchoMaximo && actual) {
          lineas.push(actual);
          actual = "";
        }
        actual += caracter;
      }
    };
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) poner(palabra);
    if (actual) lineas.push(actual);
  }
  return lineas;
}

// Formateo de números y texto para los comandos de dibujo del PDF.
const num = (n) => (Math.round(n * 100) / 100).toString();
const hex = (texto) => `<${[...texto].map((c) => codigoDe(c).toString(16).padStart(2, "0")).join("")}>`;

/** Cadena Unicode para el diccionario Info (UTF-16BE en hexadecimal con BOM). */
function hexUtf16(texto) {
  const unidades = Buffer.from(`﻿${String(texto ?? "")}`, "utf16le").swap16();
  return `<${unidades.toString("hex")}>`;
}

/**
 * Construye un documento. Uso: const doc = new DocumentoPdf({ titulo, autor, pie }); doc.titulo("..."); doc.parrafo("...");
 * const buffer = doc.generar();
 */
export class DocumentoPdf {
  constructor({ titulo = "Documento", autor = "", pie = "" } = {}) {
    this.meta = { titulo, autor, pie };
    this.paginas = [[]]; // cada página es una lista de comandos de dibujo ya en coordenadas PDF
    this.recursos = [new Set()]; // nombres de imágenes usadas por cada página
    this.imagenes = [];
    this.y = A4.alto - MARGEN.superior;
    this.anchoUtil = A4.ancho - MARGEN.izquierdo - MARGEN.derecho;
  }

    // Métodos privados (#): control de salto de página y escritura de una línea de texto.
  #espacio(alto) {
    if (this.y - alto < MARGEN.inferior) {
      this.paginas.push([]);
      this.recursos.push(new Set());
      this.y = A4.alto - MARGEN.superior;
    }
  }

  #linea(texto, { tamano, negrita, sangria = 0, color = "0 0 0" }) {
    const interlineado = tamano * 1.35;
    this.#espacio(interlineado);
    this.y -= interlineado;
    if (texto !== "") {
      this.paginas.at(-1).push(
        `BT /${negrita ? "F2" : "F1"} ${num(tamano)} Tf ${color} rg ${num(MARGEN.izquierdo + sangria)} ${num(this.y + tamano * 0.25)} Td ${hex(texto)} Tj ET`
      );
    }
  }

    // Métodos públicos para construir el documento: espacio, título, sección, párrafo, campo, imagen, separador y generar().
  espacio(puntos = 8) {
    this.y -= puntos;
    return this;
  }

  titulo(texto, { tamano = 18 } = {}) {
    for (const linea of ajustarTexto(texto, { tamano, negrita: true, anchoMaximo: this.anchoUtil })) this.#linea(linea, { tamano, negrita: true });
    return this.espacio(4);
  }

  seccion(texto) {
    this.espacio(8);
    this.#espacio(48); // evita un encabezado huérfano al final de la página
    for (const linea of ajustarTexto(texto, { tamano: 12.5, negrita: true, anchoMaximo: this.anchoUtil })) {
      this.#linea(linea, { tamano: 12.5, negrita: true, color: "0.1 0.2 0.45" });
    }
    return this.separador();
  }

  parrafo(texto, { tamano = 10.5, negrita = false, sangria = 0, color } = {}) {
    for (const linea of ajustarTexto(texto, { tamano, negrita, anchoMaximo: this.anchoUtil - sangria })) this.#linea(linea, { tamano, negrita, sangria, color });
    return this.espacio(3);
  }

  /** "Etiqueta: valor" con la etiqueta en negrita. */
  campo(etiqueta, valor) {
    const rotulo = `${etiqueta}: `;
    const ancho = medir(rotulo, 10.5, true);
    const vacio = valor === null || valor === undefined || valor === "";
    const lineas = ajustarTexto(vacio ? "—" : String(valor), { anchoMaximo: this.anchoUtil - ancho });
    lineas.forEach((linea, i) => {
      const interlineado = 10.5 * 1.35;
      this.#espacio(interlineado);
      this.y -= interlineado;
      const y = num(this.y + 10.5 * 0.25);
      if (i === 0) this.paginas.at(-1).push(`BT /F2 10.5 Tf 0 0 0 rg ${num(MARGEN.izquierdo)} ${y} Td ${hex(rotulo)} Tj ET`);
      if (linea !== "") this.paginas.at(-1).push(`BT /F1 10.5 Tf 0 0 0 rg ${num(MARGEN.izquierdo + ancho)} ${y} Td ${hex(linea)} Tj ET`);
    });
    return this;
  }

  /** Tamaño en puntos con el que se dibujaría la imagen (ajustada al ancho útil, sin ampliarla). */
  tamanoDeImagen(info, { anchoMaximo = this.anchoUtil, altoMaximo = 280, sangria = 14 } = {}) {
    const escala = Math.min((anchoMaximo - sangria) / info.ancho, altoMaximo / info.alto, 1);
    return { ancho: info.ancho * escala, alto: info.alto * escala };
  }

  /** Pasa a una página nueva si no quedan `puntos` libres: sirve para no separar un rótulo de su imagen. */
  reservar(puntos) {
    this.#espacio(puntos);
    return this;
  }

  /**
   * Inserta una imagen JPEG o PNG ajustada al ancho útil (sin ampliarla). Devuelve false si el archivo
   * no es una imagen compatible, para que quien llama deje constancia en el texto.
   */
  imagen(entrada, opciones = {}) {
    const info = Buffer.isBuffer(entrada) ? prepararImagen(entrada) : entrada;
    if (!info) return false;
    const { ancho, alto } = this.tamanoDeImagen(info, opciones);
    this.#espacio(alto + 8);
    this.y -= alto;
    const sangria = opciones.sangria ?? 14;
    const nombre = `Im${this.imagenes.length + 1}`;
    this.imagenes.push({ nombre, ...info });
    this.recursos.at(-1).add(nombre);
    const x = MARGEN.izquierdo + sangria;
    this.paginas.at(-1).push(
      `q ${num(ancho)} 0 0 ${num(alto)} ${num(x)} ${num(this.y)} cm /${nombre} Do Q`,
      `0.8 G 0.5 w ${num(x)} ${num(this.y)} ${num(ancho)} ${num(alto)} re S`
    );
    this.y -= 8;
    return true;
  }

  separador() {
    this.#espacio(8);
    this.y -= 3;
    this.paginas.at(-1).push(`0.75 G 0.6 w ${num(MARGEN.izquierdo)} ${num(this.y)} m ${num(A4.ancho - MARGEN.derecho)} ${num(this.y)} l S`);
    this.y -= 6;
    return this;
  }

  /** Serializa el documento a un Buffer PDF 1.4 (fuentes estándar, sin incrustar). */
    /** Ensambla el archivo PDF (objetos, tabla de referencias cruzadas y pie de página) y devuelve un Buffer. */
  generar() {
    const total = this.paginas.length;
    const objetos = []; // cuerpo de cada objeto (el índice + 1 es su número)
    const agregar = (cuerpo) => objetos.push(cuerpo);

    const catalogo = agregar("");
    const arbol = agregar("");
    const f1 = agregar("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = agregar("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const informacion = agregar(
      `<< /Title ${hexUtf16(this.meta.titulo)} /Author ${hexUtf16(this.meta.autor)} /Producer ${hexUtf16("Sistema de Gestión de Prácticas UDI")} >>`
    );

    const agregarFlujo = (diccionario, datos) =>
      agregar(`${diccionario} /Length ${datos.length} >>\nstream\n${datos.toString("latin1")}\nendstream`);
    const referenciasImagen = new Map();
    for (const im of this.imagenes) {
      const base = `<< /Type /XObject /Subtype /Image /Width ${im.ancho} /Height ${im.alto}`;
      const mascara = im.mascara
        ? agregarFlujo(`${base} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, im.mascara)
        : null;
      const parametros = im.parametros ? ` /DecodeParms << ${im.parametros} >>` : "";
      referenciasImagen.set(
        im.nombre,
        agregarFlujo(`${base} /ColorSpace ${im.espacio} /BitsPerComponent ${im.bpc} /Filter /${im.filtro}${parametros}${mascara ? ` /SMask ${mascara} 0 R` : ""}`, im.datos)
      );
    }

    const hijos = [];
    this.paginas.forEach((comandos, indice) => {
      const pie = `${this.meta.pie ? `${this.meta.pie}   ·   ` : ""}Página ${indice + 1} de ${total}`;
      const anchoPie = medir(pie, 8.5, false);
      const contenido = [...comandos, `BT /F1 8.5 Tf 0.4 g ${num(A4.ancho - MARGEN.derecho - anchoPie)} 34 Td ${hex(pie)} Tj ET`].join("\n");
      const flujo = agregar(`<< /Length ${Buffer.byteLength(contenido, "latin1")} >>\nstream\n${contenido}\nendstream`);
      hijos.push(
        agregar(
          `<< /Type /Page /Parent ${arbol} 0 R /MediaBox [0 0 ${A4.ancho} ${A4.alto}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${this.recursos[indice].size ? ` /XObject << ${[...this.recursos[indice]].map((n) => `/${n} ${referenciasImagen.get(n)} 0 R`).join(" ")} >>` : ""} >> /Contents ${flujo} 0 R >>`
        )
      );
    });
    objetos[catalogo - 1] = `<< /Type /Catalog /Pages ${arbol} 0 R >>`;
    objetos[arbol - 1] = `<< /Type /Pages /Kids [${hijos.map((n) => `${n} 0 R`).join(" ")}] /Count ${total} >>`;

    let salida = "%PDF-1.4\n%âãÏÓ\n";
    const posiciones = [];
    objetos.forEach((cuerpo, i) => {
      posiciones.push(Buffer.byteLength(salida, "latin1"));
      salida += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
    });
    const inicioXref = Buffer.byteLength(salida, "latin1");
    salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
    for (const posicion of posiciones) salida += `${String(posicion).padStart(10, "0")} 00000 n \n`;
    salida += `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R /Info ${informacion} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
    return Buffer.from(salida, "latin1");
  }
}

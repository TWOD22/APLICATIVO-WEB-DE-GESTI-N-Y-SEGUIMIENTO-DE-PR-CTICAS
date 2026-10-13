/**
 * Pruebas unitarias del generador de PDF: ajuste de texto, estructura, codificación, paginación e imágenes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textoDelPdf } from "../helpers/pdf.js";
import { deflateSync } from "node:zlib";
import { ajustarTexto, DocumentoPdf, prepararImagen } from "../../src/utils/pdf.js";

describe("generador de PDF", () => {
  it("parte el texto en líneas que caben, respeta saltos y corta palabras gigantes", () => {
    const lineas = ajustarTexto("uno dos tres cuatro cinco seis siete ocho nueve diez", { anchoMaximo: 80 });
    assert.ok(lineas.length > 1);
    assert.equal(lineas.join(" "), "uno dos tres cuatro cinco seis siete ocho nueve diez");
    assert.deepEqual(ajustarTexto("a\n\nb", { anchoMaximo: 200 }), ["a", "", "b"]);
    const larga = ajustarTexto("x".repeat(500), { anchoMaximo: 100 });
    assert.ok(larga.length > 3 && larga.every((l) => l.length < 60));
    assert.equal(larga.join(""), "x".repeat(500));
    assert.deepEqual(ajustarTexto("", { anchoMaximo: 100 }), [""]);
  });

  it("genera un PDF 1.4 bien formado: cabecera, tabla xref con posiciones exactas y fin de archivo", () => {
    const doc = new DocumentoPdf({ titulo: "Título ñ", autor: "Autor", pie: "Pie" });
    doc.titulo("Hola").seccion("Sección").campo("Etiqueta", "valor").parrafo("texto");
    const buffer = doc.generar();
    const texto = buffer.toString("latin1");
    assert.ok(texto.startsWith("%PDF-1.4\n"));
    assert.ok(texto.endsWith("%%EOF\n"));

    const inicio = Number(/startxref\n(\d+)\n/.exec(texto)[1]);
    assert.ok(texto.slice(inicio).startsWith("xref\n"));
    const entradas = [...texto.slice(inicio).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    assert.ok(entradas.length >= 7);
    entradas.forEach((posicion, i) => assert.ok(texto.slice(posicion).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1} fuera de posición`));
    assert.match(texto, /\/Count 1 /);
  });

  it("codifica acentos y eñes, convierte símbolos inexistentes en '?' y escapa lo peligroso", () => {
    const doc = new DocumentoPdf();
    doc.parrafo("Educación Infantil: año, niño, ¿qué? “comillas” (paréntesis) \\ barra € 😀");
    const texto = textoDelPdf(doc.generar());
    assert.ok(texto.includes("Educación Infantil: año, niño, ¿qué?"));
    assert.ok(texto.includes("(paréntesis) \\ barra \u0080 ?"), "el euro usa el código 128 de WinAnsi y el emoji se muestra como ?");
  });

  it("pasa a una página nueva cuando el contenido no cabe y numera el pie", () => {
    const doc = new DocumentoPdf({ pie: "Bitácora" });
    for (let i = 0; i < 120; i++) doc.parrafo(`Párrafo número ${i}`);
    const buffer = doc.generar();
    const texto = buffer.toString("latin1");
    const paginas = Number(/\/Count (\d+) /.exec(texto)[1]);
    assert.ok(paginas >= 3);
    const mostrado = textoDelPdf(buffer);
    assert.ok(mostrado.includes(`Página 1 de ${paginas}`));
    assert.ok(mostrado.includes(`Página ${paginas} de ${paginas}`));
    assert.ok(mostrado.includes("Párrafo número 119"));
  });

  it("no deja un encabezado de sección solo al final de la página", () => {
    const doc = new DocumentoPdf();
    for (let i = 0; i < 48; i++) doc.parrafo(`Línea ${i}`);
    doc.seccion("Encabezado");
    doc.parrafo("Contenido de la sección");
    const texto = textoDelPdf(doc.generar()).split("\n");
    const posicion = texto.indexOf("Encabezado");
    const pie1 = texto.findIndex((l) => l.startsWith("Página 1 de"));
    assert.ok(posicion > pie1, "el encabezado pasó a la página siguiente junto con su contenido");
  });

  describe("imágenes", () => {
    const crc = () => Buffer.alloc(4); // este lector no verifica el CRC de los fragmentos
    const fragmento = (tipo, datos) => {
      const largo = Buffer.alloc(4);
      largo.writeUInt32BE(datos.length);
      return Buffer.concat([largo, Buffer.from(tipo, "latin1"), datos, crc()]);
    };
    /** PNG sin filtros de `ancho`x`alto` con `canales` canales de 8 bits (tipo de color 2 = RGB, 6 = RGBA, 0 = gris). */
    const png = ({ ancho = 3, alto = 2, tipoColor = 2, canales = 3, valor = (x, y, c) => (x * 40 + y * 20 + c * 5) & 0xff, entrelazado = 0 } = {}) => {
      const filas = [];
      for (let y = 0; y < alto; y++) {
        const fila = [0]; // filtro "ninguno"
        for (let x = 0; x < ancho; x++) for (let c = 0; c < canales; c++) fila.push(valor(x, y, c));
        filas.push(Buffer.from(fila));
      }
      const cabecera = Buffer.alloc(13);
      cabecera.writeUInt32BE(ancho, 0);
      cabecera.writeUInt32BE(alto, 4);
      cabecera[8] = 8;
      cabecera[9] = tipoColor;
      cabecera[12] = entrelazado;
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        fragmento("IHDR", cabecera),
        fragmento("IDAT", deflateSync(Buffer.concat(filas))),
        fragmento("IEND", Buffer.alloc(0)),
      ]);
    };
    /** Cabecera JPEG mínima con un marcador SOF0 (el lector solo necesita dimensiones y componentes). */
    const jpeg = (ancho, alto, componentes) =>
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 8 + componentes * 3, 8, alto >> 8, alto & 255, ancho >> 8, ancho & 255, componentes]), Buffer.alloc(componentes * 3, 1), Buffer.from([0xff, 0xd9])]);

    it("reconoce PNG (RGB, RGBA, gris) y JPEG (RGB, gris) y rechaza lo demás", () => {
      assert.deepEqual([prepararImagen(png()).ancho, prepararImagen(png()).alto, prepararImagen(png()).espacio], [3, 2, "/DeviceRGB"]);
      assert.equal(prepararImagen(png({ tipoColor: 0, canales: 1 })).espacio, "/DeviceGray");
      assert.ok(prepararImagen(png({ tipoColor: 6, canales: 4, valor: (x, y, c) => (c === 3 ? 128 : 9) })).mascara, "la transparencia se conserva como máscara");
      assert.equal(prepararImagen(png({ tipoColor: 6, canales: 4, valor: (x, y, c) => (c === 3 ? 255 : 9) })).mascara, null, "una imagen opaca no necesita máscara");
      assert.deepEqual([prepararImagen(jpeg(640, 480, 3)).ancho, prepararImagen(jpeg(640, 480, 3)).filtro], [640, "DCTDecode"]);
      assert.equal(prepararImagen(jpeg(10, 10, 1)).espacio, "/DeviceGray");
      assert.equal(prepararImagen(jpeg(10, 10, 4)), null, "JPEG CMYK no soportado");
      assert.equal(prepararImagen(png({ entrelazado: 1 })), null, "PNG entrelazado no soportado");
      assert.equal(prepararImagen(png().subarray(0, 40)), null, "PNG truncado");
      assert.equal(prepararImagen(Buffer.from("no soy una imagen")), null);
      assert.equal(prepararImagen(Buffer.alloc(0)), null);
    });

    it("incrusta imágenes: objetos XObject, recursos de la página y tabla xref exacta", () => {
      const doc = new DocumentoPdf();
      doc.parrafo("Con imagen");
      assert.equal(doc.imagen(png({ ancho: 40, alto: 30, tipoColor: 6, canales: 4, valor: (x, y, c) => (c === 3 ? 100 : x) })), true);
      assert.equal(doc.imagen(jpeg(800, 600, 3)), true);
      assert.equal(doc.imagen(Buffer.from("basura")), false, "una imagen inválida no rompe el documento");
      const buffer = doc.generar();
      const texto = buffer.toString("latin1");
      assert.equal((texto.match(/\/Subtype \/Image/g) ?? []).length, 3, "dos imágenes más la máscara");
      assert.match(texto, /\/SMask \d+ 0 R/);
      assert.match(texto, /\/XObject << \/Im1 \d+ 0 R \/Im2 \d+ 0 R >>/);
      assert.match(texto, /\/Filter \/DCTDecode/);
      assert.ok(textoDelPdf(buffer).includes("Con imagen"));
      const inicio = Number(/startxref\n(\d+)\n/.exec(texto)[1]);
      const entradas = [...texto.slice(inicio).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
      entradas.forEach((posicion, i) => assert.ok(texto.slice(posicion).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1} fuera de posición (datos binarios)`));
    });

    it("ajusta imágenes grandes al ancho útil y, si no caben, las pasa a la página siguiente", () => {
      const doc = new DocumentoPdf();
      const { ancho, alto } = doc.tamanoDeImagen({ ancho: 4000, alto: 1000 });
      assert.ok(ancho <= doc.anchoUtil && Math.abs(ancho / alto - 4) < 0.01);
      assert.deepEqual(doc.tamanoDeImagen({ ancho: 50, alto: 40 }), { ancho: 50, alto: 40 }, "no se amplía");
      for (let i = 0; i < 4; i++) doc.imagen(jpeg(1000, 1000, 3)); // 280 pt de alto cada una
      assert.match(doc.generar().toString("latin1"), /\/Count 2 /);
    });
  });
});

/**
 * Pruebas unitarias de utilidades de archivos (nombres seguros y detección del tipo real por contenido).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contenidoCoincideConTipo, esPdfLegible, sanitizarNombre } from "../../src/utils/archivos.js";
import { JPG, PDF, PNG } from "../helpers/escenario.js";

describe("utilidades de archivos", () => {
  it("sanitizarNombre quita rutas y caracteres de control, y usa el respaldo si queda vacío", () => {
    assert.equal(sanitizarNombre("..\\..\\etc/pasaporte.jpg", "x.jpg"), "pasaporte.jpg");
    assert.equal(sanitizarNombre("foto\u0000.jpg", "x.jpg"), "foto.jpg");
    assert.equal(sanitizarNombre("   ", "respaldo.jpg"), "respaldo.jpg");
    assert.equal(sanitizarNombre(undefined, "respaldo.jpg"), "respaldo.jpg");
    assert.equal(sanitizarNombre("a".repeat(400), "x").length, 255);
  });

  it("reconoce PDF, JPG y PNG por su contenido real", () => {
    assert.equal(esPdfLegible(PDF), true);
    assert.equal(contenidoCoincideConTipo(PDF, "application/pdf"), true);
    assert.equal(contenidoCoincideConTipo(JPG(), "image/jpeg"), true);
    assert.equal(contenidoCoincideConTipo(PNG(), "image/png"), true);
  });

  it("rechaza archivos truncados, vacíos o que no corresponden al tipo declarado", () => {
    assert.equal(contenidoCoincideConTipo(PDF.subarray(0, 30), "application/pdf"), false);
    assert.equal(contenidoCoincideConTipo(JPG().subarray(0, 10), "image/jpeg"), false);
    assert.equal(contenidoCoincideConTipo(PNG(), "image/jpeg"), false);
    assert.equal(contenidoCoincideConTipo(JPG(), "image/png"), false);
    assert.equal(contenidoCoincideConTipo(PDF, "image/png"), false);
    assert.equal(contenidoCoincideConTipo(Buffer.from("MZ ejecutable"), "image/jpeg"), false);
    assert.equal(contenidoCoincideConTipo(Buffer.alloc(0), "image/png"), false);
    assert.equal(contenidoCoincideConTipo(JPG(), "image/gif"), false);
  });
});

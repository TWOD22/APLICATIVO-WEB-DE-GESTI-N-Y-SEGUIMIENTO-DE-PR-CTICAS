/**
 * Pruebas unitarias de paginación, escape de LIKE y cálculo de cambios (diff).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { armarMetaPaginacion, calcularPaginacion, escaparLike } from "../../src/utils/pagination.js";
import { calcularCambios } from "../../src/utils/diff.js";

describe("paginación", () => {
  it("usa valores por defecto", () => {
    assert.deepEqual(calcularPaginacion({}), { page: 1, page_size: 20, limit: 20, offset: 0 });
  });
  it("calcula el desplazamiento y limita el tamaño máximo", () => {
    assert.deepEqual(calcularPaginacion({ page: 3, page_size: 10 }), { page: 3, page_size: 10, limit: 10, offset: 20 });
    assert.equal(calcularPaginacion({ page_size: 5000 }).limit, 100);
    assert.equal(calcularPaginacion({ page: -4 }).page, 1);
  });
  it("arma los metadatos del contrato de listados", () => {
    assert.deepEqual(armarMetaPaginacion({ page: 1, page_size: 20 }, 124), { page: 1, page_size: 20, total: 124, total_pages: 7 });
    assert.equal(armarMetaPaginacion({ page: 1, page_size: 20 }, 0).total_pages, 1);
  });
  it("escapa comodines de LIKE", () => {
    assert.equal(escaparLike("100%_\\"), "100\\%\\_\\\\");
  });
});

describe("calcularCambios", () => {
  it("devuelve solo lo que cambió y respeta undefined", () => {
    const r = calcularCambios({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: undefined, d: 5 }, ["a", "b", "c"]);
    assert.deepEqual(r.nuevo, { b: "y" });
    assert.deepEqual(r.anterior, { b: "x" });
    assert.equal(r.hayCambios, true);
  });
  it("trata null y vacío como cambio solo si difieren", () => {
    assert.equal(calcularCambios({ t: null }, { t: null }, ["t"]).hayCambios, false);
    assert.equal(calcularCambios({ t: "1" }, { t: null }, ["t"]).hayCambios, true);
  });
});

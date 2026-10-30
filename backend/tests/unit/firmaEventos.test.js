/**
 * Pruebas de la firma de eventos entre servicios (HMAC-SHA256 con marca de tiempo).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { firmar, TOLERANCIA_SEGUNDOS, verificar } from "../../src/utils/firmaEventos.js";

const SECRETO = "s".repeat(40);
const ahora = 1_800_000_000;

describe("firma de eventos", () => {
  it("una firma válida se verifica", () => {
    const firma = firmar('{"a":1}', String(ahora), SECRETO);
    assert.equal(verificar({ cuerpo: '{"a":1}', marca: String(ahora), firma, secreto: SECRETO, ahora }), true);
  });

  it("rechaza cuerpo alterado, secreto distinto y firma ausente o mal formada", () => {
    const firma = firmar('{"a":1}', String(ahora), SECRETO);
    assert.equal(verificar({ cuerpo: '{"a":2}', marca: String(ahora), firma, secreto: SECRETO, ahora }), false);
    assert.equal(verificar({ cuerpo: '{"a":1}', marca: String(ahora), firma, secreto: "otro".repeat(12), ahora }), false);
    for (const mala of [undefined, "", "xyz", firma.slice(2)]) {
      assert.equal(verificar({ cuerpo: '{"a":1}', marca: String(ahora), firma: mala, secreto: SECRETO, ahora }), false);
    }
  });

  it("rechaza mensajes fuera de la tolerancia de tiempo (anti-repetición) y marcas inválidas", () => {
    const vieja = String(ahora - TOLERANCIA_SEGUNDOS - 1);
    assert.equal(verificar({ cuerpo: "x", marca: vieja, firma: firmar("x", vieja, SECRETO), secreto: SECRETO, ahora }), false);
    const dentro = String(ahora - TOLERANCIA_SEGUNDOS + 1);
    assert.equal(verificar({ cuerpo: "x", marca: dentro, firma: firmar("x", dentro, SECRETO), secreto: SECRETO, ahora }), true);
    assert.equal(verificar({ cuerpo: "x", marca: "abc", firma: firmar("x", "abc", SECRETO), secreto: SECRETO, ahora }), false);
  });
});

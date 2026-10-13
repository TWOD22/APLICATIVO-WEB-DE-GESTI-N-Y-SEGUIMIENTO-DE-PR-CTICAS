/**
 * Pruebas unitarias de los middlewares authorize, validar y errorHandler.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { authorize } from "../../src/middlewares/authorize.js";
import { validar } from "../../src/middlewares/validate.js";
import { errorHandler } from "../../src/middlewares/errorHandler.js";
import { notFound } from "../../src/middlewares/notFound.js";
import { ApiError } from "../../src/utils/apiError.js";

const ejecutar = (middleware, req) => {
  let resultado = "sin-llamar";
  middleware(req, {}, (error) => {
    resultado = error ?? "siguiente";
  });
  return resultado;
};

describe("authorize", () => {
  const auth = (rolActivo, roles = [rolActivo]) => ({ rolActivo, roles: roles.map((codigo) => ({ codigo })) });

  it("permite el rol activo autorizado", () => {
    assert.equal(ejecutar(authorize("DIRECTOR_PROGRAMA"), { auth: auth("DIRECTOR_PROGRAMA") }), "siguiente");
  });
  it("rechaza otro rol con 403", () => {
    const error = ejecutar(authorize("DIRECTOR_PROGRAMA"), { auth: auth("ESTUDIANTE") });
    assert.equal(error.estado_http, 403);
    assert.equal(error.codigo, "FORBIDDEN");
  });
  it("no suma permisos: con varios roles y sin rol activo exige elegir contexto", () => {
    const error = ejecutar(authorize("DIRECTOR_PROGRAMA"), { auth: auth(null, ["DIRECTOR_PROGRAMA", "DOCENTE_SUPERVISOR"]) });
    assert.equal(error.codigo, "ROLE_CONTEXT_REQUIRED");
    assert.deepEqual(error.detalles[0].roles_disponibles, ["DIRECTOR_PROGRAMA", "DOCENTE_SUPERVISOR"]);
  });
  it("sin autenticación responde 401", () => {
    assert.equal(ejecutar(authorize("ESTUDIANTE"), {}).estado_http, 401);
  });
});

describe("validar", () => {
  const esquemas = {
    body: z.object({ n: z.coerce.number().int() }).strict(),
    params: z.object({ id: z.string().uuid() }),
  };
  it("reemplaza los valores por los normalizados", () => {
    const req = { body: { n: "5" }, params: { id: "5f8b3c1e-8f3a-4d3a-9c0e-2b1a7c6d5e4f" } };
    assert.equal(ejecutar(validar(esquemas), req), "siguiente");
    assert.equal(req.body.n, 5);
  });
  it("junta los errores de todos los orígenes", () => {
    const error = ejecutar(validar(esquemas), { body: { n: "x", extra: 1 }, params: { id: "no" } });
    assert.equal(error.estado_http, 400);
    assert.equal(error.codigo, "VALIDATION_ERROR");
    assert.deepEqual([...new Set(error.detalles.map((d) => d.origen))].sort(), ["body", "params"]);
  });
});

function respuestaFalsa() {
  return {
    headersSent: false,
    status(codigo) { this.codigo = codigo; return this; },
    json(cuerpo) { this.cuerpo = cuerpo; return this; },
  };
}
const manejar = (error) => {
  const res = respuestaFalsa();
  errorHandler(error, { id: "req-1", originalUrl: "/api/v1/x?y=1", method: "GET" }, res, () => {});
  return res;
};

describe("errorHandler", () => {
  it("serializa ApiError con el contrato normalizado", () => {
    const res = manejar(ApiError.conflicto("Duplicado", "DUPLICATE_USER", [{ campo: "correo" }]));
    assert.equal(res.codigo, 409);
    assert.deepEqual(res.cuerpo, {
      error: { code: "DUPLICATE_USER", message: "Duplicado", details: [{ campo: "correo" }], request_id: "req-1" },
    });
  });
  it("convierte ZodError en 400", () => {
    const resultado = z.object({ a: z.string() }).safeParse({});
    const res = manejar(resultado.error);
    assert.equal(res.codigo, 400);
    assert.equal(res.cuerpo.error.code, "VALIDATION_ERROR");
  });
  it("traduce errores de PostgreSQL sin filtrar detalles internos", () => {
    const unico = manejar(Object.assign(new Error('duplicate key value violates unique constraint "uq_usuarios_correo"'), { code: "23505" }));
    assert.equal(unico.codigo, 409);
    assert.doesNotMatch(JSON.stringify(unico.cuerpo), /uq_usuarios_correo/);
    assert.equal(manejar(Object.assign(new Error("x"), { code: "22P02" })).codigo, 400);
    assert.equal(manejar(Object.assign(new Error("x"), { code: "23503" })).codigo, 409);
  });
  it("expone el mensaje de nuestras funciones de validación (check_violation sin constraint)", () => {
    const res = manejar(Object.assign(new Error("El asesor no pertenece a la institución seleccionada en este periodo"), { code: "23514" }));
    assert.equal(res.codigo, 422);
    assert.match(res.cuerpo.error.message, /asesor no pertenece/);
  });
  it("oculta el detalle de un check constraint genérico", () => {
    const res = manejar(Object.assign(new Error('new row violates check constraint "ck_x"'), { code: "23514", constraint: "ck_x" }));
    assert.equal(res.codigo, 422);
    assert.doesNotMatch(res.cuerpo.error.message, /ck_x/);
  });
  it("maneja JSON inválido y cuerpos demasiado grandes", () => {
    assert.equal(manejar(Object.assign(new Error("bad"), { type: "entity.parse.failed" })).cuerpo.error.code, "INVALID_JSON");
    assert.equal(manejar(Object.assign(new Error("big"), { type: "entity.too.large" })).codigo, 413);
  });
  it("errores desconocidos responden 500 genérico sin stack", () => {
    const res = manejar(new Error("secreto interno: password=123"));
    assert.equal(res.codigo, 500);
    assert.equal(res.cuerpo.error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(res.cuerpo), /secreto|password|stack/i);
  });
  it("notFound produce 404 ROUTE_NOT_FOUND", () => {
    const error = ejecutar(notFound, { method: "GET", path: "/nada" });
    assert.equal(error.estado_http, 404);
    assert.equal(error.codigo, "ROUTE_NOT_FOUND");
  });
});

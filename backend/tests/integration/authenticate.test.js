/**
 * Pruebas del middleware de autenticación: token ausente o inválido, usuario no registrado o inactivo, y rol activo validado contra la base de datos.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

describe("middleware authenticate", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, authenticate, firebase;

  const solicitud = (cabeceras = {}) => ({ get: (nombre) => cabeceras[nombre.toLowerCase()] });
  const correr = (req) =>
    new Promise((resolve) => authenticate(req, {}, (error) => resolve({ error, req })));

  before(async () => {
    ({ pool, cerrarPool } = await import("../../src/config/database.js"));
    const { ejecutarSeedBase } = await import("../../src/database/seeds/base.js");
    const { sustituirFirebaseParaPruebas } = await import("../../src/config/firebase.js");
    ({ authenticate } = await import("../../src/middlewares/authenticate.js"));

    firebase = crearFirebaseFalso();
    sustituirFirebaseParaPruebas(firebase.implementacion);
    await reconstruirEsquema(pool);
    await limpiarYSembrar(pool, ejecutarSeedBase, {
      director: { firebase_uid: "uid-director", documento: "10203040", nombres: "Dora", apellidos: "Directora", correo: "d@udi.test" },
    });
    await pool.query(
      `INSERT INTO usuarios (firebase_uid, numero_documento, nombres, apellidos, correo_institucional, estado)
       VALUES ('uid-inactivo', '2000000001', 'Iván', 'Inactivo', 'inactivo@udi.test', 'INACTIVO'),
              ('uid-sinrol', '2000000002', 'Sara', 'Sinrol', 'sinrol@udi.test', 'ACTIVO')`
    );
    await pool.query(
      `INSERT INTO usuarios_roles (usuario_id, rol_id)
       SELECT u.id, r.id FROM usuarios u, roles r
        WHERE (u.firebase_uid = 'uid-inactivo' AND r.codigo = 'ESTUDIANTE')
           OR (u.firebase_uid = 'uid-director' AND r.codigo = 'DOCENTE_SUPERVISOR')`
    );
  });

  after(async () => {
    if (cerrarPool) await cerrarPool();
  });

  it("sin cabecera Authorization responde 401", async () => {
    const { error } = await correr(solicitud());
    assert.equal(error.estado_http, 401);
    assert.equal(error.codigo, "UNAUTHENTICATED");
  });

  it("rechaza esquemas distintos de Bearer y tokens inválidos", async () => {
    assert.equal((await correr(solicitud({ authorization: "Basic abc" }))).error.codigo, "UNAUTHENTICATED");
    const { error } = await correr(solicitud({ authorization: "Bearer token-falso" }));
    assert.equal(error.estado_http, 401);
    assert.equal(error.codigo, "INVALID_TOKEN");
  });

  it("un token válido sin usuario en PostgreSQL responde 403", async () => {
    const token = firebase.emitirToken("uid-que-no-existe");
    const { error } = await correr(solicitud({ authorization: `Bearer ${token}` }));
    assert.equal(error.estado_http, 403);
    assert.equal(error.codigo, "USER_NOT_REGISTERED");
  });

  it("usuario inactivo no accede aunque Firebase lo autentique", async () => {
    const token = firebase.emitirToken("uid-inactivo");
    assert.equal((await correr(solicitud({ authorization: `Bearer ${token}` }))).error.codigo, "USER_INACTIVE");
  });

  it("usuario activo sin roles vigentes no accede", async () => {
    const token = firebase.emitirToken("uid-sinrol");
    assert.equal((await correr(solicitud({ authorization: `Bearer ${token}` }))).error.codigo, "NO_ACTIVE_ROLES");
  });

  it("con varios roles el contexto sale del header validado contra la base de datos", async () => {
    const token = firebase.emitirToken("uid-director");
    const base = { authorization: `Bearer ${token}` };

    const sinRol = await correr(solicitud(base));
    assert.equal(sinRol.error, undefined);
    assert.equal(sinRol.req.auth.rolActivo, null);
    assert.equal(sinRol.req.auth.roles.length, 2);

    const conRol = await correr(solicitud({ ...base, "x-active-role": "DOCENTE_SUPERVISOR" }));
    assert.equal(conRol.req.auth.rolActivo, "DOCENTE_SUPERVISOR");

    const ajeno = await correr(solicitud({ ...base, "x-active-role": "ASESOR_SITIO" }));
    assert.equal(ajeno.error.codigo, "ROLE_NOT_ASSIGNED");
    assert.equal(ajeno.error.estado_http, 403);
  });

  it("el contexto de autenticación es inmutable", async () => {
    const token = firebase.emitirToken("uid-director");
    const { req } = await correr(solicitud({ authorization: `Bearer ${token}`, "x-active-role": "DIRECTOR_PROGRAMA" }));
    assert.throws(() => {
      "use strict";
      req.auth.rolActivo = "ESTUDIANTE";
    }, TypeError);
  });
});

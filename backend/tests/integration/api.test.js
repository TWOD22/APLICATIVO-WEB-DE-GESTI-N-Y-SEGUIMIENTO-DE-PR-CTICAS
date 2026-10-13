/**
 * Pruebas de la API HTTP: sondas de salud, errores normalizados, sesión (/me), usuarios, instituciones, catálogos y CORS.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

/**
 * Pruebas HTTP de extremo a extremo (Express real + PostgreSQL real + Firebase en memoria).
 * Usan fetch nativo de Node: no requieren librerías adicionales.
 */
describe("API HTTP /api/v1", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, servidor, base, firebase, tokenDirector;

  const pedir = async (ruta, { token, metodo = "GET", cuerpo, cabeceras = {} } = {}) => {
    const respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: {
        ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...cabeceras,
      },
      body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    });
    const texto = await respuesta.text();
    return { estado: respuesta.status, cabeceras: respuesta.headers, json: texto ? JSON.parse(texto) : null };
  };

  before(async () => {
    ({ pool, cerrarPool } = await import("../../src/config/database.js"));
    const { ejecutarSeedBase } = await import("../../src/database/seeds/base.js");
    const { sustituirFirebaseParaPruebas } = await import("../../src/config/firebase.js");
    const { crearApp } = await import("../../src/app.js");

    firebase = crearFirebaseFalso();
    sustituirFirebaseParaPruebas(firebase.implementacion);
    await reconstruirEsquema(pool);
    await limpiarYSembrar(pool, ejecutarSeedBase, {
      director: { firebase_uid: "uid-director", documento: "10203040", nombres: "Dora", apellidos: "Directora", correo: "director@udi.test" },
    });
    tokenDirector = firebase.emitirToken("uid-director");

    servidor = crearApp().listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (cerrarPool) await cerrarPool();
  });

  it("GET /health responde sin autenticación y con X-Request-Id", async () => {
    const r = await pedir("/health");
    assert.equal(r.estado, 200);
    assert.equal(r.json.data.status, "ok");
    assert.ok(r.cabeceras.get("x-request-id"));
    assert.equal(r.cabeceras.get("x-powered-by"), null);
    assert.equal(r.cabeceras.get("x-content-type-options"), "nosniff");
  });

  it("GET /ready verifica PostgreSQL y Firebase", async () => {
    const r = await pedir("/ready");
    assert.equal(r.estado, 200);
    assert.deepEqual(r.json.data.checks, { postgres: true, firebase: true });
  });

  it("rutas inexistentes devuelven el error normalizado", async () => {
    const r = await pedir("/api/v1/no-existe");
    assert.equal(r.estado, 404);
    assert.equal(r.json.error.code, "ROUTE_NOT_FOUND");
    assert.ok(r.json.error.request_id);
  });

  it("GET /me exige token válido", async () => {
    assert.equal((await pedir("/api/v1/me")).estado, 401);
    const invalido = await pedir("/api/v1/me", { token: "basura" });
    assert.equal(invalido.estado, 401);
    assert.equal(invalido.json.error.code, "INVALID_TOKEN");
  });

  it("GET /me devuelve usuario, roles y rol activo", async () => {
    const r = await pedir("/api/v1/me", { token: tokenDirector });
    assert.equal(r.estado, 200);
    assert.equal(r.json.data.rol_activo, "DIRECTOR_PROGRAMA");
    assert.equal(r.json.data.usuario.correo, "director@udi.test");
    assert.equal(r.json.data.usuario.firebase_uid, undefined);
  });

  it("rechaza JSON mal formado y campos desconocidos", async () => {
    const malo = await pedir("/api/v1/users", { token: tokenDirector, metodo: "POST", cuerpo: "{no es json" });
    assert.equal(malo.estado, 400);
    assert.equal(malo.json.error.code, "INVALID_JSON");
    const extra = await pedir("/api/v1/users", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { rol: "DOCENTE_SUPERVISOR", documento: "1098000002", nombres: "Juan", apellidos: "Suárez", correo: "j@udi.test", estado: "ACTIVO" },
    });
    assert.equal(extra.estado, 400);
    assert.equal(extra.json.error.code, "VALIDATION_ERROR");
  });

  it("ciclo de usuarios: crear, listar, duplicado, detalle y permisos por rol", async () => {
    const creado = await pedir("/api/v1/users", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { rol: "ESTUDIANTE", documento: "1098000001", nombres: "Luis", apellidos: "Pérez", correo: "Luis@UDI.test", semestre: 6 },
    });
    assert.equal(creado.estado, 201);
    assert.equal(creado.json.data.correo, "luis@udi.test");
    assert.ok(creado.json.data.enlace_definir_contrasena);
    const id = creado.json.data.id;

    const duplicado = await pedir("/api/v1/users", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { rol: "DOCENTE_SUPERVISOR", documento: "1098000001", nombres: "Xavier", apellidos: "Yepes", correo: "otro@udi.test" },
    });
    assert.equal(duplicado.estado, 409);
    assert.equal(duplicado.json.error.code, "DUPLICATE_USER");

    const lista = await pedir("/api/v1/users?rol=ESTUDIANTE&page=1&page_size=10", { token: tokenDirector });
    assert.equal(lista.estado, 200);
    assert.equal(lista.json.meta.total, 1);
    assert.equal(lista.json.meta.total_pages, 1);
    assert.equal(lista.json.data[0].id, id);

    assert.equal((await pedir(`/api/v1/users/${id}`, { token: tokenDirector })).json.data.matricula_actual.semestre, 6);
    assert.equal((await pedir("/api/v1/users/no-es-uuid", { token: tokenDirector })).estado, 400);

    // El estudiante no puede usar rutas del Director ni ver a otros
    const uid = (await pool.query("SELECT firebase_uid FROM usuarios WHERE id = $1", [id])).rows[0].firebase_uid;
    const tokenEstudiante = firebase.emitirToken(uid);
    assert.equal((await pedir("/api/v1/users", { token: tokenEstudiante })).estado, 403);
    assert.equal((await pedir(`/api/v1/users/${id}`, { token: tokenEstudiante })).estado, 403);
    assert.equal((await pedir("/api/v1/institutions", { token: tokenEstudiante })).estado, 403);
    assert.equal((await pedir("/api/v1/periods", { token: tokenEstudiante })).estado, 200, "los catálogos son de lectura para cualquier rol");
  });

  it("cambio de estado: bloquea el acceso del usuario deshabilitado", async () => {
    const { rows } = await pool.query("SELECT id, firebase_uid FROM usuarios WHERE numero_documento = '1098000001'");
    const r = await pedir(`/api/v1/users/${rows[0].id}/status`, { token: tokenDirector, metodo: "PATCH", cuerpo: { estado: "INACTIVO" } });
    assert.equal(r.estado, 200);
    const sesion = await pedir("/api/v1/me", { token: firebase.emitirToken(rows[0].firebase_uid) });
    assert.equal(sesion.estado, 403);
    assert.equal(sesion.json.error.code, "USER_INACTIVE");
  });

  it("instituciones: crear, NIT duplicado y listado", async () => {
    const cuerpo = { nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" };
    const creada = await pedir("/api/v1/institutions", { token: tokenDirector, metodo: "POST", cuerpo });
    assert.equal(creada.estado, 201);
    assert.equal((await pedir("/api/v1/institutions", { token: tokenDirector, metodo: "POST", cuerpo })).estado, 409);
    const lista = await pedir("/api/v1/institutions?q=jard", { token: tokenDirector });
    assert.equal(lista.json.meta.total, 1);
  });

  it("catálogos académicos", async () => {
    const niveles = await pedir("/api/v1/practice-levels", { token: tokenDirector });
    assert.equal(niveles.json.data.length, 8);
    assert.deepEqual(niveles.json.data.map((n) => [n.codigo, n.semestre]), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`PP${n}`, n]));
    assert.equal((await pedir("/api/v1/programs", { token: tokenDirector })).json.data[0].codigo, "LEI");
    assert.equal((await pedir("/api/v1/periods", { token: tokenDirector })).json.data[0].es_activo, true);
  });

  it("CORS: rechaza orígenes no permitidos y acepta los configurados", async () => {
    const denegado = await pedir("/api/v1/periods", { token: tokenDirector, cabeceras: { Origin: "https://malicioso.example" } });
    assert.equal(denegado.estado, 403);
    assert.equal(denegado.json.error.code, "CORS_ORIGIN_DENIED");
    const permitido = await pedir("/health", { cabeceras: { Origin: "http://localhost:5173" } });
    assert.equal(permitido.cabeceras.get("access-control-allow-origin"), "http://localhost:5173");
  });
});

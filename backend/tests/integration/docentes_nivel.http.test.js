/**
 * Pruebas HTTP de docentes por nivel de práctica (Fase 1 del flujo v2):
 * el Director define un docente por nivel y periodo; un docente puede tener varios niveles.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

describe("API HTTP · docentes por nivel", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, servidor, base, firebase;
  let tokenDirector, tokenDocente, tokenEstudiante, docente1, docente2, estudiante, asesor, niveles, periodoActivo;

  const pedir = async (ruta, { token, metodo = "GET", cuerpo } = {}) => {
    const respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await respuesta.text();
    return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
  };
  const definir = (nivelId, cuerpo, token = tokenDirector) => pedir(`/api/v1/level-teachers/${nivelId}`, { token, metodo: "PUT", cuerpo });
  const filaDe = async (nivelId) => (await pedir("/api/v1/level-teachers", { token: tokenDirector })).json.data.niveles.find((n) => n.nivel.id === nivelId);

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

    const crear = async (cuerpo) => {
      const r = await pedir("/api/v1/users", { token: tokenDirector, metodo: "POST", cuerpo });
      assert.equal(r.estado, 201, JSON.stringify(r.json));
      const uid = (await pool.query("SELECT firebase_uid FROM usuarios WHERE id = $1", [r.json.data.id])).rows[0].firebase_uid;
      return { id: r.json.data.id, token: firebase.emitirToken(uid) };
    };
    docente1 = await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    docente2 = await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000002", nombres: "Claudia", apellidos: "Martínez", correo: "claudia@udi.test" });
    estudiante = await crear({ rol: "ESTUDIANTE", documento: "2000000001", nombres: "Laura", apellidos: "Aguilar", correo: "laura@udi.test", semestre: 1 });
    const inst = await pedir("/api/v1/institutions", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" },
    });
    asesor = await crear({ rol: "ASESOR_SITIO", documento: "4000000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: inst.json.data.id });
    tokenDocente = docente1.token;
    tokenEstudiante = estudiante.token;
    niveles = (await pedir("/api/v1/practice-levels", { token: tokenDirector })).json.data;
    periodoActivo = (await pedir("/api/v1/periods", { token: tokenDirector })).json.data.find((p) => p.es_activo);
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (cerrarPool) await cerrarPool();
  });

  it("solo el Director consulta y configura (sin sesión 401; docente y estudiante 403)", async () => {
    assert.equal((await pedir("/api/v1/level-teachers")).estado, 401);
    assert.equal((await pedir("/api/v1/level-teachers", { token: tokenDocente })).estado, 403);
    assert.equal((await definir(niveles[0].id, { docente_id: docente1.id }, tokenEstudiante)).estado, 403);
  });

  it("lista todos los niveles del periodo activo, sin docente al inicio", async () => {
    const r = await pedir("/api/v1/level-teachers", { token: tokenDirector });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.periodo.id, periodoActivo.id);
    assert.equal(r.json.data.niveles.length, niveles.length);
    assert.ok(r.json.data.niveles.every((n) => n.docente === null && n.estudiantes === 0));
  });

  it("define el docente de un nivel y lo deja en la auditoría", async () => {
    const r = await definir(niveles[0].id, { docente_id: docente1.id });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.docente.id, docente1.id);
    assert.equal(r.json.data.nivel.id, niveles[0].id);
    const auditoria = firebase.estado.eventos.filter((e) => e.ruta === "auditoria" && e.accion === "DOCENTE_NIVEL_DEFINIDO");
    assert.equal(auditoria.length, 1);
  });

  it("un docente puede tener varios niveles", async () => {
    const r = await definir(niveles[1].id, { docente_id: docente1.id });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    const propios = (await pedir("/api/v1/level-teachers", { token: tokenDirector })).json.data.niveles.filter((n) => n.docente?.id === docente1.id);
    assert.equal(propios.length, 2);
  });

  it("repetir el mismo docente no cambia nada ni audita de nuevo", async () => {
    const antes = firebase.estado.eventos.filter((e) => e.accion === "DOCENTE_NIVEL_DEFINIDO").length;
    assert.equal((await definir(niveles[0].id, { docente_id: docente1.id })).estado, 200);
    assert.equal(firebase.estado.eventos.filter((e) => e.accion === "DOCENTE_NIVEL_DEFINIDO").length, antes);
  });

  it("cambiar el docente reemplaza al anterior: queda uno solo por nivel", async () => {
    const r = await definir(niveles[0].id, { docente_id: docente2.id });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal((await filaDe(niveles[0].id)).docente.id, docente2.id);
    const vigentes = await pool.query(
      "SELECT count(*)::int AS n FROM docentes_niveles WHERE nivel_practica_id = $1 AND eliminado_en IS NULL", [niveles[0].id]
    );
    assert.equal(vigentes.rows[0].n, 1);
  });

  it("rechaza como docente a quien no tiene ese rol o no existe", async () => {
    for (const id of [estudiante.id, asesor.id, "00000000-0000-4000-8000-000000000000"]) {
      const r = await definir(niveles[2].id, { docente_id: id });
      assert.equal(r.estado, 422, JSON.stringify(r.json));
      assert.equal(r.json.error.code, "TEACHER_INVALID");
    }
  });

  it("rechaza a un docente inactivo", async () => {
    await pool.query("UPDATE usuarios SET estado = 'INACTIVO' WHERE id = $1", [docente2.id]);
    const r = await definir(niveles[2].id, { docente_id: docente2.id });
    assert.equal(r.estado, 422);
    assert.equal(r.json.error.code, "TEACHER_INVALID");
    await pool.query("UPDATE usuarios SET estado = 'ACTIVO' WHERE id = $1", [docente2.id]);
  });

  it("valida el cuerpo y los identificadores", async () => {
    assert.equal((await definir(niveles[2].id, {})).estado, 400);
    assert.equal((await definir(niveles[2].id, { docente_id: "no-es-uuid" })).estado, 400);
    assert.equal((await definir("no-es-uuid", { docente_id: docente1.id })).estado, 400);
  });

  it("nivel inexistente responde 404 LEVEL_NOT_FOUND y periodo inexistente PERIOD_NOT_FOUND", async () => {
    const r = await definir("00000000-0000-4000-8000-000000000000", { docente_id: docente1.id });
    assert.equal(r.estado, 404);
    assert.equal(r.json.error.code, "LEVEL_NOT_FOUND");
    const p = await definir(niveles[2].id, { docente_id: docente1.id, periodo_id: "00000000-0000-4000-8000-000000000000" });
    assert.equal(p.estado, 404);
    assert.equal(p.json.error.code, "PERIOD_NOT_FOUND");
  });

  it("un periodo cerrado no se puede configurar", async () => {
    const cerrado = (await pool.query(
      `INSERT INTO periodos_academicos (codigo, nombre, fecha_inicio, fecha_fin, estado)
       VALUES ('2025-1', 'Periodo 2025-1', '2025-02-01', '2025-06-30', 'CERRADO') RETURNING id`
    )).rows[0].id;
    const r = await definir(niveles[2].id, { docente_id: docente1.id, periodo_id: cerrado });
    assert.equal(r.estado, 422);
    assert.equal(r.json.error.code, "PERIOD_CLOSED");
  });

  it("quitar al docente (docente_id null) deja el nivel libre y audita la baja", async () => {
    const r = await definir(niveles[1].id, { docente_id: null });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.docente, null);
    assert.equal(firebase.estado.eventos.filter((e) => e.accion === "DOCENTE_NIVEL_QUITADO").length, 1);
  });

  it("el listado cuenta solo estudiantes con práctica abierta (no borradores)", async () => {
    const matricula = (await pool.query("SELECT id FROM matriculas_estudiantes WHERE estudiante_id = $1", [estudiante.id])).rows[0].id;
    const fila = await pool.query(
      `INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, solicitada_por_id, estado)
       VALUES ($1, $2, $3, 'BORRADOR') RETURNING id`,
      [matricula, niveles[0].id, estudiante.id]
    );
    assert.equal((await filaDe(niveles[0].id)).estudiantes, 0);
    await pool.query("UPDATE asignaciones_practica SET estado = 'ENVIADA' WHERE id = $1", [fila.rows[0].id]);
    assert.equal((await filaDe(niveles[0].id)).estudiantes, 1);
  });
});

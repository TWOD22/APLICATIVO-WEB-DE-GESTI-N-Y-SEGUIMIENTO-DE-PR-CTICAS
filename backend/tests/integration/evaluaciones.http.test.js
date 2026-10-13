/**
 * Pruebas HTTP de evaluaciones: permisos, borrador, publicación independiente, reapertura y cierre de la práctica.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, prepararEscenario } from "../helpers/escenario.js";

/**
 * Pruebas HTTP de evaluaciones: contrato de respuestas, validación de entradas, autenticación y roles,
 * y el flujo completo (borrador → publicación → reapertura → cierre de la práctica).
 */
describe("API HTTP · evaluaciones y cierre de la práctica", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, servidor, base;
  let tokenDirector, tokenDocente, tokenDocente2, tokenAsesor, tokenEstudiante, tokenEstudiante2;
  let asignacion, evalDocente, evalAsesor;

  const pedir = async (ruta, { token, metodo = "GET", cuerpo } = {}) => {
    const respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: {
        ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await respuesta.text();
    return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
  };
  const codigo = (r) => r.json?.error?.code;

  before(async () => {
    esc = await prepararEscenario();
    const { crearApp } = await import("../../src/app.js");

    const estudiante = await esc.persona({ rol: "ESTUDIANTE", documento: "2200000001", nombres: "Laura", apellidos: "Aguilar", correo: "laura@udi.test", semestre: 1 });
    const estudiante2 = await esc.persona({ rol: "ESTUDIANTE", documento: "2200000002", nombres: "Mario", apellidos: "Rojas", correo: "mario@udi.test", semestre: 1 });
    const docente = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3200000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    const docente2 = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3200000002", nombres: "Sara", apellidos: "Torres", correo: "sara@udi.test" });
    const asesor = await esc.persona({ rol: "ASESOR_SITIO", documento: "4200000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: esc.inst.id });

    asignacion = await esc.crearAsignacion(estudiante, { docente_supervisor_id: docente.id, asesor_sitio_id: asesor.id });
    await esc.entregarBitacora(asignacion, estudiante);

    tokenDirector = esc.firebase.emitirToken("uid-director");
    tokenDocente = esc.firebase.emitirToken(docente.firebase_uid);
    tokenDocente2 = esc.firebase.emitirToken(docente2.firebase_uid);
    tokenAsesor = esc.firebase.emitirToken(asesor.firebase_uid);
    tokenEstudiante = esc.firebase.emitirToken(estudiante.firebase_uid);
    tokenEstudiante2 = esc.firebase.emitirToken(estudiante2.firebase_uid);

    servidor = crearApp().listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (esc?.cerrarPool) await esc.cerrarPool();
  });

  it("exige sesión y el rol correcto en cada ruta", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    assert.equal((await pedir("/api/v1/evaluations")).estado, 401);
    assert.equal((await pedir(`/api/v1/evaluations/${id}`)).estado, 401);
    assert.equal((await pedir(`/api/v1/evaluations/${id}/draft`, { metodo: "PUT", cuerpo: {} })).estado, 401);

    const borrador = { nota: 4 };
    for (const token of [tokenDirector, tokenEstudiante]) {
      assert.equal((await pedir(`/api/v1/evaluations/${id}/draft`, { token, metodo: "PUT", cuerpo: borrador })).estado, 403);
      assert.equal((await pedir(`/api/v1/evaluations/${id}/publish`, { token, metodo: "POST", cuerpo: {} })).estado, 403);
    }
    for (const token of [tokenDocente, tokenAsesor, tokenEstudiante]) {
      assert.equal((await pedir(`/api/v1/evaluations/${id}/reopen`, { token, metodo: "POST", cuerpo: { motivo: "No me corresponde" } })).estado, 403);
      assert.equal((await pedir(`/api/v1/practice-assignments/${asignacion.id}/finish`, { token, metodo: "POST" })).estado, 403);
    }
  });

  it("la cola responde con el contrato de listados y respeta el alcance de cada rol", async () => {
    const docente = await pedir("/api/v1/evaluations", { token: tokenDocente });
    assert.equal(docente.estado, 200, JSON.stringify(docente.json));
    assert.equal(docente.json.data.length, 1);
    assert.equal(docente.json.data[0].tipo, "DOCENTE_SUPERVISOR");
    assert.equal(docente.json.data[0].estado, "PENDIENTE");
    assert.equal(docente.json.data[0].asignacion.estudiante.nombre_completo, "Laura Aguilar");
    assert.equal(docente.json.meta.total, 1);
    assert.equal(docente.json.meta.page, 1);
    assert.deepEqual(docente.json.meta.resumen, { PENDIENTE: 1, BORRADOR: 0, PUBLICADA: 0 });
    assert.ok(docente.json.meta.request_id);
    evalDocente = docente.json.data[0].id;

    const asesor = await pedir("/api/v1/evaluations", { token: tokenAsesor });
    assert.deepEqual(asesor.json.data.map((f) => f.tipo), ["ASESOR_SITIO"]);
    evalAsesor = asesor.json.data[0].id;

    assert.equal((await pedir("/api/v1/evaluations", { token: tokenDocente2 })).json.data.length, 0);
    assert.equal((await pedir("/api/v1/evaluations", { token: tokenEstudiante })).json.data.length, 0);
    assert.equal((await pedir("/api/v1/evaluations", { token: tokenDirector })).json.data.length, 2);
    assert.equal((await pedir("/api/v1/evaluations?tipo=ASESOR_SITIO&estado=PENDIENTE", { token: tokenDirector })).json.data.length, 1);
  });

  it("valida los filtros y los identificadores", async () => {
    for (const ruta of ["/api/v1/evaluations?estado=NOPE", "/api/v1/evaluations?tipo=OTRO", "/api/v1/evaluations?page=0", "/api/v1/evaluations?periodo_id=abc", "/api/v1/evaluations/no-es-uuid"]) {
      const r = await pedir(ruta, { token: tokenDirector });
      assert.equal(r.estado, 400, ruta);
      assert.equal(codigo(r), "VALIDATION_ERROR");
    }
    assert.equal(codigo(await pedir("/api/v1/evaluations/00000000-0000-4000-8000-000000000000", { token: tokenDirector })), "EVALUATION_NOT_FOUND");
  });

  it("el detalle trae la entrega en solo lectura; un docente ajeno y el estudiante reciben 404", async () => {
    const r = await pedir(`/api/v1/evaluations/${evalDocente}`, { token: tokenDocente });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.evaluacion.editable, true);
    assert.equal(r.json.data.bitacora.estado, "ENVIADA");
    assert.match(r.json.data.bitacora.contenido.reflexion, /juego simbólico/);
    assert.equal((await pedir(`/api/v1/evaluations/${evalDocente}`, { token: tokenDocente2 })).estado, 404);
    assert.equal((await pedir(`/api/v1/evaluations/${evalDocente}`, { token: tokenAsesor })).estado, 404);
    assert.equal((await pedir(`/api/v1/evaluations/${evalDocente}`, { token: tokenEstudiante })).estado, 404);
    assert.equal((await pedir(`/api/v1/evaluations/${evalDocente}`, { token: tokenEstudiante2 })).estado, 404);
  });

  it("el borrador valida la nota (0 a 5, máximo dos decimales) y rechaza campos desconocidos", async () => {
    const ruta = `/api/v1/evaluations/${evalDocente}/draft`;
    for (const cuerpo of [{ nota: 5.5 }, { nota: -0.1 }, { nota: "4" }, { nota: 4.123 }, { nota: 4, extra: true }, { retroalimentacion: "x".repeat(3001) }]) {
      const r = await pedir(ruta, { token: tokenDocente, metodo: "PUT", cuerpo });
      assert.equal(r.estado, 400, JSON.stringify(cuerpo).slice(0, 60));
      assert.equal(codigo(r), "VALIDATION_ERROR");
    }
    const ok = await pedir(ruta, { token: tokenDocente, metodo: "PUT", cuerpo: { nota: 4.25, retroalimentacion: "  Buen trabajo  " } });
    assert.equal(ok.estado, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.data.evaluacion.estado, "BORRADOR");
    assert.equal(ok.json.data.evaluacion.nota, 4.25);
    assert.equal(ok.json.data.evaluacion.retroalimentacion, "Buen trabajo");
    // Un borrador puede estar vacío (sin nota): "" se guarda como ausencia
    const vacio = await pedir(ruta, { token: tokenDocente, metodo: "PUT", cuerpo: { nota: null, retroalimentacion: "" } });
    assert.equal(vacio.estado, 200);
    assert.equal(vacio.json.data.evaluacion.nota, null);
    assert.equal(vacio.json.data.evaluacion.retroalimentacion, null);
    // El asesor no puede tocar la evaluación del docente
    assert.equal((await pedir(ruta, { token: tokenAsesor, metodo: "PUT", cuerpo: { nota: 1 } })).estado, 404);
  });

  it("publicar exige nota y valida el cuerpo", async () => {
    const ruta = `/api/v1/evaluations/${evalDocente}/publish`;
    const sinNota = await pedir(ruta, { token: tokenDocente, metodo: "POST", cuerpo: {} });
    assert.equal(sinNota.estado, 422);
    assert.equal(codigo(sinNota), "GRADE_REQUIRED");
    for (const cuerpo of [{ nota: 6 }, { nota: null }, { promedio: 4 }]) {
      assert.equal((await pedir(ruta, { token: tokenDocente, metodo: "POST", cuerpo })).estado, 400, JSON.stringify(cuerpo));
    }
  });

  it("publica la evaluación del docente y la del asesor por separado; la bitácora queda EVALUADA", async () => {
    const d = await pedir(`/api/v1/evaluations/${evalDocente}/publish`, { token: tokenDocente, metodo: "POST", cuerpo: { nota: 4.5, retroalimentacion: "Excelente planeación" } });
    assert.equal(d.estado, 200, JSON.stringify(d.json));
    assert.equal(d.json.data.evaluacion.estado, "PUBLICADA");
    assert.equal(d.json.data.evaluacion.editable, false);

    const repetida = await pedir(`/api/v1/evaluations/${evalDocente}/publish`, { token: tokenDocente, metodo: "POST", cuerpo: { nota: 4.5 } });
    assert.equal(repetida.estado, 409);
    assert.equal(codigo(repetida), "EVALUATION_ALREADY_PUBLISHED");
    assert.equal(codigo(await pedir(`/api/v1/evaluations/${evalDocente}/draft`, { token: tokenDocente, metodo: "PUT", cuerpo: { nota: 1 } })), "EVALUATION_ALREADY_PUBLISHED");

    // El estudiante ya ve la del docente, pero no la del asesor (aún sin publicar)
    const antes = await pedir("/api/v1/evaluations", { token: tokenEstudiante });
    assert.deepEqual(antes.json.data.map((f) => [f.tipo, f.nota]), [["DOCENTE_SUPERVISOR", 4.5]]);
    assert.equal((await pedir(`/api/v1/evaluations/${evalAsesor}`, { token: tokenEstudiante })).estado, 404);
    assert.equal((await pedir(`/api/v1/practice-assignments/${asignacion.id}/finish`, { token: tokenDirector, metodo: "POST" })).estado, 422);

    const a = await pedir(`/api/v1/evaluations/${evalAsesor}/publish`, { token: tokenAsesor, metodo: "POST", cuerpo: { nota: 3.2 } });
    assert.equal(a.estado, 200, JSON.stringify(a.json));
    const despues = await pedir("/api/v1/evaluations", { token: tokenEstudiante });
    assert.deepEqual(despues.json.data.map((f) => [f.tipo, f.nota]).sort(), [["ASESOR_SITIO", 3.2], ["DOCENTE_SUPERVISOR", 4.5]]);
    assert.deepEqual(despues.json.meta.resumen, { PENDIENTE: 0, BORRADOR: 0, PUBLICADA: 2 });
    assert.ok(!JSON.stringify(despues.json).includes("promedio"));
    const bit = (await esc.pool.query("SELECT estado FROM bitacoras WHERE asignacion_practica_id = $1", [asignacion.id])).rows[0];
    assert.equal(bit.estado, "EVALUADA");
  });

  it("solo Dirección reabre, con motivo; el estudiante deja de ver la nota mientras tanto", async () => {
    const ruta = `/api/v1/evaluations/${evalDocente}/reopen`;
    const sinMotivo = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: {} });
    assert.equal(sinMotivo.estado, 400);
    assert.equal((await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { motivo: "ab" } })).estado, 400);

    const r = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { motivo: "Error al digitar la nota" } });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.evaluacion.estado, "BORRADOR");
    assert.equal(r.json.data.evaluacion.motivo_reapertura, "Error al digitar la nota");
    assert.deepEqual((await pedir("/api/v1/evaluations", { token: tokenEstudiante })).json.data.map((f) => f.tipo), ["ASESOR_SITIO"]);
    assert.equal(codigo(await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { motivo: "Otra vez" } })), "EVALUATION_NOT_PUBLISHED");

    const corregida = await pedir(`/api/v1/evaluations/${evalDocente}/publish`, { token: tokenDocente, metodo: "POST", cuerpo: { nota: 4.7 } });
    assert.equal(corregida.estado, 200, JSON.stringify(corregida.json));
    assert.equal(corregida.json.data.evaluacion.nota, 4.7);
  });

  it("Dirección finaliza la práctica una sola vez y después queda cerrada", async () => {
    const ruta = `/api/v1/practice-assignments/${asignacion.id}/finish`;
    assert.equal((await pedir("/api/v1/practice-assignments/no-es-uuid/finish", { token: tokenDirector, metodo: "POST" })).estado, 400);
    const r = await pedir(ruta, { token: tokenDirector, metodo: "POST" });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.estado, "FINALIZADA");
    assert.deepEqual(r.json.data.evaluaciones.map((e) => [e.tipo, e.nota]), [["DOCENTE_SUPERVISOR", 4.7], ["ASESOR_SITIO", 3.2]]);
    assert.ok(!JSON.stringify(r.json).includes("promedio"));

    assert.equal(codigo(await pedir(ruta, { token: tokenDirector, metodo: "POST" })), "ASSIGNMENT_ALREADY_FINISHED");
    assert.equal(codigo(await pedir(`/api/v1/evaluations/${evalDocente}/reopen`, { token: tokenDirector, metodo: "POST", cuerpo: { motivo: "Ya finalizó" } })), "PRACTICE_FINISHED");
    const asign = await pedir(`/api/v1/practice-assignments/${asignacion.id}`, { token: tokenDirector });
    assert.equal(asign.json.data.estado, "FINALIZADA");
  });
});

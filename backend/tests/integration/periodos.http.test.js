/**
 * Pruebas HTTP de ciclo de vida de los periodos: crear, activar (paso de semestre) y cerrar.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

describe("API HTTP · ciclo de vida de los periodos", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, servidor, base, firebase, inst, inst0, directorId, nuevos;
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
    inst0 = await pedir("/api/v1/institutions", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" },
    });
    asesor = await crear({ rol: "ASESOR_SITIO", documento: "4000000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: inst0.json.data.id });
    tokenDocente = docente1.token;
    tokenEstudiante = estudiante.token;
    niveles = (await pedir("/api/v1/practice-levels", { token: tokenDirector })).json.data;
    periodoActivo = (await pedir("/api/v1/periods", { token: tokenDirector })).json.data.find((p) => p.es_activo);
    inst = inst0.json.data.id;
    directorId = (await pool.query("SELECT id FROM usuarios WHERE firebase_uid = 'uid-director'")).rows[0].id;
    // Cuatro estudiantes en el periodo activo: uno termina el nivel, uno deja la solicitud abierta, uno en curso y uno del último semestre.
    nuevos = {};
    for (const [clave, doc, semestre] of [["finaliza", "2100000001", 1], ["solicitud", "2100000002", 1], ["encurso", "2100000003", 1], ["ultimo", "2100000004", 8]]) {
      nuevos[clave] = await crear({ rol: "ESTUDIANTE", documento: doc, nombres: clave, apellidos: "Prueba", correo: `${clave}@udi.test`, semestre });
    }
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (cerrarPool) await cerrarPool();
  });

  const asignar = async (usuarioId, estado, semestre) => {
    const m = (await pool.query("SELECT id FROM matriculas_estudiantes WHERE estudiante_id = $1 AND periodo_academico_id = $2", [usuarioId, periodoActivo.id])).rows[0];
    const n = (await pool.query("SELECT id FROM niveles_practica WHERE numero_semestre = $1", [semestre])).rows[0];
    await pool.query(
      `INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asignada_por_id, estado)
       VALUES ($1, $2, $3, $4, $5, $6)`, [m.id, n.id, inst, docente1.id, directorId, estado]);
  };
  const semestreEn = async (usuarioId, periodoId) =>
    (await pool.query("SELECT numero_semestre AS s FROM matriculas_estudiantes WHERE estudiante_id = $1 AND periodo_academico_id = $2", [usuarioId, periodoId])).rows[0]?.s;
  const nuevo = { codigo: "2027-1", nombre: "Primer periodo 2027", fecha_inicio: "2027-02-01", fecha_fin: "2027-06-15" };
  let periodoNuevo;

  it("solo el Director gestiona los periodos", async () => {
    assert.equal((await pedir("/api/v1/periods", { metodo: "POST", cuerpo: nuevo })).estado, 401);
    assert.equal((await pedir("/api/v1/periods", { token: tokenEstudiante, metodo: "POST", cuerpo: nuevo })).estado, 403);
    assert.equal((await pedir(`/api/v1/periods/${periodoActivo.id}/close`, { token: tokenDocente, metodo: "POST", cuerpo: {} })).estado, 403);
  });

  it("crea un periodo planificado y rechaza código repetido y fechas invertidas", async () => {
    const r = await pedir("/api/v1/periods", { token: tokenDirector, metodo: "POST", cuerpo: nuevo });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.data.estado, "PLANIFICADO");
    periodoNuevo = r.json.data;
    const repetido = await pedir("/api/v1/periods", { token: tokenDirector, metodo: "POST", cuerpo: nuevo });
    assert.equal(repetido.estado, 409);
    assert.equal(repetido.json.error.code, "PERIOD_CODE_EXISTS");
    const invertido = await pedir("/api/v1/periods", { token: tokenDirector, metodo: "POST", cuerpo: { ...nuevo, codigo: "2027-9", fecha_fin: "2027-01-01" } });
    assert.equal(invertido.estado, 422);
    assert.equal(invertido.json.error.code, "PERIOD_DATES_INVALID");
  });

  it("no activa otro periodo mientras haya uno activo", async () => {
    const r = await pedir(`/api/v1/periods/${periodoNuevo.id}/activate`, { token: tokenDirector, metodo: "POST", cuerpo: {} });
    assert.equal(r.estado, 422);
    assert.equal(r.json.error.code, "PERIOD_ACTIVE_EXISTS");
  });

  it("no cierra el periodo con prácticas en curso y explica qué falta", async () => {
    await definir(niveles[0].id, { docente_id: docente1.id });
    await asignar(nuevos.finaliza.id, "FINALIZADA", 1);
    await asignar(nuevos.solicitud.id, "ENVIADA", 1);
    await asignar(nuevos.encurso.id, "ACTIVA", 1);
    await asignar(nuevos.ultimo.id, "FINALIZADA", 8);
    const resumen = await pedir(`/api/v1/periods/${periodoActivo.id}/closing-summary`, { token: tokenDirector });
    assert.equal(resumen.estado, 200, JSON.stringify(resumen.json));
    assert.equal(resumen.json.data.practicas_en_marcha, 1);
    assert.equal(resumen.json.data.solicitudes_abiertas, 1);
    assert.equal(resumen.json.data.se_puede_cerrar, false);
    const r = await pedir(`/api/v1/periods/${periodoActivo.id}/close`, { token: tokenDirector, metodo: "POST", cuerpo: { confirmar: true } });
    assert.equal(r.estado, 422);
    assert.equal(r.json.error.code, "PERIOD_HAS_OPEN_PRACTICES");
  });

  it("pide confirmación por las solicitudes abiertas y, al confirmar, cancela y cierra", async () => {
    await pool.query("UPDATE asignaciones_practica SET estado = 'FINALIZADA' WHERE matricula_estudiante_id = (SELECT id FROM matriculas_estudiantes WHERE estudiante_id = $1)", [nuevos.encurso.id]);
    const sin = await pedir(`/api/v1/periods/${periodoActivo.id}/close`, { token: tokenDirector, metodo: "POST", cuerpo: {} });
    assert.equal(sin.estado, 409);
    assert.equal(sin.json.error.code, "CONFIRMATION_REQUIRED");
    const r = await pedir(`/api/v1/periods/${periodoActivo.id}/close`, { token: tokenDirector, metodo: "POST", cuerpo: { confirmar: true } });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.periodo.estado, "CERRADO");
    assert.equal(r.json.data.solicitudes_canceladas, 1);
    assert.equal(r.json.data.matriculas_finalizadas, 5);
    const estado = (await pool.query("SELECT estado FROM asignaciones_practica WHERE matricula_estudiante_id = (SELECT id FROM matriculas_estudiantes WHERE estudiante_id = $1)", [nuevos.solicitud.id])).rows[0].estado;
    assert.equal(estado, "CANCELADA");
    const otra = await pedir(`/api/v1/periods/${periodoActivo.id}/close`, { token: tokenDirector, metodo: "POST", cuerpo: {} });
    assert.equal(otra.estado, 422);
    assert.ok(firebase.estado.eventos.some((e) => e.accion === "PERIODO_CERRADO"));
  });

  it("al activar el nuevo periodo matricula a quienes continúan con paso de semestre y copia docentes", async () => {
    const r = await pedir(`/api/v1/periods/${periodoNuevo.id}/activate`, { token: tokenDirector, metodo: "POST", cuerpo: {} });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.periodo.estado, "ACTIVO");
    const p = r.json.data.preparacion;
    assert.equal(p.periodo_anterior, periodoActivo.codigo);
    assert.equal(p.matriculados, 4);
    assert.equal(p.egresados, 1);
    assert.equal(p.docentes_copiados, 1);
    assert.equal(await semestreEn(nuevos.finaliza.id, periodoNuevo.id), 2);
    assert.equal(await semestreEn(nuevos.encurso.id, periodoNuevo.id), 2);
    assert.equal(await semestreEn(nuevos.solicitud.id, periodoNuevo.id), 1); // no terminó: repite el semestre
    assert.equal(await semestreEn(nuevos.ultimo.id, periodoNuevo.id), undefined); // terminó el programa
    const docentes = (await pedir(`/api/v1/level-teachers?periodo_id=${periodoNuevo.id}`, { token: tokenDirector })).json.data.niveles;
    assert.equal(docentes.find((n) => n.nivel.id === niveles[0].id).docente.id, docente1.id);
    assert.equal((await pedir("/api/v1/periods", { token: tokenDirector })).json.data.find((x) => x.es_activo).id, periodoNuevo.id);
  });

  it("no vuelve a activar un periodo ya activo ni uno cerrado", async () => {
    const activo = await pedir(`/api/v1/periods/${periodoNuevo.id}/activate`, { token: tokenDirector, metodo: "POST", cuerpo: {} });
    assert.equal(activo.estado, 422);
    const cerrado = await pedir(`/api/v1/periods/${periodoActivo.id}/activate`, { token: tokenDirector, metodo: "POST", cuerpo: {} });
    assert.equal(cerrado.estado, 422);
    assert.equal(cerrado.json.error.code, "PERIOD_STATE_INVALID");
  });
});

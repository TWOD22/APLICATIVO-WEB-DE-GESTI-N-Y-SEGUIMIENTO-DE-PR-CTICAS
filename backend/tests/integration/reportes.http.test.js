/**
 * Pruebas HTTP de reportes de gestión (MEN/CNA): resumen, detalle CSV e informe PDF.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

describe("API HTTP · reportes de gestión", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
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
    for (const [clave, doc, semestre] of [["finaliza", "2100000001", 1], ["solicitud", "2100000002", 1], ["encurso", "2100000003", 1]]) {
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
  const textoDe = async (ruta, token) => {
    const r = await fetch(`${base}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { estado: r.status, tipo: r.headers.get("content-type"), cuerpo: Buffer.from(await r.arrayBuffer()) };
  };

  before(async () => {
    await definir(niveles[0].id, { docente_id: docente1.id });
    await asignar(nuevos.finaliza.id, "FINALIZADA", 1);
    await asignar(nuevos.solicitud.id, "ENVIADA", 1);
    await asignar(nuevos.encurso.id, "ACTIVA", 1);
    const a = (await pool.query("SELECT a.id FROM asignaciones_practica a JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id WHERE m.estudiante_id = $1", [nuevos.finaliza.id])).rows[0].id;
    for (const [tipo, evaluador, nota] of [["DOCENTE_SUPERVISOR", docente1.id, 4.5], ["ASESOR_SITIO", asesor.id, 3.5]]) {
      await pool.query("INSERT INTO evaluaciones (asignacion_practica_id, evaluador_id, tipo_evaluador, nota, estado, publicada_en) VALUES ($1, $2, $3, $4, 'PUBLICADA', now())", [a, evaluador, tipo, nota]);
    }
  });

  it("solo el Director consulta los reportes", async () => {
    assert.equal((await pedir("/api/v1/reports/summary")).estado, 401);
    assert.equal((await pedir("/api/v1/reports/summary", { token: tokenDocente })).estado, 403);
    assert.equal((await pedir("/api/v1/reports/summary", { token: tokenEstudiante })).estado, 403);
    assert.equal((await textoDe("/api/v1/reports/practices.csv", tokenEstudiante)).estado, 403);
  });

  it("el resumen cuenta cobertura, estados, niveles y notas por separado", async () => {
    const r = await pedir("/api/v1/reports/summary", { token: tokenDirector });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    const d = r.json.data;
    assert.equal(d.periodo.id, periodoActivo.id);
    assert.equal(d.cobertura.estudiantes_matriculados, 4); // Laura + los tres de la prueba
    assert.equal(d.cobertura.con_practica, 2); // finalizada + en curso
    assert.equal(d.cobertura.solicitudes_en_tramite, 1);
    assert.equal(d.cobertura.porcentaje_con_practica, 50);
    assert.equal(d.finalizacion.finalizadas, 1);
    assert.equal(d.finalizacion.porcentaje_finalizadas, 50);
    const n1 = d.por_nivel.find((n) => n.id === niveles[0].id);
    assert.equal(n1.estudiantes, 2);
    assert.equal(n1.finalizadas, 1);
    assert.equal(d.evaluaciones.docente.promedio, 4.5);
    assert.equal(d.evaluaciones.asesor.promedio, 3.5);
    assert.equal(d.evaluaciones.docente.publicadas, 1);
    assert.equal(d.evaluaciones.asesor.por_debajo_de_3, 0);
    assert.equal(d.evaluadores.length, 2);
    assert.equal(d.instituciones[0].estudiantes, 2);
  });

  it("acepta un periodo concreto y rechaza uno inexistente", async () => {
    assert.equal((await pedir(`/api/v1/reports/summary?periodo_id=${periodoActivo.id}`, { token: tokenDirector })).estado, 200);
    assert.equal((await pedir("/api/v1/reports/summary?periodo_id=no-es-uuid", { token: tokenDirector })).estado, 400);
    assert.equal((await pedir("/api/v1/reports/summary?periodo_id=11111111-1111-4111-8111-111111111111", { token: tokenDirector })).estado, 404);
  });

  it("el CSV trae una fila por práctica, con notas separadas, y queda en la auditoría", async () => {
    const r = await textoDe("/api/v1/reports/practices.csv", tokenDirector);
    assert.equal(r.estado, 200);
    assert.match(r.tipo, /text\/csv/);
    const texto = r.cuerpo.toString("utf8");
    assert.ok(texto.startsWith("\uFEFF"), "lleva BOM para Excel");
    const lineas = texto.trim().split("\r\n");
    assert.equal(lineas.length, 3); // encabezado + finalizada + en curso
    assert.match(lineas[0], /Nota docente;Nota asesor$/);
    const fila = lineas.find((l) => l.includes("2100000001"));
    assert.ok(fila.endsWith(";4.5;3.5"), fila);
    assert.ok(!texto.includes("2100000002"), "la solicitud aún no iniciada no es una práctica");
    assert.ok(firebase.estado.eventos.some((e) => e.accion === "REPORTE_EXPORTADO"));
  });

  it("el informe PDF se genera", async () => {
    const r = await textoDe("/api/v1/reports/summary.pdf", tokenDirector);
    assert.equal(r.estado, 200);
    assert.equal(r.tipo, "application/pdf");
    assert.equal(r.cuerpo.subarray(0, 5).toString(), "%PDF-");
  });
});

/**
 * Pruebas de los dashboards por rol: indicadores, tabla de seguimiento y alcance de datos.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, pdfDistinto, prepararEscenario, rechaza } from "../helpers/escenario.js";

/**
 * Dashboards por rol: indicadores y alertas del Director, indicadores de docente y asesor, y la tabla de seguimiento
 * con lo que cada rol puede ver. Datos: 6 prácticas del periodo activo en distintas etapas.
 */
describe("Dashboards por rol", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, dashboard, evaluaciones, documentos, servidor, base;
  let laura, mario, nora, sofia, pablo, rita, juan, sara, ana, luis;
  let tokenDirector, tokenLaura, tokenJuan, tokenAna;

  const E = (u) => esc.como("ESTUDIANTE", u);
  const D = (u) => esc.como("DOCENTE_SUPERVISOR", u);
  const A = (u) => esc.como("ASESOR_SITIO", u);
  const DIR = () => esc.director();
  const practicas = (auth, extra = {}) => dashboard.listarPracticas({ limit: 50, offset: 0, ...extra }, auth);
  const fila = async (auth, estudiante, extra) => (await practicas(auth, extra)).filas.find((f) => f.estudiante.id === estudiante.id);
  const idEval = async (asignacion, tipo) =>
    (await evaluaciones.listar({ limit: 10, offset: 0, asignacion_id: asignacion.id, tipo }, DIR())).filas[0].id;
  const pedir = async (ruta, token) => {
    const r = await fetch(`${base}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const texto = await r.text();
    return { estado: r.status, json: texto ? JSON.parse(texto) : null };
  };

  before(async () => {
    esc = await prepararEscenario();
    dashboard = await import("../../src/services/dashboardService.js");
    evaluaciones = await import("../../src/services/evaluationService.js");
    documentos = await import("../../src/services/documentService.js");
    const { crearApp } = await import("../../src/app.js");

    const estudiante = (n, nombres, apellidos) =>
      esc.persona({ rol: "ESTUDIANTE", documento: `220000000${n}`, nombres, apellidos, correo: `est${n}@udi.test`, semestre: 1 });
    laura = await estudiante(1, "Laura", "Aguilar");
    mario = await estudiante(2, "Mario", "Bravo");
    nora = await estudiante(3, "Nora", "Castro");
    sofia = await estudiante(4, "Sofía", "Duarte");
    pablo = await estudiante(5, "Pablo", "Escobar");
    rita = await estudiante(6, "Rita", "Fonseca");
    juan = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3200000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    sara = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3200000002", nombres: "Sara", apellidos: "Torres", correo: "sara@udi.test" });
    ana = await esc.persona({ rol: "ASESOR_SITIO", documento: "4200000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: esc.inst.id });
    luis = await esc.persona({ rol: "ASESOR_SITIO", documento: "4200000002", nombres: "Luis", apellidos: "Mora", correo: "luis@jardin2.test", institucion_id: esc.inst2.id });

    const deJuan = { docente_supervisor_id: juan.id, asesor_sitio_id: ana.id };
    const ajLaura = await esc.crearAsignacion(laura, deJuan);
    const ajMario = await esc.crearAsignacion(mario, deJuan);
    const ajNora = await esc.crearAsignacion(nora, deJuan);
    const ajSofia = await esc.crearAsignacion(sofia, { institucion_id: esc.inst2.id, docente_supervisor_id: sara.id, asesor_sitio_id: luis.id });
    await esc.crearAsignacion(pablo); // sin docente ni asesor
    const ajRita = await esc.crearAsignacion(rita, { docente_supervisor_id: sara.id }); // sin asesor

    await esc.entregarBitacora(ajLaura, laura);
    await esc.entregarBitacora(ajMario, mario);
    await esc.entregarBitacora(ajSofia, sofia);
    await esc.habilitarBitacora(ajNora, nora); // habilitada, sin enviar
    await (await import("../../src/services/logbookService.js")).obtenerDeAsignacion(ajNora.id, E(nora)); // la abre: nace en BORRADOR
    await documentos.subir(
      { asignacionId: ajRita.id, tipoId: esc.tipos.CEDULA, contenido: pdfDistinto("rita"), tipoMime: "application/pdf", nombreArchivo: "cedula.pdf" },
      E(rita), esc.ctxDe(rita, "ESTUDIANTE")
    );
    await esc.pool.query(
      "INSERT INTO instituciones (nombre, nit, ciudad, correo, estado_convenio) VALUES ('Jardín Tres', '900111222-3', 'Girón', 'tres@jardin.test', 'EN_TRAMITE')"
    );

    // Laura: docente publicó 4.5 y el asesor dejó un borrador. Mario y Sofía: todo pendiente.
    await evaluaciones.publicar(await idEval(ajLaura, "DOCENTE_SUPERVISOR"), { nota: 4.5, retroalimentacion: "Muy bien" }, D(juan), esc.ctxDe(juan, "DOCENTE_SUPERVISOR"));
    await evaluaciones.guardarBorrador(await idEval(ajLaura, "ASESOR_SITIO"), { nota: 2.5, retroalimentacion: "borrador" }, A(ana));

    tokenDirector = esc.firebase.emitirToken("uid-director");
    tokenLaura = esc.firebase.emitirToken(laura.firebase_uid);
    tokenJuan = esc.firebase.emitirToken(juan.firebase_uid);
    tokenAna = esc.firebase.emitirToken(ana.firebase_uid);
    servidor = crearApp().listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (esc?.cerrarPool) await esc.cerrarPool();
  });

  describe("indicadores", () => {
    it("Director: métricas del periodo activo y alertas de acción", async () => {
      const r = await dashboard.resumen({}, DIR());
      assert.equal(r.rol, "DIRECTOR_PROGRAMA");
      assert.ok(r.periodo?.id && r.periodo.estado === "ACTIVO");
      assert.deepEqual(r.indicadores, {
        practicas_activas: 6, practicas_finalizadas: 0, expedientes_completos: 4,
        evaluaciones_pendientes: 5, evaluaciones_publicadas: 1, instituciones_activas: 3,
      });
      assert.deepEqual(r.alertas, {
        expedientes_por_auditar: 1, expedientes_por_corregir: 0,
        practicas_sin_docente: 1, practicas_sin_asesor: 1, convenios_en_tramite: 1,
      });
    });

    it("Docente: solo sus estudiantes y su evaluación", async () => {
      const r = await dashboard.resumen({}, D(juan));
      assert.deepEqual(r.indicadores, { estudiantes: 3, en_desarrollo: 1, pendientes: 1, en_borrador: 0, evaluados: 1 });
      const otra = await dashboard.resumen({}, D(sara));
      assert.deepEqual(otra.indicadores, { estudiantes: 2, en_desarrollo: 1, pendientes: 1, en_borrador: 0, evaluados: 0 });
    });

    it("Asesor: solo su institución y su propia evaluación (el borrador cuenta como borrador)", async () => {
      const r = await dashboard.resumen({}, A(ana));
      assert.deepEqual(r.indicadores, { estudiantes: 3, en_desarrollo: 1, pendientes: 1, en_borrador: 1, evaluados: 0 });
      assert.deepEqual((await dashboard.resumen({}, A(luis))).indicadores, { estudiantes: 1, en_desarrollo: 0, pendientes: 1, en_borrador: 0, evaluados: 0 });
    });

    it("Estudiante: su práctica del periodo, o null si no tiene", async () => {
      const r = await dashboard.resumen({}, E(laura));
      assert.equal(r.practica.estudiante.id, laura.id);
      assert.equal(r.practica.evaluacion_global, "PARCIAL");
      assert.equal(r.indicadores, undefined);
    });

    it("periodo inexistente: 404; periodo explícito: se respeta", async () => {
      await rechaza(dashboard.resumen({ periodo_id: "00000000-0000-4000-8000-000000000000" }, DIR()), { estado: 404, codigo: "PERIOD_NOT_FOUND" });
      const activo = (await dashboard.resumen({}, DIR())).periodo.id;
      assert.equal((await dashboard.resumen({ periodo_id: activo }, DIR())).indicadores.practicas_activas, 6);
    });
  });

  describe("tabla de seguimiento", () => {
    it("Director: ve las 6 prácticas con expediente, bitácora y las dos evaluaciones", async () => {
      const r = await practicas(DIR());
      assert.equal(r.total, 6);
      assert.deepEqual(r.filas.map((f) => f.estudiante.nombres), ["Laura", "Mario", "Nora", "Sofía", "Pablo", "Rita"]);

      const l = await fila(DIR(), laura);
      assert.equal(l.evaluacion_global, "PARCIAL");
      assert.equal(l.evaluaciones.docente.estado, "PUBLICADA");
      assert.equal(l.evaluaciones.docente.nota, 4.5);
      assert.equal(l.evaluaciones.asesor.estado, "BORRADOR");
      assert.equal(l.evaluaciones.asesor.nota, null, "la nota de un borrador no se muestra");
      assert.equal(l.documentos.estado, "COMPLETO");
      assert.equal(l.documentos.aprobados, l.documentos.total);
      assert.equal(l.bitacora.estado, "EN_EVALUACION");
      assert.equal(l.docente.nombre_completo, "Juan Suárez");

      assert.equal((await fila(DIR(), mario)).evaluacion_global, "PENDIENTE");
      const n = await fila(DIR(), nora);
      assert.equal(n.evaluacion_global, "SIN_ENTREGA");
      assert.equal(n.bitacora.estado, "BORRADOR");
      assert.equal(n.evaluaciones.docente, null);
      assert.equal((await fila(DIR(), rita)).documentos.estado, "EN_REVISION");
      const p = await fila(DIR(), pablo);
      assert.equal(p.documentos.estado, "INCOMPLETO");
      assert.equal(p.completitud, "SIN_DOCENTE");
      assert.equal(p.bitacora, null);
    });

    it("Estudiante: sus propias evaluaciones y solo lo publicado; lo demás figura como pendiente", async () => {
      const r = await practicas(E(laura));
      assert.equal(r.total, 1);
      const f = r.filas[0];
      assert.equal(f.evaluaciones.docente.nota, 4.5);
      assert.equal(f.evaluaciones.asesor.estado, "PENDIENTE", "el borrador del asesor es invisible para el estudiante");
      assert.equal(f.evaluaciones.asesor.nota, null);
      assert.equal(f.mi_evaluacion, undefined);
      assert.equal((await practicas(E(mario))).filas[0].estudiante.id, mario.id);
    });

    it("Docente: solo sus estudiantes, sin expediente ni la evaluación del asesor", async () => {
      const r = await practicas(D(juan));
      assert.equal(r.total, 3);
      assert.ok(r.filas.every((f) => f.documentos === undefined && f.evaluaciones === undefined && f.evaluacion_global === undefined));
      const l = await fila(D(juan), laura);
      assert.deepEqual(l.mi_evaluacion, { estado: "PUBLICADA", nota: 4.5, publicada_en: l.mi_evaluacion.publicada_en });
      assert.equal((await fila(D(juan), mario)).mi_evaluacion.estado, "PENDIENTE");
      const n = await fila(D(juan), nora);
      assert.equal(n.mi_evaluacion.estado, "SIN_ENTREGA");
      assert.equal(n.bitacora.estado, "EN_DESARROLLO", "el docente solo ve que la bitácora sigue en desarrollo");
      assert.equal(n.bitacora.id, null);
      assert.equal(await fila(D(juan), sofia), undefined);
    });

    it("Asesor: ve su propia evaluación (borrador sin nota) y nunca la del docente", async () => {
      const r = await practicas(A(ana));
      assert.equal(r.total, 3);
      const l = await fila(A(ana), laura);
      assert.equal(l.mi_evaluacion.estado, "BORRADOR");
      assert.equal(l.mi_evaluacion.nota, null);
      assert.ok(!JSON.stringify(l).includes("4.5"), "la nota del docente no aparece en la fila del asesor");
      assert.equal(await fila(A(ana), sofia), undefined);
      assert.equal((await practicas(A(luis))).total, 1);
    });

    it("filtra por texto y estado, y pagina", async () => {
      assert.deepEqual((await practicas(DIR(), { q: "bravo" })).filas.map((f) => f.estudiante.nombres), ["Mario"]);
      assert.equal((await practicas(DIR(), { q: "Jardín Dos" })).total, 1);
      assert.equal((await practicas(DIR(), { estado: "FINALIZADA" })).total, 0);
      assert.equal((await practicas(DIR(), { estado: "PENDIENTE_DOCUMENTOS" })).total, 2); // Pablo y Rita
      const pagina = await practicas(DIR(), { limit: 2, offset: 2 });
      assert.equal(pagina.total, 6);
      assert.deepEqual(pagina.filas.map((f) => f.estudiante.nombres), ["Nora", "Sofía"]);
    });

    it("sin periodo activo ni indicado trabaja sobre todos; todos_los_periodos ignora el filtro", async () => {
      const todos = await dashboard.listarPracticas({ todos_los_periodos: true, limit: 50, offset: 0 }, DIR());
      assert.equal(todos.total, 6);
      assert.equal(todos.periodo, null);
      await rechaza(practicas(DIR(), { periodo_id: "00000000-0000-4000-8000-000000000000" }), { estado: 404, codigo: "PERIOD_NOT_FOUND" });
    });
  });

  describe("HTTP", () => {
    it("exige sesión y valida la consulta", async () => {
      assert.equal((await pedir("/api/v1/dashboard")).estado, 401);
      assert.equal((await pedir("/api/v1/dashboard/practices")).estado, 401);
      assert.equal((await pedir("/api/v1/dashboard?periodo_id=x", tokenDirector)).estado, 400);
      assert.equal((await pedir("/api/v1/dashboard/practices?estado=NOPE", tokenDirector)).estado, 400);
      assert.equal((await pedir("/api/v1/dashboard/practices?page=0", tokenDirector)).estado, 400);
    });

    it("cumple el contrato de respuestas por rol", async () => {
      const dir = await pedir("/api/v1/dashboard", tokenDirector);
      assert.equal(dir.estado, 200);
      assert.equal(dir.json.data.indicadores.practicas_activas, 6);
      assert.ok(dir.json.meta.request_id);

      const lista = await pedir("/api/v1/dashboard/practices?page=1&page_size=4", tokenDirector);
      assert.equal(lista.estado, 200);
      assert.equal(lista.json.data.length, 4);
      assert.equal(lista.json.meta.total, 6);
      assert.equal(lista.json.meta.total_pages, 2);
      assert.equal(lista.json.meta.periodo.estado, "ACTIVO");

      assert.equal((await pedir("/api/v1/dashboard", tokenJuan)).json.data.indicadores.estudiantes, 3);
      assert.equal((await pedir("/api/v1/dashboard", tokenAna)).json.data.indicadores.en_borrador, 1);
      const est = await pedir("/api/v1/dashboard/practices", tokenLaura);
      assert.equal(est.json.meta.total, 1);
      assert.equal(est.json.data[0].evaluaciones.asesor.estado, "PENDIENTE");
    });
  });
});

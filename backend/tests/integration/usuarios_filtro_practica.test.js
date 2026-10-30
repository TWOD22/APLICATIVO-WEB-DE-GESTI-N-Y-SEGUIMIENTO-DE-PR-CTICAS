/**
 * Filtro «situación de práctica» en la gestión de usuarios y grupos de etapas en el seguimiento de prácticas.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, prepararEscenario } from "../helpers/escenario.js";

describe("Usuarios por situación de práctica y seguimiento por etapas", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, users, dashboard, sin, enTramite, enPractica, docente, asesor;
  const lista = (filtros) => users.listar({ limit: 50, offset: 0, ...filtros });

  before(async () => {
    esc = await prepararEscenario();
    users = await import("../../src/services/userService.js");
    dashboard = await import("../../src/services/dashboardService.js");
    const nuevo = (n, extra = {}) => esc.persona({ rol: "ESTUDIANTE", documento: `30000000${n}`, nombres: `Est${n}`, apellidos: `Prueba${n}`, correo: `est${n}@udi.test`, semestre: 1, ...extra });
    sin = await nuevo(1);
    enTramite = await nuevo(2);
    enPractica = await nuevo(3);
    docente = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "4000000001", nombres: "Doc", apellidos: "Ente", correo: "doc@udi.test" });
    asesor = await esc.persona({ rol: "ASESOR_SITIO", documento: "5000000001", nombres: "Ase", apellidos: "Sor", correo: "ase@jardin.test", institucion_id: esc.inst.id });
    await esc.docenteDeNivel(docente, esc.niveles[1]);
    await esc.crearAsignacion(enTramite, { docente_supervisor_id: docente.id, asesor_sitio_id: asesor.id });
    const activa = await esc.crearAsignacion(enPractica, { docente_supervisor_id: docente.id, asesor_sitio_id: asesor.id });
    await esc.habilitarBitacora(activa, enPractica);
  });
  after(async () => { await esc.cerrarPool(); });

  it("cada estudiante trae su situación y el filtro separa las cuatro etapas", async () => {
    const todos = await lista({ rol: "ESTUDIANTE" });
    const de = (u) => todos.filas.find((f) => f.id === u.id);
    assert.equal(de(sin).practica_estado, "SIN_SOLICITUD");
    assert.equal(de(sin).practica_nivel, null);
    assert.equal(de(enTramite).practica_estado, "SOLICITUD");
    assert.equal(de(enPractica).practica_estado, "EN_PRACTICA");
    assert.equal(de(enPractica).practica_nivel, "PP1");

    assert.deepEqual((await lista({ practica: "SIN_SOLICITUD" })).filas.map((f) => f.id), [sin.id]);
    assert.deepEqual((await lista({ practica: "SOLICITUD" })).filas.map((f) => f.id), [enTramite.id]);
    assert.deepEqual((await lista({ practica: "EN_PRACTICA" })).filas.map((f) => f.id), [enPractica.id]);
    assert.equal((await lista({ practica: "FINALIZADA" })).total, 0);
    assert.equal((await lista({ practica: "EN_PRACTICA", semestre: 2 })).total, 0, "los filtros se combinan");
  });

  it("quien no es estudiante no tiene situación de práctica", async () => {
    const d = (await lista({ rol: "DOCENTE_SUPERVISOR" })).filas.find((f) => f.id === docente.id);
    assert.equal(d.practica_estado, null);
  });

  it("el seguimiento muestra solo prácticas iniciadas y se puede filtrar por etapa y nivel", async () => {
    const director = esc.director();
    const marcha = await dashboard.listarPracticas({ limit: 50, offset: 0, grupo: "EN_MARCHA" }, director);
    assert.deepEqual(marcha.filas.map((f) => f.estudiante.id), [enPractica.id]);
    assert.equal((await dashboard.listarPracticas({ limit: 50, offset: 0 }, director)).total, 2, "sin grupo se ven también las solicitudes");
    assert.equal((await dashboard.listarPracticas({ limit: 50, offset: 0, grupo: "EN_EVALUACION" }, director)).total, 0);
    assert.equal((await dashboard.listarPracticas({ limit: 50, offset: 0, grupo: "EN_MARCHA", nivel_practica_id: esc.niveles[1] }, director)).total, 1);
    assert.equal((await dashboard.listarPracticas({ limit: 50, offset: 0, grupo: "EN_MARCHA", nivel_practica_id: esc.niveles[2] }, director)).total, 0);
  });

  it("«estudiantes sin solicitud» del tablero = filtro «aún no envían solicitud» de Usuarios", async () => {
    const tablero = await dashboard.acciones({}, esc.director());
    const tarjeta = tablero.tarjetas.find((t) => t.codigo === "ESTUDIANTES_SIN_SOLICITUD");
    const lista = await users.listar({ rol: "ESTUDIANTE", practica: "SIN_SOLICITUD", limit: 50, offset: 0 });
    assert.equal(tarjeta.total, lista.total);
    assert.deepEqual(tarjeta.destino.filtro, { rol: "ESTUDIANTE", practica: "SIN_SOLICITUD" });
  });

  it("«Prácticas activas» y «en evaluación» del resumen = lo que lista Seguimiento", async () => {
    const director = esc.director();
    const resumen = await dashboard.resumen({}, director);
    const vigentes = await dashboard.listarPracticas({ limit: 50, offset: 0, grupo: "VIGENTES" }, director);
    const evaluacion = await dashboard.listarPracticas({ limit: 50, offset: 0, grupo: "EN_EVALUACION" }, director);
    assert.equal(resumen.indicadores.practicas_activas, vigentes.total);
    assert.equal(resumen.indicadores.practicas_en_evaluacion, evaluacion.total);
  });
});

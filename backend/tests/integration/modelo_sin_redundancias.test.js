/**
 * Pruebas de la migración 15 (modelo sin rutas dobles): ya no existe usuarios_programas, el detalle de usuario sigue mostrando
 * el programa y una evaluación solo puede ligarse a una bitácora de su propia asignación.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, prepararEscenario } from "../helpers/escenario.js";

describe("modelo sin redundancias + PostgreSQL real", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, usuarios, docente, est1, est2, a1, a2;
  const filas = async (sql, parametros = []) => (await esc.pool.query(sql, parametros)).rows;

  before(async () => {
    esc = await prepararEscenario();
    usuarios = await import("../../src/services/userService.js");
    est1 = await esc.persona({ rol: "ESTUDIANTE", documento: "2200000001", nombres: "Eva", apellidos: "Uno", correo: "eva1@udi.test", semestre: 1 });
    est2 = await esc.persona({ rol: "ESTUDIANTE", documento: "2200000002", nombres: "Eli", apellidos: "Dos", correo: "eli2@udi.test", semestre: 1 });
    docente = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3200000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    const asesor = await esc.persona({ rol: "ASESOR_SITIO", documento: "4200000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: esc.inst.id });
    const completa = { docente_supervisor_id: docente.id, asesor_sitio_id: asesor.id };
    a1 = await esc.crearAsignacion(est1, completa);
    a2 = await esc.crearAsignacion(est2, completa);
    await esc.entregarBitacora(a1, est1);
    await esc.entregarBitacora(a2, est2);
  });
  after(async () => esc?.cerrarPool());

  it("la tabla usuarios_programas ya no existe", async () => {
    const [{ existe }] = await filas("SELECT to_regclass('public.usuarios_programas') IS NOT NULL AS existe");
    assert.equal(existe, false);
  });

  it("el detalle de un estudiante muestra su programa por la matrícula; el del personal no lista programas", async () => {
    const e = await usuarios.obtenerDetalle(est1.id);
    assert.equal(e.programas.length, 1);
    assert.equal(e.programas[0].codigo, "LEI");
    assert.equal(e.matricula_actual.programa_id, e.programas[0].id);
    const d = await usuarios.obtenerDetalle(docente.id);
    assert.deepEqual(d.programas, []);
  });

  it("la evaluación ya no repite la bitácora: llega a ella por su asignación (sin ciclo asignación-bitácora-evaluación)", async () => {
    const cols = await filas("SELECT column_name FROM information_schema.columns WHERE table_name = 'evaluaciones' AND column_name = 'bitacora_id'");
    assert.equal(cols.length, 0);
    const filasEval = await filas(
      "SELECT ev.id, b.id AS bitacora_id FROM evaluaciones ev JOIN bitacoras b ON b.asignacion_practica_id = ev.asignacion_practica_id WHERE ev.asignacion_practica_id = $1", [a1.id]);
    assert.ok(filasEval.length >= 1 && filasEval.every((f) => f.bitacora_id), "cada evaluación encuentra su bitácora por la asignación");
  });
});

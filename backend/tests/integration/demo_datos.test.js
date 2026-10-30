/**
 * Pruebas del generador de datos de demostración: crea el escenario completo con PostgreSQL real y Firebase/almacenamiento
 * falsos, verifica lo que verá el Director y comprueba que la limpieza deja la base como estaba.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

describe("Datos de demostración", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, sembrarDemo, limpiarDemo, firebase, resultado;
  const almacen = new Map();
  const cuenta = async (sql, params = []) => Number((await pool.query(sql, params)).rows[0].n);

  before(async () => {
    ({ pool, cerrarPool } = await import("../../src/config/database.js"));
    const { ejecutarSeedBase } = await import("../../src/database/seeds/base.js");
    const { sustituirFirebaseParaPruebas } = await import("../../src/config/firebase.js");
    const { sustituirAlmacenamientoParaPruebas } = await import("../../src/adapters/storageAdapter.js");
    ({ sembrarDemo, limpiarDemo } = await import("../../src/demo/sembrarDemo.js"));
    firebase = crearFirebaseFalso();
    sustituirFirebaseParaPruebas(firebase.implementacion);
    sustituirAlmacenamientoParaPruebas({
      subirArchivo: async ({ ruta, contenido }) => { almacen.set(ruta, contenido); return { bucket: "bucket-test", ruta }; },
      crearUrlFirmada: async (ruta, { segundos }) => ({ url: `https://storage.test/${ruta}`, expira_en_segundos: segundos }),
      eliminarArchivo: async (ruta) => { almacen.delete(ruta); },
      descargarArchivo: async (ruta) => almacen.get(ruta),
      almacenamientoDisponible: async () => true,
    });
    await reconstruirEsquema(pool);
    await limpiarYSembrar(pool, ejecutarSeedBase, {
      director: { firebase_uid: "uid-director", documento: "10203040", nombres: "Dora", apellidos: "Directora", correo: "director@udi.test" },
    });
  });
  after(async () => { if (cerrarPool) await cerrarPool(); });

  it("crea 30 estudiantes (10 por semestre), personal, instituciones e historial", async () => {
    resultado = await sembrarDemo({ semilla: 7 });
    for (const s of [1, 2, 3]) {
      assert.equal(await cuenta(
        `SELECT count(*) AS n FROM matriculas_estudiantes m JOIN periodos_academicos p ON p.id = m.periodo_academico_id
          WHERE p.estado = 'ACTIVO' AND m.numero_semestre = $1`, [s]), 10);
    }
    assert.equal(await cuenta("SELECT count(*) AS n FROM usuarios WHERE correo_institucional LIKE '%@demo.udi.test'"), 30 + 3 + 6, "30 estudiantes, 3 docentes y 6 asesores (cada persona, un solo rol)");
    assert.equal(await cuenta("SELECT count(*) AS n FROM instituciones WHERE correo LIKE '%@demo.udi.test'"), 7);
    assert.equal(resultado.periodoActual, "2026-2");
    // quien cursa 2.º y 3.º tiene sus prácticas previas finalizadas en periodos anteriores
    assert.equal(await cuenta("SELECT count(*) AS n FROM asignaciones_practica a JOIN periodos_academicos p ON p.id = (SELECT periodo_academico_id FROM matriculas_estudiantes WHERE id = a.matricula_estudiante_id) WHERE p.estado <> 'ACTIVO' AND a.estado = 'FINALIZADA'"), 30);
    const activo = await pool.query("SELECT codigo FROM periodos_academicos WHERE estado = 'ACTIVO'");
    assert.deepEqual(activo.rows.map((r) => r.codigo), ["2026-2"], "el periodo activo original se restaura");
  });

  it("reparte los estados y deja casos para las alertas del Director", async () => {
    const estados = Object.fromEntries((await pool.query(
      `SELECT a.estado, count(*)::int AS n FROM asignaciones_practica a JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
         JOIN periodos_academicos p ON p.id = m.periodo_academico_id WHERE p.estado = 'ACTIVO' GROUP BY a.estado`)).rows.map((r) => [r.estado, r.n]));
    assert.ok(estados.ACTIVA >= 2, "hay prácticas activas (sin avance y con bitácora en borrador)");
    assert.ok(estados.FINALIZADA >= 2 && estados.PENDIENTE_EVALUACION >= 1 && estados.ENVIADA >= 1 && estados.DEVUELTA >= 1 && estados.RECHAZADA >= 1);
    // la asesora con más practicantes supera el máximo de 5 (alerta de sobrecarga)
    assert.ok(await cuenta(
      `SELECT max(c) AS n FROM (SELECT count(*) AS c FROM asignaciones_practica WHERE asesor_sitio_id IS NOT NULL AND estado IN ('ACTIVA','PENDIENTE_EVALUACION') GROUP BY asesor_sitio_id) x`) >= 6);
    // un cambio de plaza hecho por Dirección, con su motivo
    assert.equal(await cuenta("SELECT count(*) AS n FROM asignaciones_practica WHERE motivo_cambio_plaza IS NOT NULL"), 1);
    // cuestionario y guía de cada nivel, marcados como demostración
    assert.equal(await cuenta("SELECT count(*) AS n FROM cuestionarios WHERE publicado AND habilitado AND titulo LIKE '%(demostración)%'"), 3);
    assert.ok(await cuenta("SELECT count(*) AS n FROM guias_criterios") >= 3);
  });

  it("las cuentas de demostración quedan con la contraseña acordada", async () => {
    const correo = resultado.cuentas.estudiantes[0].correo;
    const { rows } = await pool.query("SELECT firebase_uid FROM usuarios WHERE correo_institucional = $1", [correo]);
    assert.equal(firebase.estado.usuarios.get(rows[0].firebase_uid).password, "123456789");
  });

  it("no permite sembrar dos veces sin limpiar", async () => {
    await assert.rejects(sembrarDemo({ semilla: 7 }), /Ya hay datos de demostración/);
  });

  it("limpiar elimina todo lo demostrativo y conserva lo real; se puede volver a sembrar", async () => {
    const antesArchivos = almacen.size;
    assert.ok(antesArchivos > 0);
    const r = await limpiarDemo({});
    assert.deepEqual(r.avisos, []);
    assert.equal(almacen.size, 0, "se borran los archivos del almacenamiento");
    for (const tabla of ["asignaciones_practica", "bitacoras", "evaluaciones", "documentos_legales_estudiantes", "cuestionarios", "guias_criterios", "docentes_niveles", "matriculas_estudiantes", "vinculaciones_asesores", "archivos"]) {
      assert.equal(await cuenta(`SELECT count(*) AS n FROM ${tabla}`), 0, tabla);
    }
    assert.equal(await cuenta("SELECT count(*) AS n FROM usuarios"), 1, "queda solo el Director");
    assert.equal(await cuenta("SELECT count(*) AS n FROM instituciones"), 0);
    assert.equal(await cuenta("SELECT count(*) AS n FROM periodos_academicos"), 1);
    assert.equal([...firebase.estado.usuarios.keys()].filter((uid) => uid !== "uid-director").length, 0);
    await sembrarDemo({ semilla: 99 });
    assert.equal(await cuenta("SELECT count(*) AS n FROM usuarios WHERE correo_institucional LIKE '%@demo.udi.test'"), 39);
    await limpiarDemo({});
  });
});

/**
 * Pruebas de asignaciones de práctica con PostgreSQL real: crear, consultar por rol, reasignar y cancelar.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

const DIRECTOR = {
  firebase_uid: "uid-director", documento: "10203040", nombres: "Dora", apellidos: "Directora", correo: "director@udi.test",
};

const rechaza = async (promesa, { estado, codigo }) => {
  await assert.rejects(promesa, (error) => {
    assert.equal(error.estado_http ?? 500, estado, `estado ${error.estado_http}: ${error.message}`);
    if (codigo) assert.equal(error.codigo, codigo);
    return true;
  });
};

describe("asignaciones de práctica + PostgreSQL real", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, firebase, service, ctx, dir;
  let inst1, inst2, instEnTramite, est1, est2, est3, est4, doc1, doc2, ase1, ase2, nivel1, nivel2;

  const como = (rolActivo, usuario) => ({ rolActivo, usuario: { id: usuario.id } });
  const director = () => como("DIRECTOR_PROGRAMA", dir);
  const idsDe = (resultado) => resultado.filas.map((a) => a.id);
  const notificaciones = (tipo) => firebase.estado.eventos.filter((e) => e.ruta.startsWith("notificaciones_usuario/") && e.tipo === tipo);
  const auditoria = (accion) => firebase.estado.eventos.filter((e) => e.ruta === "auditoria" && e.accion === accion);
  const nivelDe = async (semestre) =>
    (await pool.query("SELECT id FROM niveles_practica WHERE numero_semestre = $1", [semestre])).rows[0].id;

  before(async () => {
    ({ pool, cerrarPool } = await import("../../src/config/database.js"));
    const { ejecutarSeedBase } = await import("../../src/database/seeds/base.js");
    const { sustituirFirebaseParaPruebas } = await import("../../src/config/firebase.js");
    const auth = await import("../../src/services/authService.js");
    const users = await import("../../src/services/userService.js");
    const insts = await import("../../src/services/institutionService.js");
    service = await import("../../src/services/assignmentService.js");

    firebase = crearFirebaseFalso();
    sustituirFirebaseParaPruebas(firebase.implementacion);
    await reconstruirEsquema(pool);
    await limpiarYSembrar(pool, ejecutarSeedBase, { director: DIRECTOR });

    const sesion = await auth.resolverSesion(DIRECTOR.firebase_uid, null);
    dir = sesion.usuario;
    ctx = {
      actor: { usuario_id: dir.id, firebase_uid: DIRECTOR.firebase_uid, rol_activo: "DIRECTOR_PROGRAMA" },
      direccion_ip: "127.0.0.1", agente_usuario: "pruebas", request_id: "req-asig",
    };

    inst1 = await insts.crear({ nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" }, ctx);
    inst2 = await insts.crear({ nombre: "Jardín Dos", nit: "900999888-1", ciudad: "Floridablanca", correo: "dos@jardin.test", estado_convenio: "VIGENTE" }, ctx);
    instEnTramite = await insts.crear({ nombre: "Jardín Tres", nit: "800111222-3", ciudad: "Girón", correo: "tres@jardin.test", estado_convenio: "EN_TRAMITE" }, ctx);

    const nuevo = (extra) => users.crear({ telefono: null, ...extra }, ctx);
    est1 = await nuevo({ rol: "ESTUDIANTE", documento: "2000000001", nombres: "Laura", apellidos: "Aguilar", correo: "laura@udi.test", semestre: 1 });
    est2 = await nuevo({ rol: "ESTUDIANTE", documento: "2000000002", nombres: "Mario", apellidos: "Bravo", correo: "mario@udi.test", semestre: 2 });
    est3 = await nuevo({ rol: "ESTUDIANTE", documento: "2000000003", nombres: "Nora", apellidos: "Cruz", correo: "nora@udi.test", semestre: 1 });
    est4 = await nuevo({ rol: "ESTUDIANTE", documento: "2000000004", nombres: "Omar", apellidos: "Díaz", correo: "omar@udi.test", semestre: 1 });
    doc1 = await nuevo({ rol: "DOCENTE_SUPERVISOR", documento: "3000000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    doc2 = await nuevo({ rol: "DOCENTE_SUPERVISOR", documento: "3000000002", nombres: "Claudia", apellidos: "Martínez", correo: "claudia@udi.test" });
    ase1 = await nuevo({ rol: "ASESOR_SITIO", documento: "4000000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: inst1.id });
    ase2 = await nuevo({ rol: "ASESOR_SITIO", documento: "4000000002", nombres: "Beatriz", apellidos: "Ríos", correo: "bea@jardin.test", institucion_id: inst2.id });
    nivel1 = await nivelDe(1);
    nivel2 = await nivelDe(2);
  });

  after(async () => {
    if (cerrarPool) await cerrarPool();
  });

  const datosBase = (extra = {}) => ({
    estudiante_id: est1.id, nivel_practica_id: nivel1, institucion_id: inst1.id,
    docente_supervisor_id: doc1.id, asesor_sitio_id: ase1.id, ...extra,
  });

  describe("crear", () => {
    it("rechaza un nivel que no corresponde al semestre del estudiante", async () => {
      await rechaza(service.crear(datosBase({ nivel_practica_id: nivel2 }), ctx), { estado: 422, codigo: "LEVEL_MISMATCH" });
    });

    it("rechaza instituciones sin convenio vigente", async () => {
      await rechaza(service.crear(datosBase({ institucion_id: instEnTramite.id, asesor_sitio_id: null }), ctx), { estado: 422, codigo: "INSTITUTION_NOT_AVAILABLE" });
    });

    it("rechaza un asesor que no pertenece a la institución", async () => {
      await rechaza(service.crear(datosBase({ asesor_sitio_id: ase2.id }), ctx), { estado: 422, codigo: "ADVISOR_NOT_IN_INSTITUTION" });
    });

    it("rechaza como docente a quien no tiene ese rol", async () => {
      await rechaza(service.crear(datosBase({ docente_supervisor_id: ase1.id }), ctx), { estado: 422, codigo: "TEACHER_INVALID" });
    });

    it("rechaza estudiantes inexistentes (sin matrícula en el periodo)", async () => {
      await rechaza(service.crear(datosBase({ estudiante_id: doc1.id }), ctx), { estado: 422, codigo: "ENROLLMENT_NOT_FOUND" });
    });

    it("crea una asignación completa, la audita y notifica a los tres participantes", async () => {
      const creada = await service.crear(datosBase(), ctx);
      assert.equal(creada.estado, "PENDIENTE_DOCUMENTOS");
      assert.equal(creada.completitud, "COMPLETA");
      assert.equal(creada.estudiante.nombre_completo, "Laura Aguilar");
      assert.equal(creada.docente.nombre_completo, "Juan Suárez");
      assert.equal(creada.asesor.nombre_completo, "Ana Gómez");
      assert.equal(creada.nivel.semestre, 1);
      assert.equal(creada.estudiante.firebase_uid, undefined, "no se expone el UID de Firebase");
      assert.equal(auditoria("ASIGNACION_CREADA").length, 1);
      assert.equal(notificaciones("ASIGNACION_CREADA").length, 1);
      assert.equal(notificaciones("ASIGNACION_NUEVA_TUTORIA").length, 1);
      assert.equal(notificaciones("ASIGNACION_NUEVO_PRACTICANTE").length, 1);
      const fila = (await pool.query("SELECT asignada_por_id FROM asignaciones_practica WHERE id = $1", [creada.id])).rows[0];
      assert.equal(fila.asignada_por_id, dir.id);
    });

    it("no permite una segunda práctica vigente en el mismo periodo", async () => {
      await rechaza(service.crear(datosBase(), ctx), { estado: 409, codigo: "ASSIGNMENT_ALREADY_EXISTS" });
    });

    it("permite crearla sin docente ni asesor (estados Sin Docente / Sin Asesor)", async () => {
      const sinDocente = await service.crear({ estudiante_id: est2.id, nivel_practica_id: nivel2, institucion_id: inst2.id }, ctx);
      assert.equal(sinDocente.completitud, "SIN_DOCENTE");
      assert.equal(sinDocente.docente, null);
      const sinAsesor = await service.crear(datosBase({ estudiante_id: est3.id, asesor_sitio_id: null }), ctx);
      assert.equal(sinAsesor.completitud, "SIN_ASESOR");
    });
  });

  describe("consulta y alcance por rol", () => {
    it("el Director lista todo y filtra por completitud, nivel, institución y texto", async () => {
      const todas = await service.listar({ limit: 50, offset: 0 }, director());
      assert.equal(todas.total, 3);
      assert.deepEqual((await service.listar({ completitud: "SIN_DOCENTE", limit: 50, offset: 0 }, director())).total, 1);
      assert.deepEqual((await service.listar({ completitud: "SIN_ASESOR", limit: 50, offset: 0 }, director())).total, 1);
      assert.deepEqual((await service.listar({ completitud: "COMPLETA", limit: 50, offset: 0 }, director())).total, 1);
      assert.equal((await service.listar({ nivel: 2, limit: 50, offset: 0 }, director())).total, 1);
      assert.equal((await service.listar({ institucion_id: inst2.id, limit: 50, offset: 0 }, director())).total, 1);
      assert.equal((await service.listar({ q: "2000000002", limit: 50, offset: 0 }, director())).total, 1);
      assert.equal((await service.listar({ q: "jardín uno", limit: 50, offset: 0 }, director())).total, 2);
    });

    it("el Docente solo ve sus estudiantes", async () => {
      const suyos = await service.listar({ limit: 50, offset: 0 }, como("DOCENTE_SUPERVISOR", doc1));
      assert.equal(suyos.total, 2);
      assert.ok(suyos.filas.every((a) => a.docente.id === doc1.id));
      assert.equal((await service.listar({ limit: 50, offset: 0 }, como("DOCENTE_SUPERVISOR", doc2))).total, 0);
    });

    it("el Asesor solo ve estudiantes de su institución y a su cargo", async () => {
      const suyos = await service.listar({ limit: 50, offset: 0 }, como("ASESOR_SITIO", ase1));
      assert.equal(suyos.total, 1);
      assert.equal(suyos.filas[0].estudiante.nombre_completo, "Laura Aguilar");
      assert.equal((await service.listar({ limit: 50, offset: 0 }, como("ASESOR_SITIO", ase2))).total, 0);
    });

    it("el Estudiante solo ve su propia asignación", async () => {
      const mia = await service.listar({ limit: 50, offset: 0 }, como("ESTUDIANTE", est1));
      assert.equal(mia.total, 1);
      assert.equal(mia.filas[0].estudiante.id, est1.id);
      assert.equal((await service.listar({ limit: 50, offset: 0 }, como("ESTUDIANTE", est4))).total, 0);
    });

    it("el detalle ajeno se responde como inexistente (no revela que existe)", async () => {
      const [primera] = (await service.listar({ limit: 50, offset: 0 }, como("DOCENTE_SUPERVISOR", doc1))).filas;
      assert.equal((await service.obtener(primera.id, como("DOCENTE_SUPERVISOR", doc1))).id, primera.id);
      await rechaza(service.obtener(primera.id, como("DOCENTE_SUPERVISOR", doc2)), { estado: 404, codigo: "ASSIGNMENT_NOT_FOUND" });
      await rechaza(service.obtener(primera.id, como("ESTUDIANTE", est4)), { estado: 404, codigo: "ASSIGNMENT_NOT_FOUND" });
      await rechaza(service.obtener(primera.id, como("ASESOR_SITIO", ase2)), { estado: 404, codigo: "ASSIGNMENT_NOT_FOUND" });
    });

    it("un asesor con vinculación vencida deja de ver al estudiante", async () => {
      await pool.query(
        "UPDATE vinculaciones_asesores SET vigente_desde = current_date - 10, vigente_hasta = current_date - 1 WHERE asesor_id = $1",
        [ase1.id]
      );
      assert.equal((await service.listar({ limit: 50, offset: 0 }, como("ASESOR_SITIO", ase1))).total, 0);
      await pool.query("UPDATE vinculaciones_asesores SET vigente_hasta = NULL WHERE asesor_id = $1", [ase1.id]);
      assert.equal((await service.listar({ limit: 50, offset: 0 }, como("ASESOR_SITIO", ase1))).total, 1);
    });

    it("lista a los estudiantes disponibles para asignar", async () => {
      const { filas } = await service.listarEstudiantesSinAsignacion({ limit: 50, offset: 0 });
      assert.deepEqual(filas.map((f) => f.documento), ["2000000004"]);
      assert.equal(filas[0].nivel_sugerido_id, nivel1);
      assert.equal((await service.listarEstudiantesSinAsignacion({ q: "zzz", limit: 50, offset: 0 })).total, 0);
    });
  });

  describe("reasignar", () => {
    let asignacionId;
    before(async () => {
      asignacionId = idsDe(await service.listar({ q: "2000000001", limit: 5, offset: 0 }, director()))[0];
    });

    it("cambia de docente, audita el cambio y avisa a quien entra y a quien sale", async () => {
      const previo = notificaciones("ASIGNACION_RETIRADA").length;
      const r = await service.actualizar(asignacionId, { docente_supervisor_id: doc2.id }, ctx);
      assert.equal(r.docente.id, doc2.id);
      const evento = auditoria("ASIGNACION_ACTUALIZADA").at(-1);
      assert.equal(evento.valor_anterior.docente_supervisor_id, doc1.id);
      assert.equal(evento.valor_nuevo.docente_supervisor_id, doc2.id);
      assert.equal(notificaciones("ASIGNACION_RETIRADA").length, previo + 1);
    });

    it("sin cambios reales no escribe nada", async () => {
      const antes = auditoria("ASIGNACION_ACTUALIZADA").length;
      await service.actualizar(asignacionId, { docente_supervisor_id: doc2.id }, ctx);
      assert.equal(auditoria("ASIGNACION_ACTUALIZADA").length, antes);
    });

    it("al cambiar de institución libera al asesor si no se indica uno nuevo", async () => {
      const r = await service.actualizar(asignacionId, { institucion_id: inst2.id }, ctx);
      assert.equal(r.institucion.id, inst2.id);
      assert.equal(r.asesor, null);
      assert.equal(r.completitud, "SIN_ASESOR");
      assert.equal(auditoria("ASIGNACION_ACTUALIZADA").at(-1).valor_nuevo.asesor_liberado_por_cambio_de_institucion, true);
    });

    it("exige que el asesor nuevo pertenezca a la institución", async () => {
      await rechaza(service.actualizar(asignacionId, { asesor_sitio_id: ase1.id }, ctx), { estado: 422, codigo: "ADVISOR_NOT_IN_INSTITUTION" });
      const r = await service.actualizar(asignacionId, { asesor_sitio_id: ase2.id }, ctx);
      assert.equal(r.asesor.id, ase2.id);
    });

    it("permite quitar al docente (pasa a Sin Docente)", async () => {
      const r = await service.actualizar(asignacionId, { docente_supervisor_id: null }, ctx);
      assert.equal(r.docente, null);
      assert.equal(r.completitud, "SIN_DOCENTE");
      await service.actualizar(asignacionId, { docente_supervisor_id: doc1.id }, ctx);
    });

    it("valida el orden de las fechas", async () => {
      await rechaza(service.actualizar(asignacionId, { fecha_inicio: "2026-08-01", fecha_fin: "2026-07-01" }, ctx), { estado: 422, codigo: "INVALID_DATES" });
      const r = await service.actualizar(asignacionId, { fecha_inicio: "2026-08-01", fecha_fin: "2026-12-01" }, ctx);
      assert.equal(r.fecha_inicio, "2026-08-01");
    });

    it("no reemplaza a un evaluador que ya publicó su nota", async () => {
      await pool.query(
        `INSERT INTO evaluaciones (asignacion_practica_id, evaluador_id, tipo_evaluador, nota, estado, publicada_en)
         VALUES ($1, $2, 'DOCENTE_SUPERVISOR', 4.5, 'PUBLICADA', now())`,
        [asignacionId, doc1.id]
      );
      await rechaza(service.actualizar(asignacionId, { docente_supervisor_id: doc2.id }, ctx), { estado: 422, codigo: "EVALUATOR_LOCKED" });
      await pool.query("DELETE FROM evaluaciones WHERE asignacion_practica_id = $1", [asignacionId]);
    });
  });

  describe("cancelar", () => {
    it("cancela con motivo, audita, notifica y libera al estudiante para una nueva asignación", async () => {
      const [a] = (await service.listar({ q: "2000000003", limit: 5, offset: 0 }, director())).filas;
      const r = await service.cancelar(a.id, { motivo: "La institución no tiene cupo" }, ctx);
      assert.equal(r.estado, "CANCELADA");
      assert.equal(r.motivo_cancelacion, "La institución no tiene cupo");
      assert.equal(auditoria("ASIGNACION_CANCELADA").length, 1);
      assert.ok(notificaciones("ASIGNACION_CANCELADA").length >= 1);
      // El docente ya no ve la cancelada; el estudiante sí la conserva en su historial.
      assert.ok(!idsDe(await service.listar({ limit: 50, offset: 0 }, como("DOCENTE_SUPERVISOR", doc1))).includes(a.id));
      assert.ok(idsDe(await service.listar({ limit: 50, offset: 0 }, como("ESTUDIANTE", est3))).includes(a.id));
      // Y se le puede asignar otra práctica.
      const nueva = await service.crear(datosBase({ estudiante_id: est3.id, asesor_sitio_id: null }), ctx);
      assert.notEqual(nueva.id, a.id);
    });

    it("no permite cancelar dos veces ni modificar una cancelada", async () => {
      const cancelada = (await service.listar({ estado: "CANCELADA", limit: 5, offset: 0 }, director())).filas[0];
      await rechaza(service.cancelar(cancelada.id, { motivo: "otra vez" }, ctx), { estado: 409, codigo: "ASSIGNMENT_ALREADY_CANCELLED" });
      await rechaza(service.actualizar(cancelada.id, { fecha_inicio: "2026-08-01" }, ctx), { estado: 422, codigo: "ASSIGNMENT_CLOSED" });
    });

    it("una práctica en curso exige confirmación", async () => {
      const [a] = (await service.listar({ q: "2000000002", limit: 5, offset: 0 }, director())).filas;
      await pool.query("UPDATE asignaciones_practica SET estado = 'ACTIVA' WHERE id = $1", [a.id]);
      await rechaza(service.cancelar(a.id, { motivo: "Retiro del estudiante" }, ctx), { estado: 409, codigo: "CONFIRMATION_REQUIRED" });
      const r = await service.cancelar(a.id, { motivo: "Retiro del estudiante", confirmar: true }, ctx);
      assert.equal(r.estado, "CANCELADA");
    });

    it("una práctica finalizada no puede cancelarse", async () => {
      const [a] = (await service.listar({ q: "2000000003", estado: "PENDIENTE_DOCUMENTOS", limit: 5, offset: 0 }, director())).filas;
      await pool.query("UPDATE asignaciones_practica SET estado = 'FINALIZADA' WHERE id = $1", [a.id]);
      await rechaza(service.cancelar(a.id, { motivo: "Intento tardío" }, ctx), { estado: 422, codigo: "ASSIGNMENT_CLOSED" });
    });
  });
});

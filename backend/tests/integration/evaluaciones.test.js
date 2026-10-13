/**
 * Pruebas de servicio de evaluaciones: cola por rol, borrador, publicación sin promedio, reapertura, cierre y cambios de evaluador.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, prepararEscenario, rechaza } from "../helpers/escenario.js";

describe("evaluaciones, reapertura y cierre de la práctica + PostgreSQL real", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, evaluaciones, asignaciones, bitacoras;
  let est, docente, docente2, asesor, asesor2;
  let aj; // asignaciones por número: aj[1] … aj[6]

  const D = (usuario) => esc.como("DOCENTE_SUPERVISOR", usuario);
  const A = (usuario) => esc.como("ASESOR_SITIO", usuario);
  const E = (usuario) => esc.como("ESTUDIANTE", usuario);
  const ctxDe = (usuario, rol) => esc.ctxDe(usuario, rol);
  const filas = async (sql, parametros = []) => (await esc.pool.query(sql, parametros)).rows;
  const cola = (auth, extra = {}) => evaluaciones.listar({ limit: 50, offset: 0, ...extra }, auth);
  const estadoBitacora = async (asignacionId) => (await filas("SELECT estado, evaluada_en FROM bitacoras WHERE asignacion_practica_id = $1", [asignacionId]))[0];
  const estadoAsignacion = async (id) => (await filas("SELECT estado FROM asignaciones_practica WHERE id = $1", [id]))[0].estado;

  /** Id de la evaluación de un tipo (docente o asesor) de una asignación, tal como la ve Dirección. */
  const idEval = async (asignacion, tipo) => {
    const { filas: lista } = await cola(esc.director(), { asignacion_id: asignacion.id, tipo });
    assert.equal(lista.length, 1, `evaluación ${tipo} de la asignación`);
    return lista[0].id;
  };
  const publicarDocente = async (asignacion, nota, retro = "Buen trabajo") =>
    evaluaciones.publicar(await idEval(asignacion, "DOCENTE_SUPERVISOR"), { nota, retroalimentacion: retro }, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR"));
  const publicarAsesor = async (asignacion, nota, retro = "Excelente actitud") =>
    evaluaciones.publicar(await idEval(asignacion, "ASESOR_SITIO"), { nota, retroalimentacion: retro }, A(asesor), ctxDe(asesor, "ASESOR_SITIO"));

  before(async () => {
    esc = await prepararEscenario();
    evaluaciones = await import("../../src/services/evaluationService.js");
    asignaciones = await import("../../src/services/assignmentService.js");
    bitacoras = await import("../../src/services/logbookService.js");

    est = {};
    for (let n = 1; n <= 7; n++) {
      est[n] = await esc.persona({ rol: "ESTUDIANTE", documento: `210000000${n}`, nombres: `Estudiante${n}`, apellidos: "Prueba", correo: `e${n}@udi.test`, semestre: 1 });
    }
    docente = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3100000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    docente2 = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3100000002", nombres: "Sara", apellidos: "Torres", correo: "sara@udi.test" });
    asesor = await esc.persona({ rol: "ASESOR_SITIO", documento: "4100000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: esc.inst.id });
    asesor2 = await esc.persona({ rol: "ASESOR_SITIO", documento: "4100000002", nombres: "Luis", apellidos: "Mora", correo: "luis@jardin2.test", institucion_id: esc.inst2.id });

    const completa = { docente_supervisor_id: docente.id, asesor_sitio_id: asesor.id };
    const otra = { docente_supervisor_id: docente2.id, asesor_sitio_id: asesor2.id, institucion_id: esc.inst2.id };
    aj = {};
    aj[1] = await esc.crearAsignacion(est[1], completa);
    aj[2] = await esc.crearAsignacion(est[2], completa);
    aj[3] = await esc.crearAsignacion(est[3], otra);
    aj[4] = await esc.crearAsignacion(est[4], completa); // reasignación
    aj[5] = await esc.crearAsignacion(est[5], completa); // cierre
    aj[6] = await esc.crearAsignacion(est[6], completa); // devolución
    aj[7] = await esc.crearAsignacion(est[7], completa); // sin entregar: no tiene evaluaciones
  });

  after(async () => {
    if (esc?.cerrarPool) await esc.cerrarPool();
  });

  describe("cola y alcance por rol", () => {
    it("sin bitácoras enviadas las colas están vacías", async () => {
      for (const auth of [esc.director(), D(docente), A(asesor), E(est[1])]) {
        const r = await cola(auth);
        assert.equal(r.total, 0);
        assert.deepEqual(r.resumen, { PENDIENTE: 0, BORRADOR: 0, PUBLICADA: 0 });
      }
    });

    it("enviar la bitácora deja dos evaluaciones PENDIENTE y cada evaluador ve solo la suya", async () => {
      await esc.entregarBitacora(aj[1], est[1]);
      await esc.entregarBitacora(aj[2], est[2]);
      await esc.entregarBitacora(aj[3], est[3]);

      const delDocente = await cola(D(docente));
      assert.equal(delDocente.total, 2);
      assert.ok(delDocente.filas.every((f) => f.tipo === "DOCENTE_SUPERVISOR" && f.estado === "PENDIENTE"));
      assert.deepEqual(delDocente.filas.map((f) => f.asignacion.id).sort(), [aj[1].id, aj[2].id].sort());
      assert.deepEqual(delDocente.resumen, { PENDIENTE: 2, BORRADOR: 0, PUBLICADA: 0 });

      const delAsesor = await cola(A(asesor));
      assert.equal(delAsesor.total, 2);
      assert.ok(delAsesor.filas.every((f) => f.tipo === "ASESOR_SITIO"));

      // Otro docente y otro asesor (otra institución) solo ven lo suyo
      assert.deepEqual((await cola(D(docente2))).filas.map((f) => f.asignacion.id), [aj[3].id]);
      assert.deepEqual((await cola(A(asesor2))).filas.map((f) => [f.asignacion.id, f.tipo]), [[aj[3].id, "ASESOR_SITIO"]]);

      // Dirección ve las dos evaluaciones de cada práctica
      const dir = await cola(esc.director());
      assert.equal(dir.total, 6);
      assert.deepEqual(dir.resumen, { PENDIENTE: 6, BORRADOR: 0, PUBLICADA: 0 });
      // El estudiante no ve evaluaciones pendientes
      assert.equal((await cola(E(est[1]))).total, 0);
      // Quien aún no entregó no tiene evaluaciones
      assert.equal((await cola(esc.director(), { asignacion_id: aj[7].id })).total, 0);
    });

    it("la cola se filtra por estado, tipo y texto sin alterar los contadores por estado", async () => {
      const soloAsesor = await cola(esc.director(), { tipo: "ASESOR_SITIO" });
      assert.equal(soloAsesor.total, 3);
      const buscada = await cola(esc.director(), { q: "Estudiante2" });
      assert.deepEqual([...new Set(buscada.filas.map((f) => f.asignacion.estudiante.nombre_completo))], ["Estudiante2 Prueba"]);
      const filtrada = await cola(D(docente), { estado: "BORRADOR" });
      assert.equal(filtrada.total, 0);
      assert.deepEqual(filtrada.resumen, { PENDIENTE: 2, BORRADOR: 0, PUBLICADA: 0 }, "el resumen ignora el filtro de estado");
      const paginada = await cola(esc.director(), { limit: 2, offset: 4 });
      assert.equal(paginada.filas.length, 2);
      assert.equal(paginada.total, 6);
    });

    it("el detalle incluye la entrega en solo lectura y respeta el alcance (otros reciben 404)", async () => {
      const id = await idEval(aj[1], "DOCENTE_SUPERVISOR");
      const detalle = await evaluaciones.obtener(id, D(docente));
      assert.equal(detalle.evaluacion.tipo, "DOCENTE_SUPERVISOR");
      assert.equal(detalle.evaluacion.editable, true);
      assert.equal(detalle.evaluacion.reabrible, false);
      assert.equal(detalle.bitacora.estado, "ENVIADA");
      assert.equal(detalle.bitacora.editable, false);
      assert.match(detalle.bitacora.contenido.reflexion, /juego simbólico/);
      assert.equal(detalle.bitacora.evidencias.length, 1);
      assert.equal(detalle.asignacion.estudiante.nombre_completo, "Estudiante1 Prueba");

      await rechaza(evaluaciones.obtener(id, D(docente2)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" }); // docente ajeno
      await rechaza(evaluaciones.obtener(id, A(asesor)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" }); // el asesor no ve la evaluación del docente
      await rechaza(evaluaciones.obtener(id, A(asesor2)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" }); // asesor de otra institución
      await rechaza(evaluaciones.obtener(id, E(est[1])), { estado: 404, codigo: "EVALUATION_NOT_FOUND" }); // aún no publicada
      await rechaza(evaluaciones.obtener(id, E(est[2])), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
      const dirDetalle = await evaluaciones.obtener(id, esc.director());
      assert.equal(dirDetalle.bitacora.estado, "ENVIADA");
      await rechaza(evaluaciones.obtener("00000000-0000-4000-8000-000000000000", esc.director()), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
    });

    it("un asesor con la vinculación vencida deja de ver la evaluación", async () => {
      await esc.pool.query("UPDATE vinculaciones_asesores SET vigente_desde = current_date - 30, vigente_hasta = current_date - 1 WHERE asesor_id = $1", [asesor2.id]);
      assert.equal((await cola(A(asesor2))).total, 0);
      await esc.pool.query("UPDATE vinculaciones_asesores SET vigente_hasta = NULL WHERE asesor_id = $1", [asesor2.id]);
      assert.equal((await cola(A(asesor2))).total, 1);
    });
  });

  describe("borrador del evaluador", () => {
    it("el docente guarda un borrador incompleto: pasa a BORRADOR y la bitácora a EN_EVALUACION", async () => {
      const id = await idEval(aj[1], "DOCENTE_SUPERVISOR");
      assert.equal((await estadoBitacora(aj[1].id)).estado, "ENVIADA");
      const r = await evaluaciones.guardarBorrador(id, { nota: null, retroalimentacion: "Voy leyendo con calma" }, D(docente));
      assert.equal(r.evaluacion.estado, "BORRADOR");
      assert.equal(r.evaluacion.nota, null);
      assert.equal(r.evaluacion.retroalimentacion, "Voy leyendo con calma");
      assert.equal(r.evaluacion.editable, true);
      assert.equal((await estadoBitacora(aj[1].id)).estado, "EN_EVALUACION");

      const r2 = await evaluaciones.guardarBorrador(id, { nota: 4.25, retroalimentacion: "Buen trabajo" }, D(docente));
      assert.equal(r2.evaluacion.nota, 4.25);
      assert.equal((await filas("SELECT nota::text AS nota FROM evaluaciones WHERE id = $1", [id]))[0].nota, "4.25");
    });

    it("el borrador no es visible como definitivo: ni el estudiante, ni Dirección, ni el otro evaluador", async () => {
      const id = await idEval(aj[1], "DOCENTE_SUPERVISOR");
      await rechaza(evaluaciones.obtener(id, E(est[1])), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
      assert.equal((await cola(E(est[1]))).total, 0);
      const dir = await evaluaciones.obtener(id, esc.director());
      assert.equal(dir.evaluacion.estado, "BORRADOR");
      assert.equal(dir.evaluacion.nota, null, "Dirección no ve la nota de un borrador");
      assert.equal(dir.evaluacion.retroalimentacion, null);
      const fila = (await cola(esc.director(), { asignacion_id: aj[1].id, tipo: "DOCENTE_SUPERVISOR" })).filas[0];
      assert.equal(fila.nota, null);
      // El asesor sigue viendo solo su evaluación (la del docente no existe para él)
      await rechaza(evaluaciones.obtener(id, A(asesor)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
      assert.deepEqual((await cola(D(docente))).resumen, { PENDIENTE: 1, BORRADOR: 1, PUBLICADA: 0 });
    });

    it("solo el evaluador del tipo y de ese estudiante puede guardar: otros reciben 404 y Dirección 403", async () => {
      const id = await idEval(aj[1], "DOCENTE_SUPERVISOR");
      await rechaza(evaluaciones.guardarBorrador(id, { nota: 1, retroalimentacion: null }, D(docente2)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
      await rechaza(evaluaciones.guardarBorrador(id, { nota: 1, retroalimentacion: null }, A(asesor)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
      await rechaza(evaluaciones.guardarBorrador(id, { nota: 1, retroalimentacion: null }, esc.director()), { estado: 403 });
      await rechaza(evaluaciones.guardarBorrador(id, { nota: 1, retroalimentacion: null }, E(est[1])), { estado: 403 });
      assert.equal((await filas("SELECT nota::text AS nota FROM evaluaciones WHERE id = $1", [id]))[0].nota, "4.25", "nada cambió");
    });

    it("la base de datos rechaza notas fuera de rango", async () => {
      const id = await idEval(aj[2], "DOCENTE_SUPERVISOR");
      await assert.rejects(esc.pool.query("UPDATE evaluaciones SET nota = 5.5 WHERE id = $1", [id]), { code: "23514" });
      await assert.rejects(esc.pool.query("UPDATE evaluaciones SET nota = -1 WHERE id = $1", [id]), { code: "23514" });
    });
  });

  describe("publicación independiente (sin promedio)", () => {
    it("no se publica sin nota", async () => {
      const id = await idEval(aj[2], "DOCENTE_SUPERVISOR");
      await rechaza(evaluaciones.publicar(id, {}, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR")), { estado: 422, codigo: "GRADE_REQUIRED" });
      assert.equal((await filas("SELECT estado FROM evaluaciones WHERE id = $1", [id]))[0].estado, "PENDIENTE");
      assert.equal((await estadoBitacora(aj[2].id)).estado, "ENVIADA", "una publicación fallida no cambia la bitácora");
    });

    it("publica con la nota del borrador: queda inmutable, auditada y el estudiante la ve", async () => {
      const id = await idEval(aj[1], "DOCENTE_SUPERVISOR");
      const r = await evaluaciones.publicar(id, {}, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR"));
      assert.equal(r.evaluacion.estado, "PUBLICADA");
      assert.equal(r.evaluacion.nota, 4.25);
      assert.equal(r.evaluacion.retroalimentacion, "Buen trabajo");
      assert.equal(r.evaluacion.editable, false);
      assert.ok(r.evaluacion.publicada_en);
      assert.equal(r.evaluacion.evaluador.nombre_completo, "Juan Suárez");

      const [fila] = await filas("SELECT evaluador_id, estado, publicada_en FROM evaluaciones WHERE id = $1", [id]);
      assert.equal(fila.evaluador_id, docente.id);
      assert.ok(fila.publicada_en);
      assert.equal((await estadoBitacora(aj[1].id)).estado, "EN_EVALUACION", "falta la evaluación del asesor");
      assert.equal((await estadoAsignacion(aj[1].id)), "PENDIENTE_EVALUACION");

      assert.equal(esc.auditoria("EVALUACION_PUBLICADA").length, 1);
      assert.equal(esc.avisos("EVALUACION_PUBLICADA", est[1].firebase_uid).length, 1);
      assert.equal(esc.avisos("PRACTICA_LISTA_PARA_CERRAR").length, 0, "todavía falta una evaluación");

      // El estudiante ahora sí la ve, sin datos de la reapertura
      const delEstudiante = await evaluaciones.obtener(id, E(est[1]));
      assert.equal(delEstudiante.evaluacion.nota, 4.25);
      assert.equal(delEstudiante.bitacora, undefined, "el estudiante no recibe la vista de evaluador");
      const lista = await cola(E(est[1]));
      assert.deepEqual(lista.filas.map((f) => [f.tipo, f.nota]), [["DOCENTE_SUPERVISOR", 4.25]]);
    });

    it("una evaluación publicada es inmutable: ni borrador ni nueva publicación, ni SQL directo", async () => {
      const id = await idEval(aj[1], "DOCENTE_SUPERVISOR");
      await rechaza(evaluaciones.guardarBorrador(id, { nota: 1, retroalimentacion: null }, D(docente)), { estado: 409, codigo: "EVALUATION_ALREADY_PUBLISHED" });
      await rechaza(evaluaciones.publicar(id, { nota: 1 }, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR")), { estado: 409, codigo: "EVALUATION_ALREADY_PUBLISHED" });
      await assert.rejects(esc.pool.query("UPDATE evaluaciones SET nota = 1 WHERE id = $1", [id]), { code: "23514" });
      await assert.rejects(esc.pool.query("UPDATE evaluaciones SET retroalimentacion = 'x' WHERE id = $1", [id]), { code: "23514" });
      assert.equal((await filas("SELECT nota::text AS nota FROM evaluaciones WHERE id = $1", [id]))[0].nota, "4.25");
    });

    it("la evaluación del asesor es independiente: no ve la nota del docente y no se calcula promedio", async () => {
      const idAsesor = await idEval(aj[1], "ASESOR_SITIO");
      const r = await evaluaciones.publicar(idAsesor, { nota: 3.8, retroalimentacion: "Puntual y receptiva" }, A(asesor), ctxDe(asesor, "ASESOR_SITIO"));
      assert.equal(r.evaluacion.nota, 3.8);
      assert.equal(r.evaluacion.tipo, "ASESOR_SITIO");
      assert.ok(!JSON.stringify(r).includes("promedio"));
      // El asesor solo tiene acceso a su propia evaluación
      const suyas = await cola(A(asesor), { asignacion_id: aj[1].id });
      assert.deepEqual(suyas.filas.map((f) => [f.tipo, f.nota]), [["ASESOR_SITIO", 3.8]]);
      // Dirección y el estudiante ven las dos por separado
      const dir = await cola(esc.director(), { asignacion_id: aj[1].id });
      assert.deepEqual(dir.filas.map((f) => [f.tipo, f.nota]), [["DOCENTE_SUPERVISOR", 4.25], ["ASESOR_SITIO", 3.8]]);
      const alumno = await cola(E(est[1]));
      assert.deepEqual(alumno.filas.map((f) => [f.tipo, f.nota]).sort(), [["ASESOR_SITIO", 3.8], ["DOCENTE_SUPERVISOR", 4.25]]);
      // Con las dos publicadas la bitácora queda EVALUADA y se avisa a Dirección
      const bit = await estadoBitacora(aj[1].id);
      assert.equal(bit.estado, "EVALUADA");
      assert.ok(bit.evaluada_en);
      assert.ok(esc.avisos("PRACTICA_LISTA_PARA_CERRAR").length >= 1);
      assert.equal(esc.auditoria("EVALUACION_PUBLICADA").length, 2);
    });

    it("dos publicaciones simultáneas de la misma evaluación: una sola gana", async () => {
      const id = await idEval(aj[2], "DOCENTE_SUPERVISOR");
      const resultados = await Promise.allSettled([
        evaluaciones.publicar(id, { nota: 4.0 }, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR")),
        evaluaciones.publicar(id, { nota: 4.0 }, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR")),
      ]);
      assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
      const rechazada = resultados.find((r) => r.status === "rejected");
      assert.equal(rechazada.reason.codigo, "EVALUATION_ALREADY_PUBLISHED");
      assert.equal(esc.auditoria("EVALUACION_PUBLICADA").length, 3, "una sola publicación auditada");
    });

    it("docente y asesor publican a la vez: la bitácora termina EVALUADA", async () => {
      await esc.entregarBitacora(aj[5], est[5]);
      const [idD, idA] = [await idEval(aj[5], "DOCENTE_SUPERVISOR"), await idEval(aj[5], "ASESOR_SITIO")];
      await Promise.all([
        evaluaciones.publicar(idD, { nota: 4.5 }, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR")),
        evaluaciones.publicar(idA, { nota: 3.0 }, A(asesor), ctxDe(asesor, "ASESOR_SITIO")),
      ]);
      const bit = await estadoBitacora(aj[5].id);
      assert.equal(bit.estado, "EVALUADA", "la serialización evita que la última publicación deje la bitácora a medias");
      assert.ok(bit.evaluada_en);
    });
  });

  describe("reapertura (Dirección)", () => {
    it("no se reabre una evaluación sin publicar", async () => {
      const id = await idEval(aj[2], "ASESOR_SITIO");
      await rechaza(evaluaciones.reabrir(id, { motivo: "Revisión de la nota" }, esc.director(), esc.ctx), { estado: 409, codigo: "EVALUATION_NOT_PUBLISHED" });
      await rechaza(evaluaciones.reabrir("00000000-0000-4000-8000-000000000000", { motivo: "No existe" }, esc.director(), esc.ctx), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
    });

    it("reabre con motivo: vuelve a BORRADOR, la bitácora a EN_EVALUACION y el estudiante deja de ver la nota", async () => {
      const id = await idEval(aj[1], "DOCENTE_SUPERVISOR");
      const r = await evaluaciones.reabrir(id, { motivo: "Error al digitar la nota" }, esc.director(), esc.ctx);
      assert.equal(r.evaluacion.estado, "BORRADOR");
      assert.equal(r.evaluacion.nota, null, "Dirección no ve el contenido de un borrador");
      assert.ok(r.evaluacion.reabierta_en);
      assert.equal(r.evaluacion.motivo_reapertura, "Error al digitar la nota");

      const [fila] = await filas("SELECT estado, nota::text AS nota, publicada_en, reabierta_en, motivo_reapertura FROM evaluaciones WHERE id = $1", [id]);
      assert.equal(fila.estado, "BORRADOR");
      assert.equal(fila.nota, "4.25", "se conserva el contenido para que el evaluador lo corrija");
      assert.equal(fila.publicada_en, null);
      assert.equal(fila.motivo_reapertura, "Error al digitar la nota");
      const bit = await estadoBitacora(aj[1].id);
      assert.equal(bit.estado, "EN_EVALUACION");
      assert.equal(bit.evaluada_en, null);

      assert.equal(esc.auditoria("EVALUACION_REABIERTA").length, 1);
      assert.equal(esc.avisos("EVALUACION_REABIERTA", docente.firebase_uid).length, 1);
      assert.equal(esc.avisos("EVALUACION_REABIERTA", est[1].firebase_uid).length, 1);
      await rechaza(evaluaciones.obtener(id, E(est[1])), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
      assert.deepEqual((await cola(E(est[1]))).filas.map((f) => f.tipo), ["ASESOR_SITIO"], "la del asesor sigue publicada");
    });

    it("el evaluador la corrige y la vuelve a publicar: la bitácora queda EVALUADA otra vez", async () => {
      const id = await idEval(aj[1], "DOCENTE_SUPERVISOR");
      const borrador = await evaluaciones.obtener(id, D(docente));
      assert.equal(borrador.evaluacion.nota, 4.25);
      assert.equal(borrador.evaluacion.editable, true);
      await evaluaciones.publicar(id, { nota: 4.5, retroalimentacion: "Nota corregida" }, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR"));
      assert.equal((await estadoBitacora(aj[1].id)).estado, "EVALUADA");
      assert.equal((await filas("SELECT nota::text AS nota FROM evaluaciones WHERE id = $1", [id]))[0].nota, "4.50");
      assert.equal((await evaluaciones.obtener(id, E(est[1]))).evaluacion.nota, 4.5);
    });
  });

  describe("cierre de la práctica", () => {
    it("no se finaliza mientras falten evaluaciones por publicar", async () => {
      await rechaza(evaluaciones.finalizarPractica(aj[2].id, esc.ctx), { estado: 422, codigo: "EVALUATIONS_PENDING" });
      await assert.rejects(evaluaciones.finalizarPractica(aj[2].id, esc.ctx), (error) => {
        assert.deepEqual(error.detalles.map((d) => [d.tipo, d.estado]), [["ASESOR_SITIO", "PENDIENTE"]]);
        return true;
      });
      assert.equal(await estadoAsignacion(aj[2].id), "PENDIENTE_EVALUACION");
    });

    it("solo se finaliza una práctica en evaluación", async () => {
      await rechaza(evaluaciones.finalizarPractica(aj[7].id, esc.ctx), { estado: 422, codigo: "INVALID_ASSIGNMENT_TRANSITION" });
      await rechaza(evaluaciones.finalizarPractica("00000000-0000-4000-8000-000000000000", esc.ctx), { estado: 404, codigo: "ASSIGNMENT_NOT_FOUND" });
    });

    it("finaliza con las dos notas publicadas, aunque la vinculación del asesor ya haya vencido", async () => {
      // El periodo pudo terminar: cerrar una práctica no debe exigir convenios o vinculaciones vigentes hoy.
      await esc.pool.query("UPDATE vinculaciones_asesores SET vigente_desde = current_date - 60, vigente_hasta = current_date - 1 WHERE asesor_id = $1", [asesor.id]);
      const r = await evaluaciones.finalizarPractica(aj[5].id, esc.ctx);
      await esc.pool.query("UPDATE vinculaciones_asesores SET vigente_hasta = NULL WHERE asesor_id = $1", [asesor.id]);
      assert.equal(r.estado, "FINALIZADA");
      assert.deepEqual(r.evaluaciones.map((e) => [e.tipo, e.nota]), [["DOCENTE_SUPERVISOR", 4.5], ["ASESOR_SITIO", 3]]);
      assert.ok(!JSON.stringify(r).includes("promedio"));
      assert.equal(await estadoAsignacion(aj[5].id), "FINALIZADA");
      assert.equal(esc.auditoria("PRACTICA_FINALIZADA").length, 1);
      for (const uid of [est[5].firebase_uid, docente.firebase_uid, asesor.firebase_uid]) {
        assert.equal(esc.avisos("PRACTICA_FINALIZADA", uid).length, 1);
      }
      // Dirección la puede consultar como finalizada, y el historial conserva las notas por separado
      const dir = await cola(esc.director(), { asignacion_id: aj[5].id });
      assert.deepEqual(dir.filas.map((f) => [f.tipo, f.nota, f.asignacion.estado]), [["DOCENTE_SUPERVISOR", 4.5, "FINALIZADA"], ["ASESOR_SITIO", 3, "FINALIZADA"]]);
      assert.ok(dir.filas.every((f) => f.editable === false && f.reabrible === false));
    });

    it("finalizada, la práctica queda cerrada: no se finaliza de nuevo, ni se reabre, edita o cancela", async () => {
      await rechaza(evaluaciones.finalizarPractica(aj[5].id, esc.ctx), { estado: 409, codigo: "ASSIGNMENT_ALREADY_FINISHED" });
      const id = await idEval(aj[5], "DOCENTE_SUPERVISOR");
      await rechaza(evaluaciones.reabrir(id, { motivo: "Ya terminó" }, esc.director(), esc.ctx), { estado: 422, codigo: "PRACTICE_FINISHED" });
      await rechaza(evaluaciones.guardarBorrador(id, { nota: 1, retroalimentacion: null }, D(docente)), { estado: 422, codigo: "PRACTICE_FINISHED" });
      await rechaza(evaluaciones.publicar(id, { nota: 1 }, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR")), { estado: 422, codigo: "PRACTICE_FINISHED" });
      await rechaza(asignaciones.cancelar(aj[5].id, { motivo: "Intento tardío", confirmar: true }, esc.ctx), { estado: 422 });
      await rechaza(asignaciones.actualizar(aj[5].id, { docente_supervisor_id: docente2.id }, esc.ctx), { estado: 422, codigo: "ASSIGNMENT_CLOSED" });
      assert.equal((await filas("SELECT nota::text AS nota FROM evaluaciones WHERE id = $1", [id]))[0].nota, "4.50");
    });
  });

  describe("cambios de evaluador y devolución con evaluaciones en curso", () => {
    it("al cambiar de docente, la evaluación sin publicar pasa al nuevo y no hereda el borrador", async () => {
      await esc.entregarBitacora(aj[4], est[4]);
      const id = await idEval(aj[4], "DOCENTE_SUPERVISOR");
      await evaluaciones.guardarBorrador(id, { nota: 2.5, retroalimentacion: "Borrador del docente anterior" }, D(docente));

      await asignaciones.actualizar(aj[4].id, { docente_supervisor_id: docente2.id }, esc.ctx);

      const [fila] = await filas("SELECT evaluador_id, estado, nota, retroalimentacion FROM evaluaciones WHERE id = $1", [id]);
      assert.equal(fila.evaluador_id, docente2.id);
      assert.equal(fila.estado, "PENDIENTE");
      assert.equal(fila.nota, null);
      assert.equal(fila.retroalimentacion, null);
      assert.deepEqual((await cola(D(docente2))).filas.filter((f) => f.asignacion.id === aj[4].id).map((f) => f.estado), ["PENDIENTE"]);
      assert.equal((await cola(D(docente), { asignacion_id: aj[4].id })).total, 0, "el docente anterior pierde el acceso");
      await rechaza(evaluaciones.obtener(id, D(docente)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
      await rechaza(evaluaciones.guardarBorrador(id, { nota: 1, retroalimentacion: null }, D(docente)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
      const detalle = await evaluaciones.obtener(id, esc.director());
      assert.equal(detalle.evaluacion.evaluador.nombre_completo, "Sara Torres", "Dirección ve al evaluador vigente");
      // El nuevo docente puede evaluar
      const r = await evaluaciones.publicar(id, { nota: 3.5 }, D(docente2), ctxDe(docente2, "DOCENTE_SUPERVISOR"));
      assert.equal(r.evaluacion.evaluador.nombre_completo, "Sara Torres");
    });

    it("el evaluador que ya publicó no puede reemplazarse (la evaluación publicada queda intacta)", async () => {
      await rechaza(asignaciones.actualizar(aj[4].id, { docente_supervisor_id: docente.id }, esc.ctx), { estado: 422, codigo: "EVALUATOR_LOCKED" });
      assert.equal((await filas("SELECT evaluador_id FROM evaluaciones WHERE asignacion_practica_id = $1 AND tipo_evaluador = 'DOCENTE_SUPERVISOR'", [aj[4].id]))[0].evaluador_id, docente2.id);
    });

    it("Dirección puede devolver una bitácora EN_EVALUACION sin notas publicadas: se retiran las evaluaciones", async () => {
      await esc.entregarBitacora(aj[6], est[6]);
      const idDocente = await idEval(aj[6], "DOCENTE_SUPERVISOR");
      await evaluaciones.guardarBorrador(idDocente, { nota: 2, retroalimentacion: "Borrador" }, D(docente));
      const bitacoraId = (await filas("SELECT id FROM bitacoras WHERE asignacion_practica_id = $1", [aj[6].id]))[0].id;
      assert.equal((await estadoBitacora(aj[6].id)).estado, "EN_EVALUACION");

      await bitacoras.devolver(bitacoraId, { motivo: "Faltan evidencias de la semana 3" }, esc.ctx);
      assert.equal((await estadoBitacora(aj[6].id)).estado, "DEVUELTA");
      assert.equal(await estadoAsignacion(aj[6].id), "ACTIVA");
      assert.equal((await cola(esc.director(), { asignacion_id: aj[6].id })).total, 0, "las evaluaciones se retiraron");
      await rechaza(evaluaciones.obtener(idDocente, D(docente)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
      await rechaza(evaluaciones.guardarBorrador(idDocente, { nota: 3, retroalimentacion: null }, D(docente)), { estado: 404, codigo: "EVALUATION_NOT_FOUND" });
    });

    it("una bitácora EVALUADA ya no puede devolverse", async () => {
      const bitacoraId = (await filas("SELECT id FROM bitacoras WHERE asignacion_practica_id = $1", [aj[1].id]))[0].id;
      assert.equal((await estadoBitacora(aj[1].id)).estado, "EVALUADA");
      await rechaza(bitacoras.devolver(bitacoraId, { motivo: "Ya no corresponde" }, esc.ctx), { estado: 422 });
    });
  });
});

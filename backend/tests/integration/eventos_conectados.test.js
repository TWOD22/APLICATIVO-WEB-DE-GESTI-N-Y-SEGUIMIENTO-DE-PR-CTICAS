/**
 * Fase 5c: el backend conectado al servicio de notificaciones y auditoría (EVENTS_MODE=outbox).
 * - Los avisos y la auditoría del negocio se encolan en el outbox en lugar de escribirse en Firestore.
 * - El publicador los entrega al segundo servicio (aquí, el servicio real con almacén en memoria) y la bandeja se lee de él.
 * - Si el servicio no responde, la bandeja falla con un error claro y los eventos esperan sin perderse.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { hayBaseDePruebas, prepararEscenario, rechaza } from "../helpers/escenario.js";

const SECRETO = "s".repeat(40);

/** Carga el servicio 2 (carpeta hermana notifications-service). null si no está instalado junto al backend. */
async function cargarServicio2() {
  try {
    const { crearApp } = await import("../../../notifications-service/src/app.js");
    const { crearAlmacenMemoria } = await import("../../../notifications-service/src/almacen/memoria.js");
    return { crearApp, crearAlmacenMemoria };
  } catch {
    return null;
  }
}

describe("Backend conectado al servicio de notificaciones (EVENTS_MODE=outbox)", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, adaptador, eventosAdapter, remotas, notificaciones, publicador, servicio2, servidor, almacen2, laura, mario;
  const filas = async (sql, p = []) => (await esc.pool.query(sql, p)).rows;
  const aviso = (n) => ({ tipo: "PRUEBA_5C", titulo: `Aviso ${n}`, mensaje: `Mensaje ${n}`, ruta_destino: "/estudiante/dashboard" });
  const publicar = (extra = {}) => publicador.publicarPendientes({ url: `http://127.0.0.1:${servidor?.address().port ?? 1}`, secreto: SECRETO, lote: 50, maxIntentos: 3, ...extra });

  before(async () => {
    esc = await prepararEscenario();
    adaptador = await import("../../src/adapters/firestoreAdapter.js");
    eventosAdapter = await import("../../src/adapters/eventosAdapter.js");
    remotas = await import("../../src/adapters/notificacionesRemotas.js");
    notificaciones = await import("../../src/services/notificationService.js");
    publicador = await import("../../src/services/outboxPublisher.js");
    laura = await esc.persona({ rol: "ESTUDIANTE", documento: "2500000001", nombres: "Laura", apellidos: "Aguilar", correo: "laura5c@udi.test", semestre: 1 });
    mario = await esc.persona({ rol: "ESTUDIANTE", documento: "2500000002", nombres: "Mario", apellidos: "Rojas", correo: "mario5c@udi.test", semestre: 1 });

    servicio2 = await cargarServicio2();
    if (servicio2) {
      almacen2 = servicio2.crearAlmacenMemoria();
      servidor = servicio2.crearApp({ almacen: almacen2, secreto: SECRETO }).listen(0);
      await new Promise((resolve) => servidor.once("listening", resolve));
      remotas.configurarClienteParaPruebas({ url: `http://127.0.0.1:${servidor.address().port}`, secreto: SECRETO });
    }
  });

  after(async () => {
    eventosAdapter.usarModoEventosParaPruebas("direct");
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (esc?.cerrarPool) await esc.cerrarPool();
  });

  beforeEach(async () => {
    eventosAdapter.usarModoEventosParaPruebas("outbox");
    await esc.pool.query("TRUNCATE eventos_salientes");
  });

  describe("encolado", () => {
    it("la auditoría se guarda en el outbox y no en Firestore", async () => {
      const UUID = "00000000-0000-4000-8000-0000000000b1";
      const antes = esc.auditoria("PRUEBA_5C").length;
      const ok = await adaptador.registrarAuditoria({ contexto: esc.ctx, accion: "PRUEBA_5C", entidad: "asignacion", entidad_id: UUID, valor_anterior: { a: 1 }, valor_nuevo: { a: 2 } });
      assert.equal(ok, true);
      assert.equal(esc.auditoria("PRUEBA_5C").length, antes, "no debe escribir en Firestore");
      const [fila] = await filas("SELECT * FROM eventos_salientes");
      assert.equal(fila.tipo, "auditoria.PRUEBA_5C");
      assert.equal(fila.estado, "PENDIENTE");
      assert.equal(fila.entidad_tipo, "asignacion");
      assert.equal(fila.entidad_id, UUID);
      assert.equal(fila.actor_id, esc.dir.id);
      assert.deepEqual(fila.carga.valor_anterior, { a: 1 });
      assert.deepEqual(fila.carga.valor_nuevo, { a: 2 });
      assert.deepEqual(fila.destinatarios, []);
    });

    it("un aviso se guarda en el outbox para su destinatario y no en Firestore", async () => {
      const entidad = { tipo: "asignacion", id: "00000000-0000-4000-8000-0000000000b2" };
      const ok = await adaptador.crearNotificacion(laura.firebase_uid, { ...aviso(1), prioridad: "alta", entidad });
      assert.equal(ok, true);
      assert.equal(esc.avisos("PRUEBA_5C", laura.firebase_uid).length, 0, "no debe escribir en Firestore");
      const [fila] = await filas("SELECT * FROM eventos_salientes");
      assert.equal(fila.tipo, "notificacion.PRUEBA_5C");
      assert.equal(fila.entidad_tipo, "asignacion");
      assert.equal(fila.entidad_id, entidad.id);
      assert.deepEqual(fila.destinatarios, [{ firebase_uid: laura.firebase_uid }]);
      assert.equal(fila.carga.titulo, "Aviso 1");
      assert.equal(fila.carga.prioridad, "alta");
      assert.equal(fila.carga.ruta_destino, "/estudiante/dashboard");
    });

    it("un aviso sin entidad también se encola (con entidad genérica)", async () => {
      assert.equal(await adaptador.crearNotificacion(mario.firebase_uid, aviso(2)), true);
      const [fila] = await filas("SELECT * FROM eventos_salientes");
      assert.equal(fila.entidad_tipo, "aviso");
    });

    it("una operación real del negocio (crear persona) deja su auditoría en el outbox", async () => {
      await esc.persona({ rol: "ESTUDIANTE", documento: "2500000003", nombres: "Nora", apellidos: "Pardo", correo: "nora5c@udi.test", semestre: 1 });
      const tipos = (await filas("SELECT tipo FROM eventos_salientes")).map((f) => f.tipo);
      assert.ok(tipos.length > 0 && tipos.every((t) => t.startsWith("auditoria.")), `eventos: ${tipos}`);
    });

    it("si el evento no es válido, la operación no falla: devuelve false y registra el error", async () => {
      const ok = await adaptador.registrarAuditoria({ contexto: esc.ctx, accion: "ACCION CON ESPACIOS", entidad: "x", entidad_id: "no-es-uuid" });
      assert.equal(ok, false);
      assert.equal((await filas("SELECT 1 FROM eventos_salientes")).length, 0);
    });

    it("en modo direct sigue escribiendo en Firestore como antes", async () => {
      eventosAdapter.usarModoEventosParaPruebas("direct");
      await adaptador.crearNotificacion(laura.firebase_uid, aviso(3));
      assert.equal(esc.avisos("PRUEBA_5C", laura.firebase_uid).length, 1);
      assert.equal((await filas("SELECT 1 FROM eventos_salientes")).length, 0);
    });
  });

  describe("de punta a punta con el servicio 2", { skip: false }, () => {
    const sesion = (u) => esc.como("ESTUDIANTE", u);

    it("el publicador entrega y la bandeja se lee desde el servicio 2", async (t) => {
      if (!servicio2) return t.skip("notifications-service no está junto al backend");
      for (let n = 1; n <= 3; n++) await adaptador.crearNotificacion(laura.firebase_uid, aviso(n));
      await adaptador.crearNotificacion(mario.firebase_uid, aviso(99));
      await adaptador.registrarAuditoria({ contexto: esc.ctx, accion: "PRUEBA_5C", entidad: "asignacion", entidad_id: "00000000-0000-4000-8000-0000000000b3" });

      const r = await publicar();
      assert.equal(r.enviados, 5);
      assert.equal(r.fallidos, 0);
      assert.equal((await filas("SELECT 1 FROM eventos_salientes WHERE estado = 'PUBLICADO'")).length, 5);
      assert.equal(almacen2.auditoria.filter((a) => a.accion === "PRUEBA_5C").length, 1, "la auditoría llegó al servicio 2");

      const mia = await notificaciones.listar({ page: 1, page_size: 20 }, sesion(laura));
      assert.equal(mia.total, 3);
      assert.equal(mia.no_leidas, 3);
      assert.ok(mia.filas.every((n) => n.tipo === "PRUEBA_5C" && n.leida === false && n.ruta_destino === "/estudiante/dashboard"));
      const deMario = await notificaciones.listar({ page: 1, page_size: 20 }, sesion(mario));
      assert.deepEqual(deMario.filas.map((n) => n.titulo), ["Aviso 99"]);
    });

    it("marcar como leída y marcar todas funcionan a través del servicio 2", async (t) => {
      if (!servicio2) return t.skip("notifications-service no está junto al backend");
      await adaptador.crearNotificacion(laura.firebase_uid, aviso(10));
      await adaptador.crearNotificacion(laura.firebase_uid, aviso(11));
      await publicar();
      const antes = await notificaciones.listar({ page: 1, page_size: 50 }, sesion(laura));
      const pendientes = antes.filas.filter((n) => !n.leida);
      const una = await notificaciones.marcarLeida(pendientes[0].id, sesion(laura));
      assert.equal(una.leida, true);
      const despues = await notificaciones.listar({ page: 1, page_size: 50 }, sesion(laura));
      assert.equal(despues.no_leidas, pendientes.length - 1);
      const todas = await notificaciones.marcarTodasComoLeidas(sesion(laura));
      assert.equal(todas.actualizadas, pendientes.length - 1);
      assert.equal((await notificaciones.listar({ page: 1, page_size: 50 }, sesion(laura))).no_leidas, 0);
    });

    it("nadie marca las notificaciones de otra persona", async (t) => {
      if (!servicio2) return t.skip("notifications-service no está junto al backend");
      await adaptador.crearNotificacion(mario.firebase_uid, aviso(20));
      await publicar();
      const deMario = (await notificaciones.listar({ page: 1, page_size: 50 }, sesion(mario))).filas[0];
      await rechaza(notificaciones.marcarLeida(deMario.id, sesion(laura)), { estado: 404, codigo: "NOTIFICATION_NOT_FOUND" });
    });

    it("reenviar el mismo evento no duplica nada (409 cuenta como entregado)", async (t) => {
      if (!servicio2) return t.skip("notifications-service no está junto al backend");
      await adaptador.crearNotificacion(laura.firebase_uid, aviso(30));
      const antes = (await notificaciones.listar({ page: 1, page_size: 100 }, sesion(laura))).total;
      await publicar();
      await esc.pool.query("UPDATE eventos_salientes SET estado = 'PENDIENTE', proximo_intento_en = now()");
      const r = await publicar();
      assert.equal(r.enviados, 1);
      const despues = (await notificaciones.listar({ page: 1, page_size: 100 }, sesion(laura))).total;
      assert.equal(despues, antes + 1);
    });

    it("con el secreto equivocado el servicio rechaza y el evento queda pendiente para reintentar", async (t) => {
      if (!servicio2) return t.skip("notifications-service no está junto al backend");
      await adaptador.crearNotificacion(laura.firebase_uid, aviso(40));
      const r = await publicar({ secreto: "x".repeat(40) });
      assert.equal(r.enviados, 0);
      assert.equal(r.fallidos, 1);
      const [fila] = await filas("SELECT estado, intentos, ultimo_error FROM eventos_salientes");
      assert.equal(fila.estado, "PENDIENTE");
      assert.equal(fila.intentos, 1);
      assert.match(fila.ultimo_error, /401/);
    });
  });

  describe("servicio 2 caído", () => {
    it("la bandeja responde un error claro (502) y no se cae el backend", async () => {
      const original = servidor ? `http://127.0.0.1:${servidor.address().port}` : undefined;
      remotas.configurarClienteParaPruebas({ url: "http://127.0.0.1:1", secreto: SECRETO });
      try {
        await rechaza(notificaciones.listar({ page: 1, page_size: 20 }, esc.como("ESTUDIANTE", laura)), { estado: 502, codigo: "NOTIFICATION_STORE_ERROR" });
        await rechaza(notificaciones.marcarTodasComoLeidas(esc.como("ESTUDIANTE", laura)), { estado: 502, codigo: "NOTIFICATION_STORE_ERROR" });
      } finally {
        if (original) remotas.configurarClienteParaPruebas({ url: original, secreto: SECRETO });
      }
    });

    it("los eventos siguen encolándose y se entregan cuando el servicio vuelve", async (t) => {
      if (!servicio2) return t.skip("notifications-service no está junto al backend");
      await adaptador.crearNotificacion(laura.firebase_uid, aviso(50));
      const caido = await publicar({ url: "http://127.0.0.1:1" });
      assert.equal(caido.enviados, 0);
      assert.equal(caido.fallidos, 1);
      await esc.pool.query("UPDATE eventos_salientes SET proximo_intento_en = now()");
      const r = await publicar();
      assert.equal(r.enviados, 1);
      assert.equal((await filas("SELECT 1 FROM eventos_salientes WHERE estado = 'PUBLICADO'")).length, 1);
    });
  });
});

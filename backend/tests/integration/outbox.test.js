/**
 * Pruebas del outbox y su publicador (Fase 5a del flujo v2): los eventos se guardan en PostgreSQL y se envían por HTTP
 * firmado con reintentos, sin duplicar aunque haya varios publicadores.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { hayBaseDePruebas, prepararEscenario, rechaza } from "../helpers/escenario.js";
import { verificar } from "../../src/utils/firmaEventos.js";

const SECRETO = "k".repeat(40);
const URL_SERVICIO = "https://notificaciones.test";

describe("outbox de eventos + PostgreSQL real", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, eventos, publicador, repo;
  const filas = async (sql, p = []) => (await esc.pool.query(sql, p)).rows;
  const UUID = "00000000-0000-4000-8000-0000000000aa";
  const emitir = (extra = {}) =>
    eventos.emitirEvento(
      { tipo: "notificacion.EVALUACION_PUBLICADA", contexto: esc.ctx, entidadTipo: "evaluacion", entidadId: UUID,
        destinatarios: [{ firebase_uid: "uid-x" }], carga: { titulo: "Hola", mensaje: "Mundo" }, ...extra },
      undefined
    );
  /** Receptor falso: guarda lo recibido y responde con el estado que se le indique. */
  const receptor = (estados = [200]) => {
    const recibidos = [];
    let i = 0;
    const fetchImpl = async (url, init) => {
      recibidos.push({ url, init, cuerpo: JSON.parse(init.body) });
      const estado = estados[Math.min(i++, estados.length - 1)];
      return { ok: estado >= 200 && estado < 300, status: estado };
    };
    return { recibidos, fetchImpl };
  };
  const publicar = (fetchImpl, extra = {}) =>
    publicador.publicarPendientes({ url: URL_SERVICIO, secreto: SECRETO, fetchImpl, lote: 25, maxIntentos: 3, ...extra });

  before(async () => {
    esc = await prepararEscenario();
    eventos = await import("../../src/services/eventService.js");
    publicador = await import("../../src/services/outboxPublisher.js");
    repo = await import("../../src/repositories/outboxRepository.js");
  });
  after(async () => {
    if (esc?.cerrarPool) await esc.cerrarPool();
  });
  beforeEach(async () => {
    await esc.pool.query("TRUNCATE eventos_salientes");
  });

  describe("emitir", () => {
    it("guarda el evento PENDIENTE con actor, entidad, destinatarios y carga", async () => {
      const id = await emitir();
      const [fila] = await filas("SELECT * FROM eventos_salientes WHERE id = $1", [id]);
      assert.equal(fila.estado, "PENDIENTE");
      assert.equal(fila.tipo, "notificacion.EVALUACION_PUBLICADA");
      assert.equal(fila.version, 1);
      assert.equal(fila.actor_id, esc.dir.id);
      assert.equal(fila.entidad_id, UUID);
      assert.deepEqual(fila.destinatarios, [{ firebase_uid: "uid-x" }]);
      assert.equal(fila.carga.titulo, "Hola");
    });

    it("rechaza tipos inválidos y entidades sin uuid", async () => {
      await assert.rejects(emitir({ tipo: "otra.cosa" }), /Tipo de evento inválido/);
      await assert.rejects(emitir({ tipo: "auditoria." }), /Tipo de evento inválido/);
      await assert.rejects(emitir({ entidadId: "no-es-uuid" }), /uuid/);
    });

    it("dentro de una transacción se revierte junto con el cambio de negocio", async () => {
      const { withTransaction } = await import("../../src/database/transaction.js");
      await assert.rejects(
        withTransaction(async (client) => {
          await eventos.emitirEvento({ tipo: "auditoria.PRUEBA", contexto: esc.ctx, entidadTipo: "x", entidadId: UUID }, client);
          throw new Error("falla de negocio");
        }),
        /falla de negocio/
      );
      assert.equal((await filas("SELECT count(*)::int AS n FROM eventos_salientes"))[0].n, 0);
      await withTransaction((client) => eventos.emitirEvento({ tipo: "auditoria.PRUEBA", contexto: esc.ctx, entidadTipo: "x", entidadId: UUID }, client));
      assert.equal((await filas("SELECT count(*)::int AS n FROM eventos_salientes"))[0].n, 1);
    });
  });

  describe("publicar", () => {
    it("envía el sobre firmado y lo marca PUBLICADO", async () => {
      const id = await emitir();
      const r = receptor([200]);
      assert.deepEqual(await publicar(r.fetchImpl), { enviados: 1, fallidos: 0, definitivos: 0 });
      assert.equal(r.recibidos.length, 1);
      const { url, init, cuerpo } = r.recibidos[0];
      assert.equal(url, `${URL_SERVICIO}/events`);
      assert.equal(init.headers["X-Event-Id"], id);
      assert.equal(verificar({ cuerpo: init.body, marca: init.headers["X-Timestamp"], firma: init.headers["X-Signature"], secreto: SECRETO }), true);
      assert.equal(cuerpo.id, id);
      assert.equal(cuerpo.version, 1);
      assert.equal(cuerpo.entidad.tipo, "evaluacion");
      assert.deepEqual(cuerpo.actor, { usuario_id: esc.dir.id, firebase_uid: esc.ctx.actor.firebase_uid, rol_activo: "DIRECTOR_PROGRAMA" });
      assert.equal(cuerpo.contexto.request_id, "req-fase5");
      assert.equal(cuerpo.carga._actor, undefined, "los campos internos no viajan dentro de la carga");
      const [fila] = await filas("SELECT estado, intentos, publicado_en FROM eventos_salientes WHERE id = $1", [id]);
      assert.deepEqual([fila.estado, fila.intentos], ["PUBLICADO", 1]);
      assert.ok(fila.publicado_en);
      assert.deepEqual(await publicar(r.fetchImpl), { enviados: 0, fallidos: 0, definitivos: 0 }, "no se reenvía lo publicado");
    });

    it("respeta el orden de creación", async () => {
      const a = await emitir({ carga: { n: 1 } });
      const b = await emitir({ carga: { n: 2 } });
      const r = receptor([200]);
      await publicar(r.fetchImpl);
      assert.deepEqual(r.recibidos.map((x) => x.cuerpo.id), [a, b]);
    });

    it("409 (ya lo tenía) cuenta como entregado", async () => {
      const id = await emitir();
      assert.equal((await publicar(receptor([409]).fetchImpl)).enviados, 1);
      assert.equal((await filas("SELECT estado FROM eventos_salientes WHERE id = $1", [id]))[0].estado, "PUBLICADO");
    });

    it("un fallo reprograma con espera y no se reintenta antes de tiempo", async () => {
      const id = await emitir();
      const r = receptor([503]);
      assert.deepEqual(await publicar(r.fetchImpl), { enviados: 0, fallidos: 1, definitivos: 0 });
      const [fila] = await filas("SELECT estado, intentos, ultimo_error, proximo_intento_en > now() AS futuro FROM eventos_salientes WHERE id = $1", [id]);
      assert.deepEqual([fila.estado, fila.intentos, fila.futuro], ["PENDIENTE", 1, true]);
      assert.match(fila.ultimo_error, /503/);
      assert.equal((await publicar(r.fetchImpl)).fallidos, 0, "aún no vence la espera");
      assert.equal(r.recibidos.length, 1);
    });

    it("tras reintentar con éxito se publica y limpia el error", async () => {
      const id = await emitir();
      await publicar(receptor([500]).fetchImpl);
      await esc.pool.query("UPDATE eventos_salientes SET proximo_intento_en = now() WHERE id = $1", [id]);
      assert.equal((await publicar(receptor([200]).fetchImpl)).enviados, 1);
      const [fila] = await filas("SELECT estado, intentos, ultimo_error FROM eventos_salientes WHERE id = $1", [id]);
      assert.deepEqual([fila.estado, fila.intentos, fila.ultimo_error], ["PUBLICADO", 2, null]);
    });

    it("al agotar los intentos queda FALLIDO (no se pierde) y se puede reencolar", async () => {
      const id = await emitir();
      const caido = async () => { throw new Error("ECONNREFUSED"); };
      let ultimo;
      for (let i = 0; i < 3; i++) {
        await esc.pool.query("UPDATE eventos_salientes SET proximo_intento_en = now() WHERE id = $1", [id]);
        ultimo = await publicar(caido);
      }
      assert.equal(ultimo.definitivos, 1);
      const [fila] = await filas("SELECT estado, intentos, ultimo_error FROM eventos_salientes WHERE id = $1", [id]);
      assert.deepEqual([fila.estado, fila.intentos], ["FALLIDO", 3]);
      assert.match(fila.ultimo_error, /ECONNREFUSED/);
      assert.deepEqual(await repo.contarPorEstado(), { PENDIENTE: 0, PUBLICADO: 0, FALLIDO: 1 });
      assert.equal(await repo.reencolarFallidos(), 1);
      assert.equal((await publicar(receptor([200]).fetchImpl)).enviados, 1);
    });

    it("dos publicadores a la vez no envían dos veces el mismo evento", async () => {
      for (let i = 0; i < 6; i++) await emitir({ carga: { n: i } });
      const r1 = receptor([200]);
      const r2 = receptor([200]);
      const [a, b] = await Promise.all([publicar(r1.fetchImpl, { lote: 3 }), publicar(r2.fetchImpl, { lote: 3 })]);
      assert.equal(a.enviados + b.enviados, 6);
      const ids = [...r1.recibidos, ...r2.recibidos].map((x) => x.cuerpo.id);
      assert.equal(new Set(ids).size, ids.length);
    });

    it("sin configuración del servicio falla con un mensaje claro", async () => {
      await assert.rejects(publicador.publicarPendientes({ url: undefined, secreto: undefined, fetchImpl: receptor().fetchImpl }), /Falta NOTIFICATIONS_SERVICE_URL/);
    });

    it("la espera crece de forma exponencial con tope de 15 minutos", () => {
      assert.deepEqual([0, 1, 2, 3].map(publicador.esperaSegundos), [5, 10, 20, 40]);
      assert.equal(publicador.esperaSegundos(30), 900);
    });
  });
});

/**
 * Pruebas de notificaciones: bandeja propia, paginación, marcar como leídas y fallo de Firestore.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, prepararEscenario, rechaza } from "../helpers/escenario.js";

/**
 * Bandeja de notificaciones: servicio (con Firestore en memoria) y contrato HTTP.
 * Cada usuario solo ve y marca las suyas; marcar es idempotente; el listado pagina y cuenta las no leídas.
 */
describe("Notificaciones del usuario", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, servicio, crearNotificacion, servidor, base;
  let laura, mario, tokenLaura, tokenMario;

  const aviso = (n) => ({ tipo: "PRUEBA", titulo: `Aviso ${n}`, mensaje: `Mensaje ${n}`, ruta_destino: "/estudiante/dashboard" });
  const pedir = async (ruta, { token, metodo = "GET" } = {}) => {
    const respuesta = await fetch(`${base}${ruta}`, { method: metodo, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const texto = await respuesta.text();
    return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
  };

  before(async () => {
    esc = await prepararEscenario();
    servicio = await import("../../src/services/notificationService.js");
    ({ crearNotificacion } = await import("../../src/adapters/firestoreAdapter.js"));
    const { crearApp } = await import("../../src/app.js");

    laura = await esc.persona({ rol: "ESTUDIANTE", documento: "2300000001", nombres: "Laura", apellidos: "Aguilar", correo: "laura@udi.test", semestre: 1 });
    mario = await esc.persona({ rol: "ESTUDIANTE", documento: "2300000002", nombres: "Mario", apellidos: "Rojas", correo: "mario@udi.test", semestre: 1 });
    tokenLaura = esc.firebase.emitirToken(laura.firebase_uid);
    tokenMario = esc.firebase.emitirToken(mario.firebase_uid);

    // Laura recibe 5 avisos (el 1 es el más antiguo); Mario recibe 1.
    for (let n = 1; n <= 5; n++) await crearNotificacion(laura.firebase_uid, aviso(n));
    await crearNotificacion(mario.firebase_uid, aviso(99));

    servidor = crearApp().listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (esc?.cerrarPool) await esc.cerrarPool();
  });

  const sesionLaura = () => esc.como("ESTUDIANTE", laura);

  it("lista solo las propias, la más reciente primero, con contador de no leídas", async () => {
    const r = await servicio.listar({ page: 1, page_size: 20 }, sesionLaura());
    assert.equal(r.total, 5);
    assert.equal(r.no_leidas, 5);
    assert.deepEqual(r.filas.map((n) => n.titulo), ["Aviso 5", "Aviso 4", "Aviso 3", "Aviso 2", "Aviso 1"]);
    assert.ok(r.filas.every((n) => n.leida === false && n.id && n.tipo === "PRUEBA" && n.ruta_destino === "/estudiante/dashboard"));
    const deMario = await servicio.listar({ page: 1, page_size: 20 }, esc.como("ESTUDIANTE", mario));
    assert.deepEqual(deMario.filas.map((n) => n.titulo), ["Aviso 99"]);
  });

  it("pagina el listado", async () => {
    const pagina2 = await servicio.listar({ page: 2, page_size: 2 }, sesionLaura());
    assert.equal(pagina2.total, 5);
    assert.deepEqual(pagina2.filas.map((n) => n.titulo), ["Aviso 3", "Aviso 2"]);
    const fuera = await servicio.listar({ page: 9, page_size: 2 }, sesionLaura());
    assert.deepEqual(fuera.filas, []);
  });

  it("marca una como leída (idempotente) y el filtro solo_no_leidas la excluye", async () => {
    const lista = (await servicio.listar({ page: 1, page_size: 20 }, sesionLaura())).filas;
    const objetivo = lista.find((n) => n.titulo === "Aviso 4");
    const una = await servicio.marcarLeida(objetivo.id, sesionLaura());
    assert.equal(una.leida, true);
    const otra = await servicio.marcarLeida(objetivo.id, sesionLaura());
    assert.equal(otra.leida, true);

    const pendientes = await servicio.listar({ page: 1, page_size: 20, solo_no_leidas: true }, sesionLaura());
    assert.equal(pendientes.total, 4);
    assert.equal(pendientes.no_leidas, 4);
    assert.ok(!pendientes.filas.some((n) => n.id === objetivo.id));
  });

  it("no permite marcar notificaciones de otra persona ni inexistentes", async () => {
    const ajena = (await servicio.listar({ page: 1, page_size: 20 }, esc.como("ESTUDIANTE", mario))).filas[0];
    await rechaza(servicio.marcarLeida(ajena.id, sesionLaura()), { estado: 404, codigo: "NOTIFICATION_NOT_FOUND" });
    await rechaza(servicio.marcarLeida("00000000-0000-4000-8000-000000000000", sesionLaura()), { estado: 404, codigo: "NOTIFICATION_NOT_FOUND" });
    const intacta = await servicio.listar({ page: 1, page_size: 20 }, esc.como("ESTUDIANTE", mario));
    assert.equal(intacta.no_leidas, 1);
  });

  it("marca todas como leídas solo para el usuario de la sesión", async () => {
    const r = await servicio.marcarTodasComoLeidas(sesionLaura());
    assert.equal(r.actualizadas, 4);
    const despues = await servicio.listar({ page: 1, page_size: 20 }, sesionLaura());
    assert.equal(despues.no_leidas, 0);
    assert.equal(despues.total, 5);
    assert.equal((await servicio.marcarTodasComoLeidas(sesionLaura())).actualizadas, 0);
    assert.equal((await servicio.listar({ page: 1, page_size: 20 }, esc.como("ESTUDIANTE", mario))).no_leidas, 1);
  });

  it("responde 502 NOTIFICATION_STORE_ERROR si Firestore falla", async () => {
    esc.firebase.estado.fallar.firestore = true;
    try {
      await rechaza(servicio.listar({ page: 1, page_size: 20 }, sesionLaura()), { estado: 502, codigo: "NOTIFICATION_STORE_ERROR" });
      await rechaza(servicio.marcarTodasComoLeidas(sesionLaura()), { estado: 502, codigo: "NOTIFICATION_STORE_ERROR" });
    } finally {
      esc.firebase.estado.fallar.firestore = false;
    }
  });

  describe("HTTP", () => {
    it("exige sesión", async () => {
      assert.equal((await pedir("/api/v1/notifications")).estado, 401);
      assert.equal((await pedir("/api/v1/notifications/read-all", { metodo: "PATCH" })).estado, 401);
      assert.equal((await pedir("/api/v1/notifications/00000000-0000-4000-8000-000000000000/read", { metodo: "PATCH" })).estado, 401);
    });

    it("cumple el contrato de listado y valida la consulta", async () => {
      const r = await pedir("/api/v1/notifications?page=1&page_size=2", { token: tokenLaura });
      assert.equal(r.estado, 200);
      assert.equal(r.json.data.length, 2);
      assert.equal(r.json.meta.page, 1);
      assert.equal(r.json.meta.page_size, 2);
      assert.equal(r.json.meta.total, 5);
      assert.equal(r.json.meta.total_pages, 3);
      assert.equal(r.json.meta.no_leidas, 0);
      assert.ok(r.json.meta.request_id);

      assert.equal((await pedir("/api/v1/notifications?page=0", { token: tokenLaura })).estado, 400);
      assert.equal((await pedir("/api/v1/notifications?solo_no_leidas=quizas", { token: tokenLaura })).estado, 400);
      assert.equal((await pedir("/api/v1/notifications/no-es-uuid/read", { token: tokenLaura, metodo: "PATCH" })).estado, 400);
    });

    it("marca una y todas por HTTP sin tocar las de otro usuario", async () => {
      const mia = (await pedir("/api/v1/notifications", { token: tokenMario })).json.data[0];
      assert.equal(mia.leida, false);
      const marcada = await pedir(`/api/v1/notifications/${mia.id}/read`, { token: tokenMario, metodo: "PATCH" });
      assert.equal(marcada.estado, 200);
      assert.equal(marcada.json.data.leida, true);

      const ajena = await pedir(`/api/v1/notifications/${mia.id}/read`, { token: tokenLaura, metodo: "PATCH" });
      assert.equal(ajena.estado, 404);
      assert.equal(ajena.json.error.code, "NOTIFICATION_NOT_FOUND");

      await crearNotificacion(mario.firebase_uid, aviso(100));
      const todas = await pedir("/api/v1/notifications/read-all", { token: tokenMario, metodo: "PATCH" });
      assert.equal(todas.estado, 200);
      assert.deepEqual(todas.json.data, { actualizadas: 1 });
      assert.equal((await pedir("/api/v1/notifications?solo_no_leidas=true", { token: tokenMario })).json.meta.total, 0);
    });
  });
});

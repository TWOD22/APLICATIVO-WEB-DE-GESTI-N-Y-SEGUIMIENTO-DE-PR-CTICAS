/**
 * Pruebas del servicio de notificaciones y auditoría: firma, contrato del evento, idempotencia, bandeja de notificaciones
 * y el almacén de Firestore (contra un Firestore falso en memoria).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { crearAlmacenFirestore } from "../src/almacen/firestore.js";
import { crearAlmacenMemoria } from "../src/almacen/memoria.js";
import { crearApp } from "../src/app.js";
import { cargarEntorno } from "../src/config/env.js";
import { firmar, TOLERANCIA_SEGUNDOS, verificar } from "../src/firma.js";

const SECRETO = "t".repeat(40);
let contador = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, "0")}`;

const sobre = (extra = {}) => ({
  id: uuid(), tipo: "notificacion.EVALUACION_PUBLICADA", version: 1, ocurrido_en: new Date().toISOString(),
  actor: { usuario_id: "u-1", firebase_uid: "uid-dir", rol_activo: "DIRECTOR_PROGRAMA" },
  entidad: { tipo: "evaluacion", id: uuid() },
  destinatarios: [{ firebase_uid: "uid-a" }, { firebase_uid: "uid-b" }],
  carga: { titulo: "Tienes una evaluación nueva", mensaje: "Publicada", prioridad: "alta", ruta_destino: "/evaluaciones" },
  contexto: { ip: "127.0.0.1", agente: "pruebas", request_id: "req-1" },
  ...extra,
});

describe("firma", () => {
  const ahora = 1_800_000_000;
  it("verifica, y rechaza texto alterado, secreto distinto, firma mala y marcas vencidas", () => {
    const f = firmar("hola", String(ahora), SECRETO);
    assert.equal(verificar({ texto: "hola", marca: String(ahora), firma: f, secreto: SECRETO, ahora }), true);
    assert.equal(verificar({ texto: "hola!", marca: String(ahora), firma: f, secreto: SECRETO, ahora }), false);
    assert.equal(verificar({ texto: "hola", marca: String(ahora), firma: f, secreto: "z".repeat(40), ahora }), false);
    for (const mala of [undefined, "", "zz", f.slice(2)]) assert.equal(verificar({ texto: "hola", marca: String(ahora), firma: mala, secreto: SECRETO, ahora }), false);
    const vieja = String(ahora - TOLERANCIA_SEGUNDOS - 1);
    assert.equal(verificar({ texto: "hola", marca: vieja, firma: firmar("hola", vieja, SECRETO), secreto: SECRETO, ahora }), false);
  });
});

describe("entorno", () => {
  it("exige el secreto (32+), credenciales completas o ninguna, y Firebase en producción", () => {
    assert.throws(() => cargarEntorno({}), /EVENTS_SHARED_SECRET es obligatoria/);
    assert.throws(() => cargarEntorno({ EVENTS_SHARED_SECRET: "corto" }), /mínimo 32/);
    assert.throws(() => cargarEntorno({ EVENTS_SHARED_SECRET: SECRETO, FIREBASE_PROJECT_ID: "p" }), /tres credenciales/);
    assert.throws(() => cargarEntorno({ EVENTS_SHARED_SECRET: SECRETO, NODE_ENV: "production" }), /obligatorias en production/);
    const e = cargarEntorno({ EVENTS_SHARED_SECRET: SECRETO });
    assert.deepEqual([e.PORT, e.FIRESTORE_PREFIX, e.usaFirestore], [4000, "", false]);
    assert.throws(() => cargarEntorno({ EVENTS_SHARED_SECRET: SECRETO, FIRESTORE_PREFIX: "no-valido!" }));
  });
});

describe("API HTTP del servicio", () => {
  let servidor, base, almacen, ahora;
  const pedirCrudo = async (ruta, { metodo = "GET", cuerpo, firmaDe, cabeceras = {} } = {}) => {
    const marca = String(ahora);
    const texto = cuerpo === undefined ? undefined : JSON.stringify(cuerpo);
    const firma = firmaDe === null ? undefined : firmar(firmaDe ?? texto ?? `${metodo} ${ruta}`, marca, SECRETO);
    const r = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...(texto ? { "Content-Type": "application/json" } : {}), "X-Timestamp": marca, ...(firma ? { "X-Signature": firma } : {}), ...cabeceras },
      body: texto,
    });
    const t = await r.text();
    return { estado: r.status, json: t ? JSON.parse(t) : null };
  };
  const enviar = (s, extra) => pedirCrudo("/events", { metodo: "POST", cuerpo: s, cabeceras: { "X-Event-Id": s.id }, ...extra });

  before(async () => {
    almacen = crearAlmacenMemoria();
    ahora = Math.floor(Date.now() / 1000);
    servidor = crearApp({ almacen, secreto: SECRETO, ahora: () => ahora }).listen(0);
    await new Promise((r) => servidor.once("listening", r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });
  after(async () => {
    await new Promise((r) => servidor.close(r));
  });

  it("las sondas responden sin firma", async () => {
    assert.equal((await pedirCrudo("/health", { firmaDe: null })).estado, 200);
    const ready = await pedirCrudo("/ready", { firmaDe: null });
    assert.equal(ready.estado, 200);
    assert.equal(ready.json.data.almacen, "memoria");
  });

  it("rechaza eventos sin firma, con firma ajena, con cuerpo alterado o fuera de tiempo", async () => {
    const s = sobre();
    assert.equal((await enviar(s, { firmaDe: null })).estado, 401);
    assert.equal((await enviar(s, { firmaDe: "otro texto" })).json.error.code, "INVALID_SIGNATURE");
    const vieja = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Timestamp": String(ahora - 3600), "X-Signature": firmar(JSON.stringify(s), String(ahora - 3600), SECRETO) },
      body: JSON.stringify(s),
    });
    assert.equal(vieja.status, 401);
    assert.equal(almacen.auditoria.length, 0);
  });

  it("valida el contrato del evento y el cuerpo", async () => {
    const mal = await enviar(sobre({ tipo: "otra.cosa" }));
    assert.equal(mal.estado, 400);
    assert.equal(mal.json.error.code, "INVALID_EVENT");
    assert.equal((await enviar(sobre({ id: "no-uuid" }))).estado, 400);
    assert.equal((await enviar(sobre({ version: 2 }))).estado, 400);
    assert.equal((await enviar(sobre({ destinatarios: [{}] }))).estado, 400);
    const vacio = await fetch(`${base}/events`, { method: "POST", headers: { "Content-Type": "application/json", "X-Timestamp": String(ahora), "X-Signature": "00" } });
    assert.equal(vacio.status, 400);
    const noJson = "{no es json";
    const r = await fetch(`${base}/events`, { method: "POST", headers: { "Content-Type": "application/json", "X-Timestamp": String(ahora), "X-Signature": firmar(noJson, String(ahora), SECRETO) }, body: noJson });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "INVALID_JSON");
    const s = sobre();
    assert.equal((await enviar(s, { cabeceras: { "X-Event-Id": uuid() } })).json.error.code, "EVENT_ID_MISMATCH");
  });

  it("una notificación crea una por destinatario (201) y reenviarla responde 409 sin duplicar", async () => {
    const s = sobre();
    const r = await enviar(s);
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.deepEqual([r.json.data.duplicado, r.json.data.notificaciones, r.json.data.auditorias], [false, 2, 0]);
    const otra = await enviar(s);
    assert.equal(otra.estado, 409);
    assert.equal(otra.json.data.duplicado, true);
    const a = await pedirCrudo("/users/uid-a/notifications");
    assert.equal(a.estado, 200);
    assert.equal(a.json.data.length, 1, "no se duplicó");
    assert.deepEqual(
      [a.json.data[0].tipo, a.json.data[0].titulo, a.json.data[0].prioridad, a.json.data[0].ruta_destino, a.json.data[0].leida],
      ["EVALUACION_PUBLICADA", "Tienes una evaluación nueva", "alta", "/evaluaciones", false]
    );
    assert.equal((await pedirCrudo("/users/uid-nadie/notifications")).json.data.length, 0);
  });

  it("un evento de auditoría guarda la huella con el formato del backend y no crea notificaciones", async () => {
    const s = sobre({
      tipo: "auditoria.ASIGNACION_CREADA", destinatarios: [],
      carga: { valor_anterior: { estado: "PLAZA_SELECCIONADA" }, valor_nuevo: { estado: "ACTIVA" } },
    });
    const r = await enviar(s);
    assert.equal(r.estado, 201);
    assert.deepEqual([r.json.data.auditorias, r.json.data.notificaciones], [1, 0]);
    const doc = almacen.auditoria.find((d) => d.evento_id === s.id);
    assert.deepEqual(
      [doc.accion, doc.entidad, doc.entidad_id, doc.actor_usuario_id, doc.actor_firebase_uid, doc.direccion_ip, doc.agente_usuario, doc.id_solicitud],
      ["ASIGNACION_CREADA", "evaluacion", s.entidad.id, "u-1", "uid-dir", "127.0.0.1", "pruebas", "req-1"]
    );
    assert.deepEqual(doc.valor_nuevo, { estado: "ACTIVA" });
    assert.equal(almacen.auditoria.filter((d) => d.evento_id === s.id).length, 1);
    await enviar(s);
    assert.equal(almacen.auditoria.filter((d) => d.evento_id === s.id).length, 1, "reenviar no duplica la auditoría");
  });

  it("marcar como leída es idempotente, solo afecta la bandeja del dueño y read-all marca el resto", async () => {
    const s1 = sobre({ destinatarios: [{ firebase_uid: "uid-c" }] });
    const s2 = sobre({ destinatarios: [{ firebase_uid: "uid-c" }] });
    await enviar(s1);
    await enviar(s2);
    const lista = (await pedirCrudo("/users/uid-c/notifications")).json.data;
    assert.equal(lista.length, 2);
    const id = lista[0].id;
    const ruta = `/users/uid-c/notifications/${id}/read`;
    const r = await pedirCrudo(ruta, { metodo: "PATCH" });
    assert.equal(r.estado, 200);
    assert.equal(r.json.data.leida, true);
    assert.ok(r.json.data.leida_en);
    assert.equal((await pedirCrudo(ruta, { metodo: "PATCH" })).json.data.leida_en, r.json.data.leida_en, "idempotente");
    assert.equal((await pedirCrudo(`/users/uid-d/notifications/${id}/read`, { metodo: "PATCH" })).estado, 404, "otra bandeja");
    const todas = await pedirCrudo("/users/uid-c/notifications/read-all", { metodo: "POST" });
    assert.equal(todas.json.data.marcadas, 1);
    assert.ok((await pedirCrudo("/users/uid-c/notifications")).json.data.every((n) => n.leida));
  });

  it("borra una o todas las notificaciones, solo de la bandeja del dueño", async () => {
    await enviar(sobre({ destinatarios: [{ firebase_uid: "uid-e" }] }));
    await enviar(sobre({ destinatarios: [{ firebase_uid: "uid-e" }] }));
    const lista = (await pedirCrudo("/users/uid-e/notifications")).json.data;
    assert.equal(lista.length, 2);
    assert.equal((await pedirCrudo(`/users/uid-f/notifications/${lista[0].id}`, { metodo: "DELETE" })).estado, 404, "otra bandeja");
    const una = await pedirCrudo(`/users/uid-e/notifications/${lista[0].id}`, { metodo: "DELETE" });
    assert.equal(una.estado, 200);
    assert.equal((await pedirCrudo(`/users/uid-e/notifications/${lista[0].id}`, { metodo: "DELETE" })).estado, 404, "ya no existe");
    const todas = await pedirCrudo("/users/uid-e/notifications", { metodo: "DELETE" });
    assert.deepEqual(todas.json.data, { eliminadas: 1 });
    assert.equal((await pedirCrudo("/users/uid-e/notifications")).json.data.length, 0);
  });

  it("las consultas exigen firma sobre el método y la ruta", async () => {
    assert.equal((await pedirCrudo("/users/uid-a/notifications", { firmaDe: null })).estado, 401);
    assert.equal((await pedirCrudo("/users/uid-a/notifications", { firmaDe: "GET /users/uid-b/notifications" })).estado, 401, "firma de otra ruta");
    assert.equal((await pedirCrudo("/users/uid-a/notifications", { metodo: "POST", firmaDe: "GET /users/uid-a/notifications" })).estado, 404);
  });

  it("rutas inexistentes responden 404 con el formato de error", async () => {
    const r = await pedirCrudo("/nada", { firmaDe: null });
    assert.equal(r.estado, 404);
    assert.equal(r.json.error.code, "NOT_FOUND");
  });

  it("si el almacén falla responde 500 para que el emisor reintente", async () => {
    const roto = crearAlmacenMemoria();
    roto.guardarEvento = async () => { throw new Error("caído"); };
    const app = crearApp({ almacen: roto, secreto: SECRETO, ahora: () => ahora });
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    const s = sobre();
    const texto = JSON.stringify(s);
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/events`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Timestamp": String(ahora), "X-Signature": firmar(texto, String(ahora), SECRETO) }, body: texto,
    });
    assert.equal(r.status, 500);
    assert.equal((await r.json()).error.code, "STORE_ERROR");
    await new Promise((res) => srv.close(res));
  });
});

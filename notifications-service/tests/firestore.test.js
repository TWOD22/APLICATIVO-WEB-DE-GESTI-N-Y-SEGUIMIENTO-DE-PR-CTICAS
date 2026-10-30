/**
 * Pruebas del almacén de Firestore contra un Firestore falso en memoria (mismas operaciones que usa el almacén).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crearAlmacenFirestore } from "../src/almacen/firestore.js";
import { procesarEvento } from "../src/procesador.js";

/** Firestore mínimo: colecciones anidadas, create/update, where/orderBy/limit y lotes atómicos. */
function crearFirestoreFalso() {
  const docs = new Map(); // ruta -> datos
  const existe = (ruta) => docs.has(ruta);
  const ref = (ruta) => ({
    path: ruta,
    id: ruta.split("/").at(-1),
    collection: (nombre) => coleccion(`${ruta}/${nombre}`),
    async get() { return { exists: existe(ruta), id: ruta.split("/").at(-1), ref: ref(ruta), data: () => ({ ...docs.get(ruta) }) }; },
    async update(c) { Object.assign(docs.get(ruta), c); },
  });
  const coleccion = (ruta) => {
    const filtros = [];
    let orden = null, tope = Infinity;
    const q = {
      doc: (id) => ref(`${ruta}/${id}`),
      where: (campo, _op, valor) => { filtros.push([campo, valor]); return q; },
      orderBy: (campo, dir) => { orden = [campo, dir]; return q; },
      limit: (n) => { tope = n; return q; },
      async get() {
        let filas = [...docs.entries()].filter(([r]) => r.startsWith(`${ruta}/`) && !r.slice(ruta.length + 1).includes("/")).map(([r, d]) => ({ id: r.split("/").at(-1), ref: ref(r), data: () => ({ ...d }) }));
        for (const [c, v] of filtros) filas = filas.filter((f) => f.data()[c] === v);
        if (orden) filas.sort((a, b) => (orden[1] === "desc" ? -1 : 1) * ((a.data()[orden[0]] > b.data()[orden[0]]) - (a.data()[orden[0]] < b.data()[orden[0]])));
        filas = filas.slice(0, tope);
        return { docs: filas, empty: filas.length === 0, size: filas.length };
      },
    };
    return q;
  };
  return {
    docs,
    collection: coleccion,
    batch() {
      const ops = [];
      return {
        create: (r, d) => ops.push(["create", r.path, d]),
        update: (r, d) => ops.push(["update", r.path, d]),
        async commit() {
          for (const [tipo, ruta] of ops) if (tipo === "create" && existe(ruta)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
          for (const [tipo, ruta, d] of ops) tipo === "create" ? docs.set(ruta, { ...d }) : Object.assign(docs.get(ruta), d);
        },
      };
    },
  };
}

const sobre = (id, destinatarios = ["uid-a"]) => ({
  id, tipo: "notificacion.PRACTICA_FINALIZADA", version: 1, ocurrido_en: "2026-10-27T12:00:00.000Z", actor: null,
  entidad: { tipo: "asignacion_practica", id }, destinatarios: destinatarios.map((firebase_uid) => ({ firebase_uid })),
  carga: { titulo: "Práctica finalizada", mensaje: "Felicitaciones" }, contexto: null,
});
const ID1 = "00000000-0000-4000-8000-000000000101";
const ID2 = "00000000-0000-4000-8000-000000000102";

describe("almacén de Firestore", () => {
  it("guarda la marca y las notificaciones (sin prefijo por defecto; con prefijo si se configura)", async () => {
    const plano = crearFirestoreFalso();
    await procesarEvento(sobre(ID2), crearAlmacenFirestore(plano));
    assert.ok(plano.docs.has(`eventos_procesados/${ID2}`));
    const db = crearFirestoreFalso();
    const almacen = crearAlmacenFirestore(db, { prefijo: "q2_" });
    const r = await procesarEvento(sobre(ID1, ["uid-a", "uid-b"]), almacen);
    assert.deepEqual(r, { duplicado: false, auditorias: 0, notificaciones: 2 });
    assert.ok(db.docs.has(`q2_eventos_procesados/${ID1}`));
    assert.ok(db.docs.has(`q2_notificaciones/uid-a/elementos/${ID1}_0`));
    assert.ok(db.docs.has(`q2_notificaciones/uid-b/elementos/${ID1}_1`));
    assert.ok(![...db.docs.keys()].some((k) => !k.startsWith("q2_")), "todo lleva el prefijo");
  });

  it("reprocesar el mismo evento es idempotente: el lote falla entero y no duplica nada", async () => {
    const db = crearFirestoreFalso();
    const almacen = crearAlmacenFirestore(db);
    await procesarEvento(sobre(ID1), almacen);
    const antes = db.docs.size;
    const r = await procesarEvento(sobre(ID1), almacen);
    assert.equal(r.duplicado, true);
    assert.equal(db.docs.size, antes);
  });

  it("guarda la auditoría con la huella completa", async () => {
    const db = crearFirestoreFalso();
    const almacen = crearAlmacenFirestore(db);
    const s = { ...sobre(ID1), tipo: "auditoria.PRACTICA_FINALIZADA", destinatarios: [], carga: { valor_nuevo: { estado: "FINALIZADA" } } };
    assert.deepEqual(await procesarEvento(s, almacen), { duplicado: false, auditorias: 1, notificaciones: 0 });
    const doc = db.docs.get(`auditoria/${ID1}`);
    assert.equal(doc.accion, "PRACTICA_FINALIZADA");
    assert.deepEqual(doc.valor_nuevo, { estado: "FINALIZADA" });
  });

  it("lista (más nueva primero), marca leída y marca todas", async () => {
    const db = crearFirestoreFalso();
    const almacen = crearAlmacenFirestore(db);
    await procesarEvento({ ...sobre(ID1), ocurrido_en: "2026-10-27T10:00:00.000Z" }, almacen);
    await procesarEvento({ ...sobre(ID2), ocurrido_en: "2026-10-27T11:00:00.000Z" }, almacen);
    const lista = await almacen.listarNotificaciones("uid-a");
    assert.deepEqual(lista.map((n) => n.id), [`${ID2}_0`, `${ID1}_0`]);
    assert.equal((await almacen.marcarLeida("uid-a", `${ID1}_0`)).leida, true);
    assert.equal(await almacen.marcarLeida("uid-a", "no-existe"), null);
    assert.equal(await almacen.marcarLeida("uid-b", `${ID2}_0`), null, "otra bandeja");
    assert.equal(await almacen.marcarTodasLeidas("uid-a"), 1);
    assert.equal(await almacen.marcarTodasLeidas("uid-a"), 0);
  });

  it("un error distinto de ALREADY_EXISTS se propaga para que el emisor reintente", async () => {
    const db = crearFirestoreFalso();
    db.batch = () => ({ create() {}, async commit() { throw Object.assign(new Error("UNAVAILABLE"), { code: 14 }); } });
    await assert.rejects(procesarEvento(sobre(ID1), crearAlmacenFirestore(db)), /UNAVAILABLE/);
  });

  it("disponible refleja si Firestore responde", async () => {
    const db = crearFirestoreFalso();
    assert.equal(await crearAlmacenFirestore(db).disponible(), true);
    db.collection = () => { throw new Error("sin conexión"); };
    assert.equal(await crearAlmacenFirestore(db).disponible(), false);
  });
});

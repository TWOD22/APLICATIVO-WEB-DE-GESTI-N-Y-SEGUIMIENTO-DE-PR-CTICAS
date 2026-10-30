/**
 * Prueba de humo contra el servicio que YA está corriendo (pnpm start) y su Firestore real.
 * Uso:  pnpm prueba   (con el servicio encendido en otra terminal)
 * Envía un evento firmado, lo repite (debe dar 409) y lee la notificación creada.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { firmar } from "../src/firma.js";

const base = `http://localhost:${process.env.PORT || 4000}`;
const secreto = process.env.EVENTS_SHARED_SECRET;
if (!secreto || secreto.length < 32) {
  console.error("Falta EVENTS_SHARED_SECRET (mínimo 32 caracteres) en .env");
  process.exit(1);
}

const marca = () => String(Math.floor(Date.now() / 1000));
const uid = "usuario-de-prueba";
const id = randomUUID();
const evento = {
  id, tipo: "notificacion.PRUEBA", version: 1, ocurrido_en: new Date().toISOString(),
  actor: null, entidad: { tipo: "prueba", id: "1" },
  destinatarios: [{ firebase_uid: uid }],
  carga: { titulo: "Prueba real", mensaje: "Si ves esto, Firestore funciona.", prioridad: "normal" },
  contexto: null,
};

async function enviar() {
  const texto = JSON.stringify(evento);
  const m = marca();
  const r = await fetch(`${base}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-timestamp": m, "x-signature": firmar(texto, m, secreto), "x-event-id": id },
    body: texto,
  });
  return { estado: r.status, cuerpo: await r.json() };
}

async function leer() {
  const ruta = `/users/${uid}/notifications`;
  const m = marca();
  const r = await fetch(`${base}${ruta}`, { headers: { "x-timestamp": m, "x-signature": firmar(`GET ${ruta}`, m, secreto) } });
  return { estado: r.status, cuerpo: await r.json() };
}

const ok = (c, t) => { console.log(`${c ? "✔" : "✘"} ${t}`); if (!c) process.exitCode = 1; };

const ready = await (await fetch(`${base}/ready`)).json();
ok(ready.data?.status === "ready" && ready.data?.almacen === "firestore", `/ready → ${JSON.stringify(ready.data)}`);

const a = await enviar();
ok(a.estado === 201, `Evento nuevo → ${a.estado} (esperado 201)`);
const b = await enviar();
ok(b.estado === 409, `Mismo evento otra vez → ${b.estado} (esperado 409, sin duplicar)`);
const l = await leer();
const mias = (l.cuerpo.data ?? []).filter((n) => n.id.startsWith(id));
ok(l.estado === 200 && mias.length === 1, `Notificación leída desde Firestore → ${mias.length} (esperada 1)`);
console.log(process.exitCode ? "\nHubo fallos: revisa la terminal del servicio." : "\nTodo bien. Revisa Firestore → Datos: colecciones eventos_procesados, auditoria y notificaciones.");

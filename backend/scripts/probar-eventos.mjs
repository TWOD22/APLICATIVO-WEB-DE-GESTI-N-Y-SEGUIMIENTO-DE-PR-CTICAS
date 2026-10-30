// Prueba de extremo a extremo de la Fase 5c con servicios REALES (Firebase, PostgreSQL y el servicio de notificaciones).
// Requiere: backend corriendo con EVENTS_MODE=outbox (pnpm dev) y el servicio de notificaciones corriendo (pnpm start allí).
// Hace: inicia sesión como Director → POST /auth/logout-all (genera un evento de auditoría) → espera al publicador →
// GET /notifications (la bandeja se lee del servicio 2). Luego revisa Firestore del proyecto de notificaciones: colección "auditoria".
// OJO: logout-all cierra tus sesiones abiertas (es normal; vuelve a iniciar sesión después).
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const clave = process.env.FIREBASE_WEB_API_KEY;
const puerto = process.env.PORT ?? "3000";
if (!clave) {
  console.error("Falta FIREBASE_WEB_API_KEY en el .env.");
  process.exit(1);
}
const api = `http://localhost:${puerto}/api/v1`;

const rl = readline.createInterface({ input, output });
const correo = (await rl.question("Correo del Director: ")).trim();
const contrasena = await rl.question("Contraseña (se verá al escribir): ");
rl.close();

const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(clave)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: correo, password: contrasena, returnSecureToken: true }),
});
const sesion = await login.json();
if (!login.ok) {
  console.error("Firebase rechazó el inicio de sesión:", sesion.error?.message ?? login.status);
  process.exit(1);
}
console.log("1) Inicio de sesión correcto.");
const cabeceras = { Authorization: `Bearer ${sesion.idToken}` };

const bandejaAntes = await fetch(`${api}/notifications`, { headers: cabeceras });
console.log(`2) GET /notifications -> HTTP ${bandejaAntes.status} (${bandejaAntes.ok ? "la bandeja respondió desde el servicio de notificaciones" : "falló: ¿está corriendo el servicio? ¿EVENTS_SHARED_SECRET igual en ambos?"})`);

const r = await fetch(`${api}/auth/logout-all`, { method: "POST", headers: cabeceras });
console.log(`3) POST /auth/logout-all -> HTTP ${r.status} (genera el evento auditoria.SESIONES_REVOCADAS)`);

console.log("4) Esperando 8 segundos a que el publicador envíe el evento…");
await new Promise((resolve) => setTimeout(resolve, 8000));
console.log("Listo. Ahora abre Firebase (proyecto de notificaciones) → Firestore → Datos: debe haber una colección «auditoria» con accion = SESIONES_REVOCADAS.");

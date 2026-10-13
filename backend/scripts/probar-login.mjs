// Prueba de extremo a extremo con Firebase REAL: inicia sesión con correo y contraseña
// y consulta GET /api/v1/me del backend. Requiere el servidor corriendo (pnpm dev) y
// FIREBASE_WEB_API_KEY en el .env (Firebase → Configuración del proyecto → General → Clave de API web).
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const clave = process.env.FIREBASE_WEB_API_KEY;
const puerto = process.env.PORT ?? "3000";
if (!clave) {
  console.error("Falta FIREBASE_WEB_API_KEY en el .env (Clave de API web del proyecto).");
  process.exit(1);
}

const rl = readline.createInterface({ input, output });
const correo = (await rl.question("Correo del Director: ")).trim();
const contrasena = await rl.question("Contraseña (se verá al escribir): ");
rl.close();

const login = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(clave)}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: correo, password: contrasena, returnSecureToken: true }),
  }
);
const sesion = await login.json();
if (!login.ok) {
  console.error("Firebase rechazó el inicio de sesión:", sesion.error?.message ?? login.status);
  process.exit(1);
}
console.log("1) Firebase aceptó el correo y la contraseña.");

const respuesta = await fetch(`http://localhost:${puerto}/api/v1/me`, {
  headers: { Authorization: `Bearer ${sesion.idToken}` },
});
const cuerpo = await respuesta.json();
console.log(`2) GET /api/v1/me -> HTTP ${respuesta.status}`);
console.log(JSON.stringify(cuerpo, null, 2));
process.exit(respuesta.ok ? 0 : 1);

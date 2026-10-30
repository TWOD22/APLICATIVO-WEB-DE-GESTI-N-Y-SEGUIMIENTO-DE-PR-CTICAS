// Datos de demostración del sistema (para mostrarlo completo a los docentes).
//
// Uso:
//   pnpm demo:crear       -> crea estudiantes, docentes, asesores, instituciones, solicitudes, bitácoras y evaluaciones
//   pnpm demo:limpiar     -> elimina SOLO lo creado por este script (todo lo que termina en @demo.udi.test y lo marcado «(demostración)»)
//   pnpm demo:reiniciar   -> limpia y vuelve a crear (deja la demostración como nueva, con fechas de hoy)
// Opciones:  --si                 no pide confirmación
//            --docente=correo     docente existente que será el de Práctica I (por defecto, el primero que haya)
//            --semilla=123        otro reparto al azar de los estados
// Todas las cuentas de demostración usan la contraseña 123456789.
//
// IMPORTANTE: escribe en la base de datos, en Firebase (cuentas) y en el almacenamiento (archivos) que indique el .env.
// Antes de correrlo contra la base real conviene sacar una copia (pg_dump).
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { cerrarPool, pool } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { limpiarDemo, sembrarDemo } from "../src/demo/sembrarDemo.js";
import { CONTRASENA_DEMO, DOMINIO_DEMO } from "../src/demo/catalogoDemo.js";

const [accion = "ayuda", ...resto] = process.argv.slice(2);
const opcion = (nombre) => resto.find((a) => a.startsWith(`--${nombre}=`))?.split("=").slice(1).join("=");
const sinConfirmar = resto.includes("--si");
const log = (m) => console.log(`  ${m}`);

const nombreBase = () => {
  try { return decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, "")) || "(sin nombre)"; } catch { return "(desconocida)"; }
};

async function confirmar(texto) {
  if (sinConfirmar) return;
  const base = nombreBase();
  console.log(`\n${texto}\nBase de datos: ${base}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = (await rl.question(`Para continuar escribe el nombre de la base de datos (${base}): `)).trim();
  rl.close();
  if (respuesta !== base) { console.log("Cancelado: el nombre no coincide. No se cambió nada."); process.exitCode = 1; throw new Error("cancelado"); }
}

const ayuda = () => console.log("Uso: pnpm demo:crear | demo:limpiar | demo:reiniciar   (opciones: --si, --docente=correo, --semilla=N)");

async function crear() {
  const inicio = Date.now();
  console.log("Creando datos de demostración (puede tardar unos minutos)…");
  const r = await sembrarDemo({ log, semilla: opcion("semilla") ? Number(opcion("semilla")) : undefined, docenteCorreo: opcion("docente") });
  const { cuentas } = r;
  const lineas = [
    `# Cuentas de demostración`, ``, `Contraseña de todas las cuentas de demostración: \`${CONTRASENA_DEMO}\``, ``,
    `## Docentes`, ...cuentas.docentes.map((d) => `- ${d.nombre} — ${d.correo}${d.nota ? ` (${d.nota})` : ""}`), ``,
    `## Asesores de sitio`, ...cuentas.asesores.map((a) => `- ${a.nombre} — ${a.correo}`), ``,
    `## Estudiantes (semestre · estado)`, ...cuentas.estudiantes.map((e) => `- ${e.nombre} — ${e.correo} · ${e.semestre}.º · ${e.estado}`), ``,
  ];
  await writeFile("demo-cuentas.md", lineas.join("\n"), "utf8");
  console.log(`\nListo en ${Math.round((Date.now() - inicio) / 1000)} s. Estados repartidos:`);
  for (const [estado, n] of Object.entries(r.resumenEstados).sort()) console.log(`  ${String(n).padStart(2)} · ${estado}`);
  console.log(`\nCuentas en demo-cuentas.md · contraseña de todas: ${CONTRASENA_DEMO} · dominio @${DOMINIO_DEMO}`);
}

async function limpiar() {
  console.log("Eliminando datos de demostración…");
  const r = await limpiarDemo({ log });
  for (const aviso of r.avisos) console.log(`  Aviso: ${aviso}`);
  console.log("Listo. Datos reales: sin tocar.");
}

try {
  if (accion === "crear") { await confirmar("Se van a CREAR datos de demostración (usuarios, instituciones, periodos anteriores, archivos y cuentas en Firebase)."); await crear(); }
  else if (accion === "limpiar") { await confirmar("Se van a ELIMINAR los datos de demostración (y sus cuentas y archivos)."); await limpiar(); }
  else if (accion === "reiniciar") { await confirmar("Se van a ELIMINAR y volver a CREAR los datos de demostración."); await limpiar(); await crear(); }
  else ayuda();
} catch (error) {
  if (error.message !== "cancelado") { console.error(`\nNo se pudo completar: ${error.message}`); process.exitCode = 1; }
} finally {
  await cerrarPool();
}

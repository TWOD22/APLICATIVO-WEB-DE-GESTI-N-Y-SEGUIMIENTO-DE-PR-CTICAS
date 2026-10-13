// Se carga antes de cualquier prueba (node --import ./tests/setup.js).
// Fuerza el entorno de pruebas ANTES de que se importe src/config/env.js.
import { readFileSync } from "node:fs";
import dotenv from "dotenv";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL_TEST ?? "silent";

// De .env se toma ÚNICAMENTE TEST_DATABASE_URL (nunca las credenciales de Firebase ni la base de desarrollo).
if (!process.env.TEST_DATABASE_URL) {
  try {
    const { TEST_DATABASE_URL } = dotenv.parse(readFileSync(".env"));
    if (TEST_DATABASE_URL) process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
  } catch {
    // sin .env: las pruebas de integración se omiten
  }
}

// Las pruebas nunca deben hablar con servicios reales: se anula Supabase aunque exista en .env
// (dotenv no sobrescribe variables ya definidas). Las pruebas del almacenamiento usan un fetch falso.
for (const clave of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_STORAGE_BUCKET"]) process.env[clave] = "";

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL; // las pruebas de integración se omiten si no hay base de pruebas

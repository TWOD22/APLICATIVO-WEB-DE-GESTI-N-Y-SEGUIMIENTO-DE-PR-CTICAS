/**
 * Variables de entorno.
 * Valida con Zod todo lo que llega desde .env o el sistema, aplica valores por defecto y
 * exige las credenciales de Firebase y Supabase en staging/producción.
 * Exporta `env` (objeto inmutable) y `cargarEntorno` (reutilizable en pruebas).
 */
import "dotenv/config";
import { z } from "zod";

// Convierte textos vacíos en undefined para tratar "variable sin valor" igual que "variable ausente".
const textoOpcional = z
  .string()
  .optional()
  .transform((valor) => (valor && valor.trim() !== "" ? valor : undefined));

// Las variables de entorno son texto: aquí se convierte "true"/"1" y "false"/"0" en booleanos reales.
const booleanoTexto = z
  .enum(["true", "false", "1", "0"])
  .transform((valor) => valor === "true" || valor === "1");

// Esquema con todas las variables que usa el backend y sus valores por defecto.
const esquemaEntorno = z
  .object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: textoOpcional,
    DATABASE_SSL: booleanoTexto.default("false"),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    FRONTEND_ORIGINS: z.string().default("http://localhost:5173,http://localhost:8443"),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    FIREBASE_PROJECT_ID: textoOpcional,
    FIREBASE_CLIENT_EMAIL: textoOpcional,
    FIREBASE_PRIVATE_KEY: textoOpcional,
    FIREBASE_STORAGE_BUCKET: textoOpcional,

    // Almacenamiento de archivos (documentos legales, evidencias, PDF exportados): Supabase Storage.
    SUPABASE_URL: textoOpcional,
    SUPABASE_SECRET_KEY: textoOpcional,
    SUPABASE_STORAGE_BUCKET: textoOpcional,

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    MAX_JSON_SIZE: z.string().default("1mb"),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  })
  // Reglas que dependen de varias variables a la vez.
  .superRefine((valores, ctx) => {
    if (valores.NODE_ENV !== "test" && !valores.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "DATABASE_URL es obligatoria" });
    }
    if (valores.SUPABASE_URL && !/^https:\/\/[^/\s]+$/.test(valores.SUPABASE_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_URL"],
        message: "SUPABASE_URL debe ser https://<proyecto>.supabase.co (sin '/' final ni rutas)",
      });
    }
    // En staging y producción las credenciales externas son obligatorias y no se permite apuntar a localhost.
    if (["staging", "production"].includes(valores.NODE_ENV)) {
      for (const clave of [
        "FIREBASE_PROJECT_ID",
        "FIREBASE_CLIENT_EMAIL",
        "FIREBASE_PRIVATE_KEY",
        "SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_STORAGE_BUCKET",
      ]) {
        if (!valores[clave]) {
          ctx.addIssue({ code: "custom", path: [clave], message: `${clave} es obligatoria en ${valores.NODE_ENV}` });
        }
      }
      if (valores.FRONTEND_ORIGINS.includes("localhost")) {
        ctx.addIssue({
          code: "custom",
          path: ["FRONTEND_ORIGINS"],
          message: "FRONTEND_ORIGINS no debe incluir localhost en staging o producción",
        });
      }
    }
  });

/**
 * Valida y normaliza las variables de entorno. Lanza un Error con la lista de
 * problemas (sin imprimir valores) si la configuración no es válida.
 */
export function cargarEntorno(fuente = process.env) {
  const resultado = esquemaEntorno.safeParse(fuente);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((issue) => `- ${issue.path.join(".") || "(general)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuración de entorno inválida:\n${problemas}`);
  }
  const valores = resultado.data;
  return Object.freeze({
    ...valores,
    FRONTEND_ORIGINS: valores.FRONTEND_ORIGINS.split(",")
      .map((origen) => origen.trim())
      .filter(Boolean),
    esProduccion: valores.NODE_ENV === "production",
    esTest: valores.NODE_ENV === "test",
  });
}

// Objeto de configuración que usa el resto del backend: import { env } from "./config/env.js".
export const env = cargarEntorno();

/**
 * Variables de entorno del servicio. Falla al arrancar si la configuración es inválida (sin imprimir secretos).
 */
import "dotenv/config";
import { z } from "zod";

const texto = z.string().optional().transform((v) => (v && v.trim() !== "" ? v : undefined));

const esquema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    EVENTS_SHARED_SECRET: texto,
    FIREBASE_PROJECT_ID: texto,
    FIREBASE_CLIENT_EMAIL: texto,
    FIREBASE_PRIVATE_KEY: texto,
    FIRESTORE_PREFIX: z.string().regex(/^[A-Za-z0-9_]*$/, "Solo letras, números y guion bajo").default(""),
  })
  .superRefine((v, ctx) => {
    if (!v.EVENTS_SHARED_SECRET || v.EVENTS_SHARED_SECRET.length < 32) {
      ctx.addIssue({ code: "custom", path: ["EVENTS_SHARED_SECRET"], message: "EVENTS_SHARED_SECRET es obligatoria (mínimo 32 caracteres)" });
    }
    const credenciales = [v.FIREBASE_PROJECT_ID, v.FIREBASE_CLIENT_EMAIL, v.FIREBASE_PRIVATE_KEY].filter(Boolean).length;
    if (credenciales !== 0 && credenciales !== 3) {
      ctx.addIssue({ code: "custom", path: ["FIREBASE_PROJECT_ID"], message: "Define las tres credenciales de Firebase o ninguna" });
    }
    if (["staging", "production"].includes(v.NODE_ENV) && credenciales === 0) {
      ctx.addIssue({ code: "custom", path: ["FIREBASE_PROJECT_ID"], message: `Las credenciales de Firebase son obligatorias en ${v.NODE_ENV}` });
    }
  });

export function cargarEntorno(fuente = process.env) {
  const r = esquema.safeParse(fuente);
  if (!r.success) {
    throw new Error(`Configuración de entorno inválida:\n${r.error.issues.map((i) => `- ${i.path.join(".") || "(general)"}: ${i.message}`).join("\n")}`);
  }
  return Object.freeze({ ...r.data, usaFirestore: Boolean(r.data.FIREBASE_PROJECT_ID) });
}

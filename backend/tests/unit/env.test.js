/**
 * Pruebas unitarias de la validación de variables de entorno.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cargarEntorno } from "../../src/config/env.js";

const FIREBASE = {
  FIREBASE_PROJECT_ID: "proyecto",
  FIREBASE_CLIENT_EMAIL: "svc@proyecto.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "clave",
};

const SUPABASE = {
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  SUPABASE_STORAGE_BUCKET: "archivos",
};

describe("cargarEntorno", () => {
  it("aplica valores por defecto en pruebas sin DATABASE_URL", () => {
    const env = cargarEntorno({ NODE_ENV: "test" });
    assert.equal(env.PORT, 3000);
    assert.equal(env.SIGNED_URL_TTL_SECONDS, 900);
    assert.equal(env.MAX_JSON_SIZE, "1mb");
    assert.equal(env.esTest, true);
    assert.equal(env.DATABASE_SSL, false);
  });

  it("exige DATABASE_URL fuera de pruebas", () => {
    assert.throws(() => cargarEntorno({ NODE_ENV: "development" }), /DATABASE_URL/);
  });

  it("separa los orígenes permitidos", () => {
    const env = cargarEntorno({ NODE_ENV: "test", FRONTEND_ORIGINS: "https://a.com, https://b.com" });
    assert.deepEqual(env.FRONTEND_ORIGINS, ["https://a.com", "https://b.com"]);
  });

  it("en producción exige Firebase y rechaza localhost en CORS", () => {
    assert.throws(
      () => cargarEntorno({ NODE_ENV: "production", DATABASE_URL: "postgresql://x/y" }),
      /FIREBASE_PROJECT_ID/
    );
    assert.throws(
      () => cargarEntorno({ NODE_ENV: "production", DATABASE_URL: "postgresql://x/y", ...FIREBASE, ...SUPABASE }),
      /localhost/
    );
    const ok = cargarEntorno({
      NODE_ENV: "production", DATABASE_URL: "postgresql://x/y", FRONTEND_ORIGINS: "https://app.udi.edu.co", ...FIREBASE, ...SUPABASE,
    });
    assert.equal(ok.esProduccion, true);
  });

  it("en producción exige la configuración de Supabase Storage", () => {
    assert.throws(
      () => cargarEntorno({ NODE_ENV: "production", DATABASE_URL: "postgresql://x/y", FRONTEND_ORIGINS: "https://a.co", ...FIREBASE }),
      /SUPABASE_URL/
    );
  });

  it("rechaza una SUPABASE_URL con '/' final o ruta", () => {
    assert.throws(() => cargarEntorno({ NODE_ENV: "test", SUPABASE_URL: "https://p.supabase.co/" }), /SUPABASE_URL/);
    assert.throws(() => cargarEntorno({ NODE_ENV: "test", SUPABASE_URL: "https://p.supabase.co/rest/v1" }), /SUPABASE_URL/);
    assert.doesNotThrow(() => cargarEntorno({ NODE_ENV: "test", SUPABASE_URL: "https://p.supabase.co" }));
  });

  it("no imprime valores secretos al fallar", () => {
    try {
      cargarEntorno({ NODE_ENV: "production", DATABASE_URL: "postgresql://usuario:SECRETO@x/y", FIREBASE_PRIVATE_KEY: "SECRETO-KEY" });
      assert.fail("debía lanzar");
    } catch (error) {
      assert.doesNotMatch(error.message, /SECRETO/);
    }
  });

  it("rechaza valores numéricos inválidos", () => {
    assert.throws(() => cargarEntorno({ NODE_ENV: "test", PORT: "abc" }), /PORT/);
  });
});

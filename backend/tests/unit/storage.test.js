/**
 * Pruebas unitarias del adaptador de almacenamiento (Supabase) con un fetch falso.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

// Cada archivo de prueba corre en su propio proceso: estas variables solo afectan a este archivo.
process.env.SUPABASE_URL = "https://proyecto.supabase.co";
process.env.SUPABASE_SECRET_KEY = "sb_secret_de_prueba";
process.env.SUPABASE_STORAGE_BUCKET = "archivos-test";

const { sustituirSupabaseParaPruebas } = await import("../../src/config/supabase.js");
const { subirArchivo, crearUrlFirmada, eliminarArchivo, almacenamientoDisponible } = await import(
  "../../src/adapters/storageAdapter.js"
);

const json = (cuerpo, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado });
let llamadas;
let responder;

beforeEach(() => {
  llamadas = [];
  responder = () => json({});
  sustituirSupabaseParaPruebas(async (url, opciones) => {
    llamadas.push({ url, ...opciones });
    return responder(url, opciones);
  });
});

describe("storageAdapter (Supabase Storage)", () => {
  it("sube un archivo con la clave secreta en apikey (sin Authorization para sb_secret_)", async () => {
    const resultado = await subirArchivo({
      ruta: "documentos_legales/a b/c.pdf",
      contenido: Buffer.from("pdf"),
      tipoMime: "application/pdf",
    });
    assert.deepEqual(resultado, { bucket: "archivos-test", ruta: "documentos_legales/a b/c.pdf" });
    const [llamada] = llamadas;
    assert.equal(llamada.url, "https://proyecto.supabase.co/storage/v1/object/archivos-test/documentos_legales/a%20b/c.pdf");
    assert.equal(llamada.method, "POST");
    assert.equal(llamada.headers.apikey, "sb_secret_de_prueba");
    assert.equal(llamada.headers.Authorization, undefined);
    assert.equal(llamada.headers["Content-Type"], "application/pdf");
  });

  it("crea una URL firmada absoluta con la vigencia indicada", async () => {
    responder = () => json({ signedURL: "/object/sign/archivos-test/x.pdf?token=abc" });
    const r = await crearUrlFirmada("x.pdf", { segundos: 600 });
    assert.equal(r.url, "https://proyecto.supabase.co/storage/v1/object/sign/archivos-test/x.pdf?token=abc");
    assert.equal(r.expira_en_segundos, 600);
    assert.deepEqual(JSON.parse(llamadas[0].body), { expiresIn: 600 });
  });

  it("elimina un archivo por prefijo exacto", async () => {
    await eliminarArchivo("x.pdf");
    assert.equal(llamadas[0].method, "DELETE");
    assert.deepEqual(JSON.parse(llamadas[0].body), { prefixes: ["x.pdf"] });
  });

  it("traduce fallos de Supabase a STORAGE_ERROR (502) sin filtrar detalles", async () => {
    responder = () => json({ message: "secreto interno" }, 500);
    await assert.rejects(subirArchivo({ ruta: "x.pdf", contenido: Buffer.from("a"), tipoMime: "application/pdf" }), (e) => {
      assert.equal(e.codigo, "STORAGE_ERROR");
      assert.equal(e.estado_http, 502);
      assert.doesNotMatch(e.message, /secreto/);
      return true;
    });
  });

  it("traduce errores de red a STORAGE_ERROR", async () => {
    responder = () => {
      throw new Error("ECONNRESET");
    };
    await assert.rejects(crearUrlFirmada("x.pdf"), (e) => e.codigo === "STORAGE_ERROR");
  });

  it("almacenamientoDisponible: true con bucket privado", async () => {
    responder = () => json({ id: "archivos-test", public: false });
    assert.equal(await almacenamientoDisponible(), true);
    assert.equal(llamadas[0].url, "https://proyecto.supabase.co/storage/v1/bucket/archivos-test");
  });

  it("almacenamientoDisponible: false si el bucket es público, no existe o hay error de red", async () => {
    responder = () => json({ id: "archivos-test", public: true });
    assert.equal(await almacenamientoDisponible(), false);
    responder = () => json({ message: "Bucket not found" }, 404);
    assert.equal(await almacenamientoDisponible(), false);
    responder = () => {
      throw new Error("timeout");
    };
    assert.equal(await almacenamientoDisponible(), false);
  });
});

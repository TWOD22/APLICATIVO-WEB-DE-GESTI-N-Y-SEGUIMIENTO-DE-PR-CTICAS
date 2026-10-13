// Prueba REAL del almacenamiento (Supabase Storage): sube un PDF mínimo, genera una URL firmada,
// la descarga, comprueba que el bucket es privado y borra el archivo de prueba.
// Uso: pnpm probar:storage   (requiere SUPABASE_URL, SUPABASE_SECRET_KEY y SUPABASE_STORAGE_BUCKET en .env)
import { createHash, randomUUID } from "node:crypto";
import { almacenamientoDisponible, crearUrlFirmada, eliminarArchivo, subirArchivo } from "../src/adapters/storageAdapter.js";
import { env } from "../src/config/env.js";
import { supabaseConfigurado } from "../src/config/supabase.js";

if (!supabaseConfigurado()) {
  console.error("Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o SUPABASE_STORAGE_BUCKET en el .env.");
  process.exit(1);
}

const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
const huella = (b) => createHash("sha256").update(b).digest("hex").slice(0, 12);
const ruta = `pruebas/${randomUUID()}.pdf`;
let fallos = 0;
const paso = (ok, texto) => {
  console.log(`${ok ? "✔" : "✖"} ${texto}`);
  if (!ok) fallos += 1;
};

try {
  paso(await almacenamientoDisponible(), "El bucket existe y es privado (sonda de /ready)");

  await subirArchivo({ ruta, contenido: pdf, tipoMime: "application/pdf" });
  paso(true, `Subida correcta (${pdf.length} bytes) → ${ruta}`);

  const { url, expira_en_segundos: segundos } = await crearUrlFirmada(ruta, { segundos: 60 });
  paso(url.startsWith(`${env.SUPABASE_URL}/storage/v1/object/sign/`), `URL firmada generada (vence en ${segundos} s)`);

  const descarga = await fetch(url);
  const bytes = Buffer.from(await descarga.arrayBuffer());
  paso(descarga.ok && huella(bytes) === huella(pdf), "La URL firmada devuelve exactamente el mismo archivo");

  const sinFirma = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public/${env.SUPABASE_STORAGE_BUCKET}/${ruta}`);
  paso(!sinFirma.ok, `Sin firma el archivo NO es accesible (HTTP ${sinFirma.status})`);

  await eliminarArchivo(ruta);
  paso(true, "Archivo de prueba eliminado");
  const trasBorrar = await fetch(url);
  paso(!trasBorrar.ok, `Tras borrarlo la URL ya no sirve (HTTP ${trasBorrar.status})`);
} catch (error) {
  paso(false, `Error inesperado: ${error.codigo ?? error.code ?? ""} ${error.message}`);
  try {
    await eliminarArchivo(ruta);
  } catch {
    // limpieza de mejor esfuerzo
  }
}

console.log(fallos === 0 ? "\nTODO CORRECTO: el almacenamiento funciona." : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);

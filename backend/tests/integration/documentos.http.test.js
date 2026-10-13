/**
 * Pruebas HTTP de documentos legales: carga de PDF, revisión del Director, descarga firmada y auditoría documental.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");

/**
 * Pruebas HTTP del flujo de documentos legales: cuerpo binario (express.raw), cabeceras, autenticación y roles.
 * El almacenamiento y Firebase se sustituyen por versiones en memoria.
 */
describe("API HTTP · documentos legales", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, servidor, base, firebase;
  let tokenDirector, tokenEstudiante, tokenDocente, asignacionId, tipoCedula;

  const pedir = async (ruta, { token, metodo = "GET", cuerpo, cabeceras = {} } = {}) => {
    const esJson = cuerpo !== undefined && !Buffer.isBuffer(cuerpo) && typeof cuerpo !== "string";
    const respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: {
        ...(esJson ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...cabeceras,
      },
      body: cuerpo === undefined ? undefined : esJson ? JSON.stringify(cuerpo) : cuerpo,
    });
    const texto = await respuesta.text();
    return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
  };
  const subirPdf = (token, contenido = PDF, nombre = "Cédula ñandú.pdf", tipo = tipoCedula) =>
    pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents/${tipo}/upload`, {
      token, metodo: "POST", cuerpo: contenido,
      cabeceras: { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(nombre) },
    });

  before(async () => {
    ({ pool, cerrarPool } = await import("../../src/config/database.js"));
    const { ejecutarSeedBase } = await import("../../src/database/seeds/base.js");
    const { sustituirFirebaseParaPruebas } = await import("../../src/config/firebase.js");
    const { sustituirAlmacenamientoParaPruebas } = await import("../../src/adapters/storageAdapter.js");
    const { crearApp } = await import("../../src/app.js");

    firebase = crearFirebaseFalso();
    sustituirFirebaseParaPruebas(firebase.implementacion);
    sustituirAlmacenamientoParaPruebas({
      subirArchivo: async ({ ruta }) => ({ bucket: "bucket-test", ruta }),
      crearUrlFirmada: async (ruta, { segundos }) => ({ url: `https://storage.test/${ruta}?token=abc`, expira_en_segundos: segundos }),
      eliminarArchivo: async () => {},
      almacenamientoDisponible: async () => true,
    });
    await reconstruirEsquema(pool);
    await limpiarYSembrar(pool, ejecutarSeedBase, {
      director: { firebase_uid: "uid-director", documento: "10203040", nombres: "Dora", apellidos: "Directora", correo: "director@udi.test" },
    });
    tokenDirector = firebase.emitirToken("uid-director");
    servidor = crearApp().listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;

    const crear = async (cuerpo) => {
      const r = await pedir("/api/v1/users", { token: tokenDirector, metodo: "POST", cuerpo });
      assert.equal(r.estado, 201, JSON.stringify(r.json));
      const uid = (await pool.query("SELECT firebase_uid FROM usuarios WHERE id = $1", [r.json.data.id])).rows[0].firebase_uid;
      return { id: r.json.data.id, token: firebase.emitirToken(uid) };
    };
    const estudiante = await crear({ rol: "ESTUDIANTE", documento: "2000000001", nombres: "Laura", apellidos: "Aguilar", correo: "laura@udi.test", semestre: 1 });
    const docente = await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    tokenEstudiante = estudiante.token;
    tokenDocente = docente.token;

    const inst = await pedir("/api/v1/institutions", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" },
    });
    const nivel = (await pedir("/api/v1/practice-levels", { token: tokenDirector })).json.data.find((n) => n.semestre === 1);
    const asignacion = await pedir("/api/v1/practice-assignments", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { estudiante_id: estudiante.id, nivel_practica_id: nivel.id, institucion_id: inst.json.data.id, docente_supervisor_id: docente.id },
    });
    assert.equal(asignacion.estado, 201, JSON.stringify(asignacion.json));
    asignacionId = asignacion.json.data.id;
    tipoCedula = (await pool.query("SELECT id FROM tipos_documento_legal WHERE codigo = 'CEDULA'")).rows[0].id;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (cerrarPool) await cerrarPool();
  });

  it("la carga exige sesión y rol de estudiante", async () => {
    assert.equal((await subirPdf(undefined)).estado, 401);
    assert.equal((await subirPdf(tokenDocente)).estado, 403);
    assert.equal((await subirPdf(tokenDirector)).estado, 403);
  });

  it("sin cuerpo PDF (otro Content-Type) responde FILE_REQUIRED", async () => {
    const r = await pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents/${tipoCedula}/upload`, {
      token: tokenEstudiante, metodo: "POST", cuerpo: "hola", cabeceras: { "Content-Type": "text/plain" },
    });
    assert.equal(r.estado, 400);
    assert.equal(r.json.error.code, "FILE_REQUIRED");
  });

  it("un archivo que dice ser PDF pero no lo es se rechaza", async () => {
    const r = await subirPdf(tokenEstudiante, Buffer.from("MZ esto es un ejecutable"));
    assert.equal(r.estado, 422);
    assert.equal(r.json.error.code, "FILE_NOT_READABLE");
  });

  it("el estudiante sube un PDF por HTTP y el nombre llega decodificado", async () => {
    const r = await subirPdf(tokenEstudiante);
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.data.estado, "EN_REVISION");
    assert.equal(r.json.data.archivo.nombre, "Cédula ñandú.pdf");
    assert.equal(r.json.data.archivo.tamano_bytes, PDF.length);
    assert.ok(r.json.meta.request_id);
  });

  it("el estudiante consulta su expediente; docente no tiene acceso", async () => {
    const r = await pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents`, { token: tokenEstudiante });
    assert.equal(r.estado, 200);
    assert.equal(r.json.data.documentos.length, 4);
    assert.equal(r.json.data.resumen.en_revision, 1);
    assert.equal(r.json.data.resumen.sin_cargar, 3);
    const docente = await pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents`, { token: tokenDocente });
    assert.equal(docente.estado, 403);
    assert.equal(docente.json.error.code, "FORBIDDEN");
  });

  it("solo Dirección revisa; rechazar exige observación", async () => {
    const lista = await pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents`, { token: tokenDirector });
    const documentoId = lista.json.data.documentos.find((d) => d.tipo.codigo === "CEDULA").documento_id;
    const ruta = `/api/v1/legal-documents/${documentoId}/review`;
    assert.equal((await pedir(ruta, { token: tokenEstudiante, metodo: "POST", cuerpo: { decision: "APROBAR" } })).estado, 403);
    const sinObservacion = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { decision: "RECHAZAR" } });
    assert.equal(sinObservacion.estado, 400);
    assert.equal(sinObservacion.json.error.code, "VALIDATION_ERROR");
    const rechazo = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { decision: "RECHAZAR", observacion: "El archivo no es legible" } });
    assert.equal(rechazo.estado, 200);
    assert.equal(rechazo.json.data.estado, "POR_CORREGIR");
  });

  it("descarga: URL firmada para Dirección, prohibida para docente", async () => {
    const lista = await pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents`, { token: tokenDirector });
    const documentoId = lista.json.data.documentos.find((d) => d.tipo.codigo === "CEDULA").documento_id;
    const ok = await pedir(`/api/v1/legal-documents/${documentoId}/download-url`, { token: tokenDirector });
    assert.equal(ok.estado, 200);
    assert.match(ok.json.data.url, /^https:\/\/storage\.test\//);
    assert.equal((await pedir(`/api/v1/legal-documents/${documentoId}/download-url`, { token: tokenDocente })).estado, 403);
  });

  it("auditoría documental y aprobación del expediente", async () => {
    const exp = await pedir("/api/v1/legal-documents/expedientes?estado=POR_CORREGIR", { token: tokenDirector });
    assert.equal(exp.estado, 200);
    assert.equal(exp.json.meta.total, 1);
    assert.equal(exp.json.meta.resumen.por_corregir, 1);
    assert.equal(exp.json.data[0].estudiante.nombre_completo, "Laura Aguilar");
    assert.equal((await pedir("/api/v1/legal-documents/expedientes", { token: tokenEstudiante })).estado, 403);
    const aprobar = await pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents/approve-all`, { token: tokenDirector, metodo: "POST" });
    assert.equal(aprobar.estado, 422);
    assert.equal(aprobar.json.error.code, "REJECTED_DOCUMENT_EXISTS");
  });
});

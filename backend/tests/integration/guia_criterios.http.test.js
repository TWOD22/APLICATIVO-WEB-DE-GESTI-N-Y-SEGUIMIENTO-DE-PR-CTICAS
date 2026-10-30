/**
 * Pruebas HTTP de la guía de criterios (Fase 3b del flujo v2): el docente del nivel sube el PDF (versionado) y lo leen
 * Director, docente del nivel, estudiantes del nivel y asesores con practicantes en él.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
const pdfNumero = (n) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${n}\n`, "latin1"), PDF.subarray(9)]);

describe("API HTTP · guía de criterios", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, servidor, base, firebase;
  let docente2, tokenDirector, docente, estudiantes, niveles, tiposObligatorios;
  let instDosAsesores, instUnAsesor, instSinAsesor, instEnTramite, asesorA, asesorB, asesorUnico;

  const pedir = async (ruta, { token, metodo = "GET", cuerpo, cabeceras = {} } = {}) => {
    const esJson = cuerpo !== undefined && !Buffer.isBuffer(cuerpo);
    const respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...(esJson ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...cabeceras },
      body: cuerpo === undefined ? undefined : esJson ? JSON.stringify(cuerpo) : cuerpo,
    });
    const texto = await respuesta.text();
    return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
  };
  const nivel = (codigo) => niveles.find((n) => n.codigo === codigo);
  let contadorPdf = 0;
  const subir = (est, asignacionId, tipoId) =>
    pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents/${tipoId}/upload`, {
      token: est.token, metodo: "POST", cuerpo: pdfNumero(++contadorPdf),
      cabeceras: { "Content-Type": "application/pdf", "X-File-Name": "documento.pdf" },
    });
  const estadoDe = async (id) => (await pool.query("SELECT estado FROM asignaciones_practica WHERE id = $1", [id])).rows[0].estado;
  const eventos = (tipo) => firebase.estado.eventos.filter((e) => e.ruta.startsWith("notificaciones_usuario/") && e.tipo === tipo);

  /** Deja una solicitud ENVIADA con la plaza elegida y todos los documentos cargados. */
  const solicitudEnviada = async (est, institucionId = instUnAsesor) => {
    const creada = await pedir("/api/v1/practice-requests", { token: est.token, metodo: "POST", cuerpo: { nivel_practica_id: nivel("PP1").id } });
    assert.equal(creada.estado, 201, JSON.stringify(creada.json));
    const id = creada.json.data.id;
    assert.equal((await elegir(est, id, institucionId)).estado, 200);
    for (const tipo of tiposObligatorios) assert.equal((await subir(est, id, tipo)).estado, 201);
    const enviada = await pedir(`/api/v1/practice-requests/${id}/submit`, { token: est.token, metodo: "POST" });
    assert.equal(enviada.estado, 200, JSON.stringify(enviada.json));
    return id;
  };
  const aprobarTodo = (id) => pedir(`/api/v1/practice-assignments/${id}/legal-documents/approve-all`, { token: tokenDirector, metodo: "POST" });
  const elegir = (est, id, institucionId) =>
    pedir(`/api/v1/practice-requests/${id}/site`, { token: est.token, metodo: "PATCH", cuerpo: { institucion_id: institucionId } });
  const asignar = (id, cuerpo = {}) => pedir(`/api/v1/practice-requests/${id}/assign`, { token: tokenDirector, metodo: "POST", cuerpo });
  /** Lleva una solicitud a «lista para asignar»: ENVIADA con plaza pedida y documentos aprobados. */
  const listaParaAsignar = async (est, institucionId) => {
    const id = await solicitudEnviada(est, institucionId);
    assert.equal((await aprobarTodo(id)).estado, 200);
    return id;
  };

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
      crearUrlFirmada: async (ruta, { segundos }) => ({ url: `https://storage.test/${ruta}`, expira_en_segundos: segundos }),
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
    const inst = async (nombre, nit, estado = "VIGENTE") => {
      const r = await pedir("/api/v1/institutions", {
        token: tokenDirector, metodo: "POST",
        cuerpo: { nombre, nit, ciudad: "Bucaramanga", correo: `${nit}@jardin.test`, estado_convenio: estado },
      });
      assert.equal(r.estado, 201, JSON.stringify(r.json));
      return r.json.data.id;
    };
    estudiantes = [];
    for (let i = 1; i <= 5; i++) {
      estudiantes.push(await crear({ rol: "ESTUDIANTE", documento: `200000000${i}`, nombres: `Estudiante${i}`, apellidos: `Prueba${i}`, correo: `est${i}@udi.test`, semestre: 1 }));
    }
    docente = await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    instDosAsesores = await inst("Jardín Dos Asesores", "900000001-1");
    instUnAsesor = await inst("Jardín Un Asesor", "900000002-2");
    instSinAsesor = await inst("Jardín Sin Asesor", "900000003-3");
    instEnTramite = await inst("Jardín En Trámite", "900000004-4", "EN_TRAMITE");
    asesorA = await crear({ rol: "ASESOR_SITIO", documento: "4000000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: instDosAsesores });
    asesorB = await crear({ rol: "ASESOR_SITIO", documento: "4000000002", nombres: "Beatriz", apellidos: "Ríos", correo: "bea@jardin.test", institucion_id: instDosAsesores });
    asesorUnico = await crear({ rol: "ASESOR_SITIO", documento: "4000000003", nombres: "Carla", apellidos: "Mora", correo: "carla@jardin.test", institucion_id: instUnAsesor });
    docente2 = await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000002", nombres: "Claudia", apellidos: "Martínez", correo: "claudia@udi.test" });
    niveles = (await pedir("/api/v1/practice-levels", { token: tokenDirector })).json.data;
    tiposObligatorios = (await pool.query(
      `SELECT DISTINCT r.tipo_documento_legal_id AS id FROM requisitos_documentales r
        WHERE r.nivel_practica_id = $1 AND r.obligatorio AND r.eliminado_en IS NULL`, [nivel("PP1").id]
    )).rows.map((f) => f.id);
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (cerrarPool) await cerrarPool();
  });

  let periodoId, asignacionActiva;
  const ruta = (nivelId) => `/api/v1/levels/${nivelId}/periods/${periodoId}/criteria-guide`;
  const subirGuia = (token, nivelId, contenido = pdfNumero(900), cabeceras = {}) =>
    pedir(ruta(nivelId), { token, metodo: "POST", cuerpo: contenido, cabeceras: { "Content-Type": "application/pdf", "X-File-Name": "criterios.pdf", ...cabeceras } });

  it("prepara: docente en PP1 y una práctica ACTIVA de un estudiante con su asesor", async () => {
    periodoId = (await pedir("/api/v1/periods", { token: tokenDirector })).json.data.find((p) => p.es_activo).id;
    assert.equal((await pedir(`/api/v1/level-teachers/${nivel("PP1").id}`, { token: tokenDirector, metodo: "PUT", cuerpo: { docente_id: docente.id } })).estado, 200);
    asignacionActiva = await solicitudEnviada(estudiantes[0]);
    assert.equal((await aprobarTodo(asignacionActiva)).estado, 200);
    const r = await asignar(asignacionActiva);
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.estado, "ACTIVA");
  });

  it("sin guía todavía: quien puede leerla recibe guia null", async () => {
    const r = await pedir(ruta(nivel("PP1").id), { token: docente.token });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.guia, null);
    assert.deepEqual(r.json.data.versiones, []);
  });

  it("solo el docente de ese nivel sube la guía (sin sesión 401; Director, estudiante, asesor y otro docente 403)", async () => {
    assert.equal((await pedir(ruta(nivel("PP1").id), { metodo: "POST", cuerpo: PDF, cabeceras: { "Content-Type": "application/pdf" } })).estado, 401);
    for (const t of [tokenDirector, estudiantes[0].token, asesorUnico.token]) {
      assert.equal((await subirGuia(t, nivel("PP1").id)).estado, 403);
    }
    const otro = await subirGuia(docente2.token, nivel("PP1").id);
    assert.equal(otro.estado, 403);
    assert.equal(otro.json.error.code, "NOT_LEVEL_TEACHER");
    const otroNivel = await subirGuia(docente.token, nivel("PP2").id);
    assert.equal(otroNivel.estado, 403, "el docente de PP1 no gestiona PP2");
  });

  it("valida el archivo: vacío, no PDF, extensión y firma falsa", async () => {
    const codigo = (r) => r.json?.error?.code;
    assert.equal(codigo(await subirGuia(docente.token, nivel("PP1").id, Buffer.alloc(0))), "FILE_REQUIRED");
    assert.equal(codigo(await subirGuia(docente.token, nivel("PP1").id, PDF, { "X-File-Name": "criterios.docx" })), "FILE_EXTENSION_NOT_ALLOWED");
    assert.equal(codigo(await subirGuia(docente.token, nivel("PP1").id, Buffer.from("no soy un pdf"))), "FILE_NOT_READABLE");
    const texto = await pedir(ruta(nivel("PP1").id), { token: docente.token, metodo: "POST", cuerpo: "hola", cabeceras: { "Content-Type": "text/plain" } });
    assert.ok([415, 422, 400].includes(texto.estado) || codigo(texto) === "FILE_REQUIRED", `texto plano: ${texto.estado}`);
    assert.equal((await subirGuia(docente.token, "no-es-uuid")).estado, 400);
    assert.equal((await subirGuia(docente.token, "00000000-0000-4000-8000-000000000000")).json.error.code, "LEVEL_NOT_FOUND");
  });

  it("sube la versión 1: queda vigente, con URL firmada y auditada", async () => {
    const r = await subirGuia(docente.token, nivel("PP1").id, pdfNumero(1), { "X-File-Name": encodeURIComponent("Criterios PP1.pdf") });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.data.guia.version, 1);
    assert.equal(r.json.data.guia.vigente, true);
    assert.equal(r.json.data.guia.archivo_nombre, "Criterios PP1.pdf");
    assert.match(r.json.data.guia.url, /^https:\/\/storage\.test\/guias_criterios\//);
    assert.equal(r.json.data.versiones.length, 1);
    assert.equal(firebase.estado.eventos.filter((e) => e.ruta === "auditoria" && e.accion === "GUIA_CRITERIOS_CARGADA").length, 1);
  });

  it("una carga nueva crea la versión 2 y la 1 queda histórica (una sola vigente)", async () => {
    const r = await subirGuia(docente.token, nivel("PP1").id, pdfNumero(2));
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.data.guia.version, 2);
    assert.deepEqual(r.json.data.versiones.map((v) => [v.version, v.vigente]), [[2, true], [1, false]]);
    const vigentes = await pool.query("SELECT count(*)::int AS n FROM guias_criterios WHERE nivel_practica_id = $1 AND vigente", [nivel("PP1").id]);
    assert.equal(vigentes.rows[0].n, 1);
  });

  it("la leen Director, docente del nivel, el estudiante y el asesor con practicantes en el nivel", async () => {
    for (const t of [tokenDirector, docente.token, estudiantes[0].token, asesorUnico.token]) {
      const r = await pedir(ruta(nivel("PP1").id), { token: t });
      assert.equal(r.estado, 200, JSON.stringify(r.json));
      assert.equal(r.json.data.guia.version, 2);
    }
    const est = await pedir(ruta(nivel("PP1").id), { token: estudiantes[0].token });
    assert.equal(est.json.data.versiones, undefined, "el estudiante no ve el historial");
  });

  it("no la lee quien no tiene relación con el nivel: otro docente, estudiante sin práctica, asesor sin practicantes", async () => {
    for (const t of [docente2.token, estudiantes[3].token, asesorA.token]) {
      const r = await pedir(ruta(nivel("PP1").id), { token: t });
      assert.equal(r.estado, 404, JSON.stringify(r.json));
      assert.equal(r.json.error.code, "GUIDE_NOT_FOUND");
    }
    // el estudiante del nivel PP1 tampoco ve la de otro nivel
    assert.equal((await pedir(ruta(nivel("PP2").id), { token: estudiantes[0].token })).estado, 404);
  });

  it("si Dirección cambia al docente, el nuevo sube versión 3 y el anterior pierde el permiso", async () => {
    assert.equal((await pedir(`/api/v1/level-teachers/${nivel("PP1").id}`, { token: tokenDirector, metodo: "PUT", cuerpo: { docente_id: docente2.id } })).estado, 200);
    assert.equal((await subirGuia(docente.token, nivel("PP1").id)).estado, 403);
    const r = await subirGuia(docente2.token, nivel("PP1").id, pdfNumero(3));
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.data.guia.version, 3);
  });

  it("el docente puede volver a una versión anterior y eliminar la que no quiere", async () => {
    const base = `/api/v1/levels/${nivel("PP1").id}/periods/${periodoId}/criteria-guide`;
    const lista = (await pedir(base, { token: docente2.token })).json.data.versiones;
    const v3 = lista.find((v) => v.version === 3);
    const v1 = lista.find((v) => v.version === 1);
    // Solo el docente del nivel puede hacerlo.
    assert.equal((await pedir(`${base}/versions/${v1.id}/activate`, { token: tokenDirector, metodo: "POST" })).estado, 403);
    assert.equal((await pedir(`${base}/versions/${v1.id}/activate`, { token: docente.token, metodo: "POST" })).estado, 403);
    assert.equal((await pedir(`${base}/versions/11111111-1111-4111-8111-111111111111/activate`, { token: docente2.token, metodo: "POST" })).estado, 404);
    // No se elimina la vigente mientras haya otras.
    const bloqueada = await pedir(`${base}/versions/${v3.id}`, { token: docente2.token, metodo: "DELETE" });
    assert.equal(bloqueada.estado, 422);
    assert.equal(bloqueada.json.error.code, "GUIDE_VERSION_CURRENT");
    // Vuelve a la versión 1 y elimina la 3.
    const activada = await pedir(`${base}/versions/${v1.id}/activate`, { token: docente2.token, metodo: "POST" });
    assert.equal(activada.estado, 200, JSON.stringify(activada.json));
    assert.equal(activada.json.data.guia.version, 1);
    assert.equal((await pedir(base, { token: estudiantes[0].token })).json.data.guia.version, 1, "el estudiante ve la versión 1");
    const eliminada = await pedir(`${base}/versions/${v3.id}`, { token: docente2.token, metodo: "DELETE" });
    assert.equal(eliminada.estado, 200, JSON.stringify(eliminada.json));
    assert.deepEqual(eliminada.json.data.versiones.map((v) => [v.version, v.vigente]), [[2, false], [1, true]]);
    assert.equal((await pedir(`${base}/versions/${v3.id}`, { token: docente2.token, metodo: "DELETE" })).estado, 404);
    assert.ok(firebase.estado.eventos.some((e) => e.accion === "GUIA_CRITERIOS_ACTIVADA"));
    assert.ok(firebase.estado.eventos.some((e) => e.accion === "GUIA_CRITERIOS_ELIMINADA"));
    // Una nueva carga sigue numerando después de la 3 eliminada.
    const nueva = await subirGuia(docente2.token, nivel("PP1").id, pdfNumero(5));
    assert.equal(nueva.estado, 201, JSON.stringify(nueva.json));
    assert.equal(nueva.json.data.guia.version, 4);
  });

  it("el estudiante con la solicitud en borrador ya puede leer la guía de su nivel", async () => {
    const { rows } = await pool.query(
      `SELECT a.id, a.estado FROM asignaciones_practica a JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
        WHERE m.estudiante_id = $1 AND a.eliminado_en IS NULL`, [estudiantes[0].id]);
    await pool.query("UPDATE asignaciones_practica SET estado = 'BORRADOR' WHERE id = $1", [rows[0].id]);
    const r = await pedir(ruta(nivel("PP1").id), { token: estudiantes[0].token });
    await pool.query("UPDATE asignaciones_practica SET estado = $2 WHERE id = $1", [rows[0].id, rows[0].estado]);
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.ok(r.json.data.guia?.url);
  });

  it("con el periodo cerrado no se cambia la guía", async () => {
    await pool.query("UPDATE periodos_academicos SET estado = 'CERRADO' WHERE id = $1", [periodoId]);
    const r = await subirGuia(docente2.token, nivel("PP1").id, pdfNumero(4));
    await pool.query("UPDATE periodos_academicos SET estado = 'ACTIVO' WHERE id = $1", [periodoId]);
    assert.equal(r.estado, 422);
    assert.equal(r.json.error.code, "PERIOD_CLOSED");
  });
});

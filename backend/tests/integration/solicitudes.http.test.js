/**
 * Pruebas HTTP de la solicitud de práctica del estudiante (Fase 2a del flujo v2):
 * trayectoria, nivel propuesto sin saltos, borrador, carga de documentos, envío y descarte.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
const pdfNumero = (n) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${n}\n`, "latin1"), PDF.subarray(9)]);

describe("API HTTP · solicitud de práctica", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, servidor, base, firebase;
  let tokenDirector, tokenDocente, est1, est2, niveles, tiposObligatorios, institucion;

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
  const trayectoria = async (est) => (await pedir("/api/v1/me/practice-trajectory", { token: est.token })).json.data;
  const solicitar = (est, nivelId) => pedir("/api/v1/practice-requests", { token: est.token, metodo: "POST", cuerpo: { nivel_practica_id: nivelId } });
  const elegirPlaza = (est, id, institucionId) =>
    pedir(`/api/v1/practice-requests/${id}/site`, { token: est.token, metodo: "PATCH", cuerpo: { institucion_id: institucionId } });
  const enviar = (est, id) => pedir(`/api/v1/practice-requests/${id}/submit`, { token: est.token, metodo: "POST" });
  let contadorPdf = 0;
  const subir = (est, asignacionId, tipoId) =>
    pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents/${tipoId}/upload`, {
      token: est.token, metodo: "POST", cuerpo: pdfNumero(++contadorPdf),
      cabeceras: { "Content-Type": "application/pdf", "X-File-Name": "documento.pdf" },
    });
  const subirTodos = async (est, asignacionId) => {
    for (const tipo of tiposObligatorios) assert.equal((await subir(est, asignacionId, tipo)).estado, 201);
  };
  const eventos = (tipo) => firebase.estado.eventos.filter((e) => e.ruta.startsWith("notificaciones_usuario/") && e.tipo === tipo);

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
    est1 = await crear({ rol: "ESTUDIANTE", documento: "2000000001", nombres: "Laura", apellidos: "Aguilar", correo: "laura@udi.test", semestre: 1 });
    est2 = await crear({ rol: "ESTUDIANTE", documento: "2000000002", nombres: "Mario", apellidos: "Bravo", correo: "mario@udi.test", semestre: 1 });
    tokenDocente = (await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" })).token;
    niveles = (await pedir("/api/v1/practice-levels", { token: tokenDirector })).json.data;
    tiposObligatorios = (await pool.query(
      `SELECT DISTINCT r.tipo_documento_legal_id AS id FROM requisitos_documentales r
        WHERE r.nivel_practica_id = $1 AND r.obligatorio AND r.eliminado_en IS NULL`, [nivel("PP1").id]
    )).rows.map((f) => f.id);
    assert.ok(tiposObligatorios.length > 0);
    const creada = await pedir("/api/v1/institutions", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { nombre: "Colegio Elegido", nit: "900765432-1", ciudad: "Bucaramanga", correo: "elegido@colegio.test", estado_convenio: "VIGENTE" },
    });
    assert.equal(creada.estado, 201, JSON.stringify(creada.json));
    institucion = creada.json.data;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (cerrarPool) await cerrarPool();
  });

  it("la trayectoria y la solicitud son solo del estudiante (401 sin sesión, 403 otros roles)", async () => {
    assert.equal((await pedir("/api/v1/me/practice-trajectory")).estado, 401);
    assert.equal((await pedir("/api/v1/me/practice-trajectory", { token: tokenDirector })).estado, 403);
    assert.equal((await pedir("/api/v1/me/practice-trajectory", { token: tokenDocente })).estado, 403);
    assert.equal((await pedir("/api/v1/practice-requests", { token: tokenDirector, metodo: "POST", cuerpo: { nivel_practica_id: nivel("PP1").id } })).estado, 403);
  });

  it("al inicio el sistema propone el primer nivel y no hay solicitud abierta", async () => {
    const t = await trayectoria(est1);
    assert.equal(t.nivel_propuesto.codigo, "PP1");
    assert.equal(t.solicitud_abierta, null);
    assert.equal(t.trayectoria_completa, false);
    assert.ok(t.niveles.length >= 2);
    assert.ok(t.niveles.every((n) => n.estado === "PENDIENTE"));
  });

  it("no se puede saltar de nivel ni enviar un cuerpo inválido", async () => {
    const r = await solicitar(est1, nivel("PP2").id);
    assert.equal(r.estado, 422, JSON.stringify(r.json));
    assert.equal(r.json.error.code, "LEVEL_NOT_ALLOWED");
    assert.equal((await pedir("/api/v1/practice-requests", { token: est1.token, metodo: "POST", cuerpo: {} })).estado, 400);
    assert.equal((await pedir("/api/v1/practice-requests", { token: est1.token, metodo: "POST", cuerpo: { nivel_practica_id: "x" } })).estado, 400);
  });

  let solicitud;
  it("crea el borrador del nivel propuesto, sin institución ni docente", async () => {
    const r = await solicitar(est1, nivel("PP1").id);
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    solicitud = r.json.data;
    assert.equal(solicitud.estado, "BORRADOR");
    assert.equal(solicitud.institucion, null);
    assert.equal(solicitud.docente, null);
    assert.equal(solicitud.nivel.codigo, "PP1");
  });

  it("no permite una segunda solicitud abierta", async () => {
    const r = await solicitar(est1, nivel("PP1").id);
    assert.equal(r.estado, 409);
    assert.equal(r.json.error.code, "ASSIGNMENT_ALREADY_EXISTS");
  });

  it("la trayectoria muestra la solicitud abierta y ya no propone otro nivel", async () => {
    const t = await trayectoria(est1);
    assert.equal(t.nivel_propuesto, null);
    assert.equal(t.solicitud_abierta.id, solicitud.id);
    assert.equal(t.niveles.find((n) => n.codigo === "PP1").estado, "EN_SOLICITUD");
  });

  it("el borrador es privado: Dirección no lo ve ni en el listado ni en sus documentos", async () => {
    const lista = await pedir("/api/v1/practice-assignments", { token: tokenDirector });
    assert.equal(lista.estado, 200);
    assert.ok(!lista.json.data.some((a) => a.id === solicitud.id));
    assert.equal((await pedir(`/api/v1/practice-assignments/${solicitud.id}/legal-documents`, { token: tokenDirector })).estado, 404);
  });

  it("otro estudiante no puede ver, enviar ni descartar la solicitud ajena (404)", async () => {
    assert.equal((await enviar(est2, solicitud.id)).estado, 404);
    assert.equal((await pedir(`/api/v1/practice-requests/${solicitud.id}`, { token: est2.token, metodo: "DELETE" })).estado, 404);
  });

  it("sin plaza elegida no se puede enviar: responde SITE_REQUIRED", async () => {
    const r = await enviar(est1, solicitud.id);
    assert.equal(r.estado, 422, JSON.stringify(r.json));
    assert.equal(r.json.error.code, "SITE_REQUIRED");
  });

  it("el estudiante elige su plaza mientras arma el expediente (sigue en BORRADOR y Dirección no recibe aviso)", async () => {
    const r = await elegirPlaza(est1, solicitud.id, institucion.id);
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.estado, "BORRADOR");
    assert.equal(r.json.data.institucion_solicitada.id, institucion.id);
    assert.equal(eventos("PLAZA_ELEGIDA").length, 0);
  });

  it("con la plaza elegida pero sin documentos responde DOCUMENTS_INCOMPLETE con lo que falta", async () => {
    const r = await enviar(est1, solicitud.id);
    assert.equal(r.estado, 422, JSON.stringify(r.json));
    assert.equal(r.json.error.code, "DOCUMENTS_INCOMPLETE");
    assert.equal(r.json.error.details.length, tiposObligatorios.length);
  });

  it("el estudiante carga los documentos mientras es borrador y Dirección no recibe avisos por cada archivo", async () => {
    const lista = await pedir(`/api/v1/practice-assignments/${solicitud.id}/legal-documents`, { token: est1.token });
    assert.equal(lista.estado, 200);
    assert.ok(lista.json.data.documentos.every((d) => d.puede_subir));
    await subirTodos(est1, solicitud.id);
    assert.equal(eventos("DOCUMENTO_PENDIENTE_REVISION").length, 0);
  });

  it("con todos los documentos cargados la solicitud se envía y pasa a ENVIADA", async () => {
    const r = await enviar(est1, solicitud.id);
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.estado, "ENVIADA");
    assert.equal(r.json.data.institucion_solicitada.id, institucion.id, "la plaza viaja con el envío");
    assert.ok(r.json.data.enviada_en);
    assert.equal(eventos("SOLICITUD_ENVIADA").length, 1);
    const auditoria = firebase.estado.eventos.filter((e) => e.ruta === "auditoria" && e.accion === "SOLICITUD_ENVIADA");
    assert.equal(auditoria.length, 1);
  });

  it("una solicitud enviada ya no se reenvía, ni se descarta, ni admite cargas del estudiante", async () => {
    const otra = await enviar(est1, solicitud.id);
    assert.equal(otra.estado, 422);
    assert.equal(otra.json.error.code, "REQUEST_NOT_SUBMITTABLE");
    const descarte = await pedir(`/api/v1/practice-requests/${solicitud.id}`, { token: est1.token, metodo: "DELETE" });
    assert.equal(descarte.estado, 422);
    assert.equal(descarte.json.error.code, "REQUEST_NOT_DISCARDABLE");
    const carga = await subir(est1, solicitud.id, tiposObligatorios[0]);
    assert.equal(carga.estado, 422);
    assert.equal(carga.json.error.code, "ASSIGNMENT_CLOSED");
    const cambio = await elegirPlaza(est1, solicitud.id, institucion.id);
    assert.equal(cambio.estado, 422, "una vez enviada, solo Dirección cambia la plaza");
    assert.equal(cambio.json.error.code, "SITE_NOT_ALLOWED_YET");
  });

  it("Dirección ve la solicitud enviada (plaza pedida, aún sin asignar) y su expediente", async () => {
    // «Asignaciones» solo muestra lo que ya tiene plaza; la solicitud en trámite se pide por su estado.
    const general = await pedir("/api/v1/practice-assignments", { token: tokenDirector });
    assert.ok(!general.json.data.some((a) => a.id === solicitud.id), "no debe salir en el listado general de asignaciones");
    const lista = await pedir("/api/v1/practice-assignments?estado=ENVIADA", { token: tokenDirector });
    const fila = lista.json.data.find((a) => a.id === solicitud.id);
    assert.ok(fila, "la solicitud enviada debe aparecer");
    assert.equal(fila.estado, "ENVIADA");
    assert.equal(fila.institucion, null, "todavía no hay plaza asignada");
    assert.equal(fila.institucion_solicitada.id, institucion.id);
    const docs = await pedir(`/api/v1/practice-assignments/${solicitud.id}/legal-documents`, { token: tokenDirector });
    assert.equal(docs.estado, 200);
    assert.equal(docs.json.data.resumen.en_revision, docs.json.data.resumen.total);
  });

  it("descartar un borrador libera al estudiante para crear otro", async () => {
    const creada = await solicitar(est2, nivel("PP1").id);
    assert.equal(creada.estado, 201);
    const descarte = await pedir(`/api/v1/practice-requests/${creada.json.data.id}`, { token: est2.token, metodo: "DELETE" });
    assert.equal(descarte.estado, 200, JSON.stringify(descarte.json));
    assert.equal((await trayectoria(est2)).solicitud_abierta, null);
    assert.equal((await solicitar(est2, nivel("PP1").id)).estado, 201);
  });

  it("una solicitud rechazada deja al estudiante pedir de nuevo el mismo nivel", async () => {
    await pool.query(
      "UPDATE asignaciones_practica SET estado = 'RECHAZADA', motivo_rechazo = 'No cumple requisitos' WHERE id = $1", [solicitud.id]
    );
    const t = await trayectoria(est1);
    assert.equal(t.solicitud_abierta, null);
    assert.equal(t.nivel_propuesto.codigo, "PP1");
    assert.equal((await solicitar(est1, nivel("PP1").id)).estado, 201);
  });

  it("al finalizar un nivel el sistema propone el siguiente y no deja saltarse el que sigue", async () => {
    const inst = await pedir("/api/v1/institutions", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" },
    });
    // Se deja el nivel 1 finalizado y se pasa al periodo siguiente (la matrícula nueva es del nuevo periodo).
    await pool.query(
      `UPDATE asignaciones_practica SET estado = 'FINALIZADA', institucion_id = $2
        WHERE nivel_practica_id = $3 AND matricula_estudiante_id IN (SELECT id FROM matriculas_estudiantes WHERE estudiante_id = $1)
          AND estado = 'BORRADOR'`,
      [est1.id, inst.json.data.id, nivel("PP1").id]
    );
    await pool.query("UPDATE periodos_academicos SET estado = 'CERRADO' WHERE estado = 'ACTIVO'");
    await pool.query(
      `INSERT INTO periodos_academicos (codigo, nombre, fecha_inicio, fecha_fin, estado)
       VALUES ('2027-1', 'Periodo 2027-1', '2027-01-20', '2027-06-05', 'ACTIVO')`
    );
    await pool.query(
      `INSERT INTO matriculas_estudiantes (estudiante_id, programa_academico_id, periodo_academico_id, numero_semestre)
       SELECT m.estudiante_id, m.programa_academico_id, (SELECT id FROM periodos_academicos WHERE codigo = '2027-1'), 2
         FROM matriculas_estudiantes m WHERE m.estudiante_id = $1 LIMIT 1`,
      [est1.id]
    );
    const t = await trayectoria(est1);
    assert.equal(t.niveles.find((n) => n.codigo === "PP1").estado, "FINALIZADA");
    assert.equal(t.nivel_propuesto.codigo, "PP2");
    const salto = await solicitar(est1, nivel("PP3").id);
    assert.equal(salto.estado, 422);
    assert.equal(salto.json.error.code, "LEVEL_NOT_ALLOWED");
    const ok = await solicitar(est1, nivel("PP2").id);
    assert.equal(ok.estado, 201, JSON.stringify(ok.json));
  });
});

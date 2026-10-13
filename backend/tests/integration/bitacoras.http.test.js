/**
 * Pruebas HTTP de cuestionarios y bitácoras: permisos, publicación, evidencias, autoguardado, envío idempotente y requisitos.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, JPG, PDF, pdfDistinto } from "../helpers/escenario.js";
import { limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

const REFLEXION = "Hoy acompañé al grupo de transición en una actividad de juego simbólico donde los niños construyeron una tienda con cajas y descubrieron cómo cooperar para repartir los roles del juego.";

/**
 * Pruebas HTTP de cuestionarios y bitácoras: cuerpo binario (express.raw), cabeceras (X-File-Name, Idempotency-Key),
 * validación de entradas, autenticación y roles. Almacenamiento y Firebase en memoria.
 */
describe("API HTTP · cuestionarios y bitácoras", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, servidor, base, firebase;
  let tokenDirector, tokenEstudiante, tokenDocente, tokenDocente2, tokenAsesor;
  let asignacionId, nivelId, cuestionarioId, preguntaAbierta, preguntaUnica, opcionSi;
  let bitacoraId, evidenciaId, ultimaRevision;

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
  const subirEvidencia = (token, { contenido = JPG(), tipo = "image/jpeg", nombre = "Salón ñandú.jpg", descripcion } = {}) =>
    pedir(`/api/v1/logbooks/${bitacoraId}/evidences`, {
      token, metodo: "POST", cuerpo: contenido,
      cabeceras: {
        "Content-Type": tipo,
        "X-File-Name": encodeURIComponent(nombre),
        ...(descripcion ? { "X-Evidence-Description": encodeURIComponent(descripcion) } : {}),
      },
    });
  const guardarBorrador = (token, cuerpo) => pedir(`/api/v1/logbooks/${bitacoraId}/draft`, { token, metodo: "PUT", cuerpo });
  const enviar = (token, cuerpo, llave) =>
    pedir(`/api/v1/logbooks/${bitacoraId}/submit`, { token, metodo: "POST", cuerpo, cabeceras: llave === undefined ? {} : { "Idempotency-Key": llave } });
  const verBitacora = (token, id = bitacoraId) => pedir(`/api/v1/logbooks/${id}`, { token });

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
    const inst = await pedir("/api/v1/institutions", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" },
    });
    assert.equal(inst.estado, 201, JSON.stringify(inst.json));
    const estudiante = await crear({ rol: "ESTUDIANTE", documento: "2000000001", nombres: "Laura", apellidos: "Aguilar", correo: "laura@udi.test", semestre: 1 });
    const docente = await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    const docente2 = await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000002", nombres: "Sara", apellidos: "Torres", correo: "sara@udi.test" });
    const asesor = await crear({ rol: "ASESOR_SITIO", documento: "4000000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: inst.json.data.id });
    tokenEstudiante = estudiante.token;
    tokenDocente = docente.token;
    tokenDocente2 = docente2.token;
    tokenAsesor = asesor.token;

    nivelId = (await pedir("/api/v1/practice-levels", { token: tokenDirector })).json.data.find((n) => n.semestre === 1).id;
    const asignacion = await pedir("/api/v1/practice-assignments", {
      token: tokenDirector, metodo: "POST",
      cuerpo: {
        estudiante_id: estudiante.id, nivel_practica_id: nivelId, institucion_id: inst.json.data.id,
        docente_supervisor_id: docente.id, asesor_sitio_id: asesor.id,
      },
    });
    assert.equal(asignacion.estado, 201, JSON.stringify(asignacion.json));
    asignacionId = asignacion.json.data.id;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (cerrarPool) await cerrarPool();
  });

  // ───────────────────────── Cuestionarios ─────────────────────────

  it("solo Dirección configura cuestionarios y las entradas se validan", async () => {
    assert.equal((await pedir("/api/v1/questionnaires")).estado, 401);
    assert.equal((await pedir("/api/v1/questionnaires", { token: tokenEstudiante })).estado, 403);
    assert.equal((await pedir("/api/v1/questionnaires", { token: tokenDocente })).estado, 403);
    assert.equal((await pedir("/api/v1/questionnaires", { token: tokenEstudiante, metodo: "POST", cuerpo: { nivel_practica_id: nivelId } })).estado, 403);

    const sinNivel = await pedir("/api/v1/questionnaires", { token: tokenDirector, metodo: "POST", cuerpo: {} });
    assert.equal(sinNivel.estado, 400);
    assert.equal(sinNivel.json.error.code, "VALIDATION_ERROR");

    const creado = await pedir("/api/v1/questionnaires", { token: tokenDirector, metodo: "POST", cuerpo: { nivel_practica_id: nivelId, sin_copia: true } });
    assert.equal(creado.estado, 201, JSON.stringify(creado.json));
    assert.equal(creado.json.data.numero_version, 1);
    assert.equal(creado.json.data.editable, true);
    cuestionarioId = creado.json.data.id;
    assert.ok(creado.json.meta.request_id);

    const duplicado = await pedir("/api/v1/questionnaires", { token: tokenDirector, metodo: "POST", cuerpo: { nivel_practica_id: nivelId, sin_copia: true } });
    assert.equal(duplicado.estado, 409);
    assert.equal(duplicado.json.error.code, "DRAFT_ALREADY_EXISTS");

    const ruta = `/api/v1/questionnaires/${cuestionarioId}/questions`;
    const sinEnunciado = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { tipo: "ABIERTA" } });
    assert.equal(sinEnunciado.estado, 400);
    const pocasOpciones = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { tipo: "CERRADA_UNICA", enunciado: "¿Cómo estuvo?", opciones: [{ etiqueta: "Bien" }] } });
    assert.equal(pocasOpciones.estado, 422);
    assert.equal(pocasOpciones.json.error.code, "OPTIONS_REQUIRED");

    const abierta = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { tipo: "ABIERTA", enunciado: "¿Qué aprendiste?", obligatoria: true } });
    assert.equal(abierta.estado, 201, JSON.stringify(abierta.json));
    const unica = await pedir(ruta, {
      token: tokenDirector, metodo: "POST",
      cuerpo: { tipo: "CERRADA_UNICA", enunciado: "¿Lograste el objetivo?", obligatoria: true, opciones: [{ etiqueta: "Sí" }, { etiqueta: "No" }] },
    });
    assert.equal(unica.estado, 201);
    const descartable = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { tipo: "ABIERTA", enunciado: "Pregunta que se elimina", obligatoria: false } });
    assert.equal(descartable.json.data.preguntas.length, 3);

    // DELETE responde 204 sin cuerpo
    const idDescartable = descartable.json.data.preguntas[2].id;
    const eliminada = await pedir(`/api/v1/questions/${idDescartable}`, { token: tokenDirector, metodo: "DELETE" });
    assert.equal(eliminada.estado, 204);
    assert.equal(eliminada.json, null);
    assert.equal((await pedir(`/api/v1/questions/${idDescartable}`, { token: tokenDirector, metodo: "DELETE" })).estado, 404);
    [preguntaAbierta, preguntaUnica] = unica.json.data.preguntas;
    opcionSi = preguntaUnica.opciones.find((o) => o.etiqueta === "Sí").id;
  });

  it("publicar deja el cuestionario habilitado e inmutable", async () => {
    const publicado = await pedir(`/api/v1/questionnaires/${cuestionarioId}/publish`, { token: tokenDirector, metodo: "POST" });
    assert.equal(publicado.estado, 200, JSON.stringify(publicado.json));
    assert.equal(publicado.json.data.estado, "PUBLICADO");
    assert.equal(publicado.json.data.habilitado, true);

    const agregar = await pedir(`/api/v1/questionnaires/${cuestionarioId}/questions`, { token: tokenDirector, metodo: "POST", cuerpo: { tipo: "ABIERTA", enunciado: "Tarde" } });
    assert.equal(agregar.estado, 409);
    assert.equal(agregar.json.error.code, "QUESTIONNAIRE_PUBLISHED");
    const eliminar = await pedir(`/api/v1/questions/${preguntaAbierta.id}`, { token: tokenDirector, metodo: "DELETE" });
    assert.equal(eliminar.estado, 409);

    const lista = await pedir("/api/v1/questionnaires?nivel=1", { token: tokenDirector });
    assert.equal(lista.estado, 200);
    assert.deepEqual(lista.json.data.map((c) => [c.numero_version, c.habilitado]), [[1, true]]);
    const mal = await pedir("/api/v1/questionnaires?nivel=99", { token: tokenDirector });
    assert.equal(mal.estado, 400);
  });

  // ───────────────────────── Bitácora bloqueada ─────────────────────────

  it("la bitácora se crea bloqueada: POST responde 201 y luego 200; sin sesión y sin rol no hay acceso", async () => {
    const ruta = `/api/v1/practice-assignments/${asignacionId}/logbook`;
    assert.equal((await pedir(ruta)).estado, 401);
    assert.equal((await pedir(ruta, { token: tokenDocente })).estado, 404, "docente asignado: aún no hay entrega visible");
    assert.equal((await pedir(ruta, { token: tokenDocente, metodo: "POST" })).estado, 403);
    assert.equal((await pedir(ruta, { token: tokenDirector, metodo: "POST" })).estado, 403);

    const primera = await pedir(ruta, { token: tokenEstudiante, metodo: "POST" });
    assert.equal(primera.estado, 201, JSON.stringify(primera.json));
    assert.equal(primera.json.data.estado, "BLOQUEADA");
    assert.equal(primera.json.data.editable, false);
    bitacoraId = primera.json.data.id;
    const segunda = await pedir(ruta, { token: tokenEstudiante, metodo: "POST" });
    assert.equal(segunda.estado, 200);
    assert.equal(segunda.json.data.id, bitacoraId);

    const bloqueada = await subirEvidencia(tokenEstudiante);
    assert.equal(bloqueada.estado, 422);
    assert.equal(bloqueada.json.error.code, "LOGBOOK_LOCKED");
    assert.equal((await guardarBorrador(tokenEstudiante, { revision_base: 0, reflexion: "hola" })).json.error.code, "LOGBOOK_LOCKED");
  });

  it("Dirección aprueba el expediente por HTTP y la bitácora se habilita con el cuestionario vigente", async () => {
    const tipos = (await pool.query("SELECT id, codigo FROM tipos_documento_legal ORDER BY codigo")).rows;
    for (const [i, tipo] of tipos.entries()) {
      const r = await pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents/${tipo.id}/upload`, {
        token: tokenEstudiante, metodo: "POST", cuerpo: pdfDistinto(i),
        cabeceras: { "Content-Type": "application/pdf", "X-File-Name": `${tipo.codigo}.pdf` },
      });
      assert.equal(r.estado, 201, JSON.stringify(r.json));
    }
    const aprobar = await pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents/approve-all`, { token: tokenDirector, metodo: "POST" });
    assert.equal(aprobar.estado, 200, JSON.stringify(aprobar.json));
    assert.equal(aprobar.json.data.bitacora, "HABILITADA");

    const r = await verBitacora(tokenEstudiante);
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.estado, "BORRADOR");
    assert.equal(r.json.data.editable, true);
    assert.equal(r.json.data.cuestionario.preguntas.length, 2);
    assert.equal(r.json.data.contenido.revision, 0);
    assert.equal(r.json.data.requisitos.listo_para_enviar, false);
  });

  // ───────────────────────── Evidencias ─────────────────────────

  it("sube una evidencia como cuerpo binario: nombre y descripción llegan decodificados", async () => {
    const r = await subirEvidencia(tokenEstudiante, { descripcion: "Niños jugando a la tienda" });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.data.nombre, "Salón ñandú.jpg");
    assert.equal(r.json.data.descripcion, "Niños jugando a la tienda");
    assert.equal(r.json.data.tipo_mime, "image/jpeg");
    assert.equal(r.json.data.es_imagen, true);
    assert.equal(r.json.data.tamano_bytes, JPG().length);
    assert.ok(r.json.meta.request_id);
    evidenciaId = r.json.data.id;
  });

  it("las evidencias exigen sesión y rol de estudiante, y validan el contenido", async () => {
    assert.equal((await subirEvidencia(undefined)).estado, 401);
    assert.equal((await subirEvidencia(tokenDocente)).estado, 403);
    assert.equal((await subirEvidencia(tokenDirector)).estado, 403);
    const otroTipo = await subirEvidencia(tokenEstudiante, { contenido: Buffer.from("hola"), tipo: "text/plain" });
    assert.equal(otroTipo.estado, 400);
    assert.equal(otroTipo.json.error.code, "FILE_REQUIRED");
    const falsa = await subirEvidencia(tokenEstudiante, { contenido: Buffer.from("MZ esto es un ejecutable") });
    assert.equal(falsa.estado, 422);
    assert.equal(falsa.json.error.code, "FILE_NOT_READABLE");
    const pdf = await subirEvidencia(tokenEstudiante, { contenido: PDF, tipo: "application/pdf", nombre: "planeacion.pdf" });
    assert.equal(pdf.estado, 201, JSON.stringify(pdf.json));
    assert.equal(pdf.json.data.es_imagen, false);
    const extension = await subirEvidencia(tokenEstudiante, { contenido: JPG(33), nombre: "foto.png" });
    assert.equal(extension.json.error.code, "FILE_EXTENSION_NOT_ALLOWED");
  });

  it("CORS: el navegador puede enviar las cabeceras de evidencias y de envío (preflight)", async () => {
    const r = await fetch(`${base}/api/v1/logbooks/${bitacoraId}/evidences`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,x-file-name,x-evidence-description,idempotency-key",
      },
    });
    assert.ok([200, 204].includes(r.status), `preflight respondió ${r.status}`);
    const permitidas = (r.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const cabecera of ["authorization", "content-type", "x-file-name", "x-evidence-description", "idempotency-key"]) {
      assert.ok(permitidas.includes(cabecera), `CORS no permite la cabecera ${cabecera}: ${permitidas}`);
    }
  });

  it("edita la descripción de una evidencia con PATCH y valida el cuerpo", async () => {
    const ruta = `/api/v1/logbooks/${bitacoraId}/evidences/${evidenciaId}`;
    const ok = await pedir(ruta, { token: tokenEstudiante, metodo: "PATCH", cuerpo: { descripcion: "Mural del aula" } });
    assert.equal(ok.estado, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.data.descripcion, "Mural del aula");
    assert.equal((await pedir(ruta, { token: tokenEstudiante, metodo: "PATCH", cuerpo: {} })).estado, 400);
    assert.equal((await pedir(ruta, { token: tokenEstudiante, metodo: "PATCH", cuerpo: { descripcion: "x".repeat(501) } })).estado, 400);
    assert.equal((await pedir(ruta, { token: tokenDocente, metodo: "PATCH", cuerpo: { descripcion: "no" } })).estado, 403);
  });

  // ───────────────────────── Borrador ─────────────────────────

  it("el autoguardado valida el cuerpo y detecta conflictos de revisión", async () => {
    const sinRevision = await guardarBorrador(tokenEstudiante, { reflexion: "hola" });
    assert.equal(sinRevision.estado, 400);
    assert.equal(sinRevision.json.error.code, "VALIDATION_ERROR");
    assert.equal((await guardarBorrador(tokenEstudiante, { revision_base: 0, reflexion: "hola", extra: true })).estado, 400, "campos desconocidos se rechazan");
    assert.equal((await guardarBorrador(tokenDocente, { revision_base: 0, reflexion: "hola" })).estado, 403);
    assert.equal((await guardarBorrador(tokenDirector, { revision_base: 0, reflexion: "hola" })).estado, 403);

    const ok = await guardarBorrador(tokenEstudiante, { revision_base: 0, reflexion: "Un primer texto corto", respuestas: [{ pregunta_id: preguntaAbierta.id, texto: "Algo" }] });
    assert.equal(ok.estado, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.data.revision, 1);
    assert.ok(ok.json.data.guardado_en);

    const conflicto = await guardarBorrador(tokenEstudiante, { revision_base: 0, reflexion: "otra pestaña" });
    assert.equal(conflicto.estado, 409);
    assert.equal(conflicto.json.error.code, "DRAFT_CONFLICT");
    assert.deepEqual(conflicto.json.error.details, [{ revision_actual: 1 }]);

    const invalida = await guardarBorrador(tokenEstudiante, { revision_base: 1, reflexion: "x", respuestas: [{ pregunta_id: preguntaUnica.id, texto: "texto en cerrada" }] });
    assert.equal(invalida.estado, 422);
    assert.equal(invalida.json.error.code, "INVALID_ANSWER");
    ultimaRevision = 1;
  });

  // ───────────────────────── Envío ─────────────────────────

  it("enviar exige la cabecera Idempotency-Key", async () => {
    const sin = await enviar(tokenEstudiante, { revision_base: ultimaRevision });
    assert.equal(sin.estado, 400);
    assert.equal(sin.json.error.code, "IDEMPOTENCY_KEY_REQUIRED");
    const corta = await enviar(tokenEstudiante, { revision_base: ultimaRevision }, "abc");
    assert.equal(corta.estado, 400);
    assert.equal(corta.json.error.code, "IDEMPOTENCY_KEY_REQUIRED");
    const sinRevision = await enviar(tokenEstudiante, {}, "llave-http-0001");
    assert.equal(sinRevision.estado, 400);
    assert.equal(sinRevision.json.error.code, "VALIDATION_ERROR");
    assert.equal((await enviar(tokenDocente, { revision_base: 1 }, "llave-http-0001")).estado, 403);
  });

  it("una bitácora incompleta no se envía y explica qué falta", async () => {
    const r = await enviar(tokenEstudiante, { revision_base: ultimaRevision }, "llave-http-0001");
    assert.equal(r.estado, 422);
    assert.equal(r.json.error.code, "LOGBOOK_INCOMPLETE");
    const campos = r.json.error.details.map((d) => d.campo);
    assert.ok(campos.includes("reflexion"));
    assert.ok(campos.includes("respuestas"));
    assert.ok(!campos.includes("evidencias"), "ya hay evidencias cargadas");
  });

  it("envía una vez y repetir la misma llave devuelve el mismo resultado sin duplicar", async () => {
    const guardado = await guardarBorrador(tokenEstudiante, {
      revision_base: ultimaRevision,
      reflexion: REFLEXION,
      respuestas: [
        { pregunta_id: preguntaAbierta.id, texto: "Aprendí a escuchar a los niños." },
        { pregunta_id: preguntaUnica.id, opciones_ids: [opcionSi] },
      ],
    });
    assert.equal(guardado.estado, 200, JSON.stringify(guardado.json));
    assert.equal(guardado.json.data.requisitos.listo_para_enviar, true);
    ultimaRevision = guardado.json.data.revision;

    const primero = await enviar(tokenEstudiante, { revision_base: ultimaRevision }, "llave-http-0001");
    assert.equal(primero.estado, 200, JSON.stringify(primero.json));
    assert.equal(primero.json.data.estado, "ENVIADA");
    assert.equal(primero.json.data.idempotente, false);
    assert.equal(primero.json.data.evaluaciones.length, 2);

    const repetido = await enviar(tokenEstudiante, { revision_base: ultimaRevision }, "llave-http-0001");
    assert.equal(repetido.estado, 200);
    assert.equal(repetido.json.data.idempotente, true);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM evaluaciones WHERE bitacora_id = $1", [bitacoraId])).rows[0].n, 2);

    const otraLlave = await enviar(tokenEstudiante, { revision_base: ultimaRevision }, "llave-http-0002");
    assert.equal(otraLlave.estado, 409);
    assert.equal(otraLlave.json.error.code, "LOGBOOK_ALREADY_SUBMITTED");
    assert.equal((await guardarBorrador(tokenEstudiante, { revision_base: ultimaRevision, reflexion: "tarde" })).estado, 409);
  });

  // ───────────────────────── Consulta por rol ─────────────────────────

  it("docente y asesor asignados ven la entrega en solo lectura; un docente ajeno recibe 404", async () => {
    for (const token of [tokenDocente, tokenAsesor, tokenDirector]) {
      const r = await verBitacora(token);
      assert.equal(r.estado, 200, JSON.stringify(r.json));
      assert.equal(r.json.data.estado, "ENVIADA");
      assert.equal(r.json.data.editable, false);
      assert.equal(r.json.data.contenido.reflexion, REFLEXION);
      assert.equal(r.json.data.evidencias.length, 2);
    }
    const ajeno = await verBitacora(tokenDocente2);
    assert.equal(ajeno.estado, 404);
    assert.equal(ajeno.json.error.code, "LOGBOOK_NOT_FOUND");
    assert.equal((await verBitacora(undefined)).estado, 401);
    assert.equal((await verBitacora(tokenDirector, "no-es-un-uuid")).estado, 400);
  });

  it("las evidencias se descargan con URL firmada solo con acceso a la bitácora", async () => {
    const ruta = `/api/v1/logbooks/${bitacoraId}/evidences/${evidenciaId}/download-url`;
    for (const token of [tokenEstudiante, tokenDirector, tokenDocente, tokenAsesor]) {
      const r = await pedir(ruta, { token });
      assert.equal(r.estado, 200, JSON.stringify(r.json));
      assert.match(r.json.data.url, /^https:\/\/storage\.test\/bitacoras\//);
    }
    assert.equal((await pedir(ruta, { token: tokenDocente2 })).estado, 404);
    assert.equal((await pedir(ruta)).estado, 401);
  });

  // ───────────────────────── Devolución ─────────────────────────

  it("solo Dirección devuelve la bitácora (con motivo) y el estudiante puede corregir", async () => {
    const ruta = `/api/v1/logbooks/${bitacoraId}/return`;
    assert.equal((await pedir(ruta, { token: tokenEstudiante, metodo: "POST", cuerpo: { motivo: "Falta detalle" } })).estado, 403);
    assert.equal((await pedir(ruta, { token: tokenDocente, metodo: "POST", cuerpo: { motivo: "Falta detalle" } })).estado, 403);
    const sinMotivo = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: {} });
    assert.equal(sinMotivo.estado, 400);
    assert.equal(sinMotivo.json.error.code, "VALIDATION_ERROR");

    const ok = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { motivo: "Amplía la reflexión con un ejemplo" } });
    assert.equal(ok.estado, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.data.estado, "DEVUELTA");

    assert.equal((await verBitacora(tokenDocente)).estado, 404, "el evaluador deja de verla");
    const vista = await verBitacora(tokenEstudiante);
    assert.equal(vista.json.data.estado, "DEVUELTA");
    assert.equal(vista.json.data.editable, true);
    assert.equal(vista.json.data.motivo_devolucion, "Amplía la reflexión con un ejemplo");

    // Ahora sí puede retirar una evidencia: DELETE responde 204
    const eliminada = await pedir(`/api/v1/logbooks/${bitacoraId}/evidences/${evidenciaId}`, { token: tokenEstudiante, metodo: "DELETE" });
    assert.equal(eliminada.estado, 204);

    // La llave del envío anterior no puede reenviar la entrega
    const reutilizada = await enviar(tokenEstudiante, { revision_base: vista.json.data.contenido.revision }, "llave-http-0001");
    assert.equal(reutilizada.estado, 409);
    assert.equal(reutilizada.json.error.code, "IDEMPOTENCY_KEY_REUSED");
  });
});

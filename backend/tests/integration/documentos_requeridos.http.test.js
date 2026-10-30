/**
 * Pruebas HTTP de configuración de documentos legales (Director): tipos y requisitos por nivel.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

describe("API HTTP · documentos requeridos", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, servidor, base, firebase, inst, inst0, directorId, nuevos;
  let tokenDirector, tokenDocente, tokenEstudiante, docente1, docente2, estudiante, asesor, niveles, periodoActivo;

  const pedir = async (ruta, { token, metodo = "GET", cuerpo } = {}) => {
    const respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await respuesta.text();
    return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
  };
  const definir = (nivelId, cuerpo, token = tokenDirector) => pedir(`/api/v1/level-teachers/${nivelId}`, { token, metodo: "PUT", cuerpo });
  const filaDe = async (nivelId) => (await pedir("/api/v1/level-teachers", { token: tokenDirector })).json.data.niveles.find((n) => n.nivel.id === nivelId);

  before(async () => {
    ({ pool, cerrarPool } = await import("../../src/config/database.js"));
    const { ejecutarSeedBase } = await import("../../src/database/seeds/base.js");
    const { sustituirFirebaseParaPruebas } = await import("../../src/config/firebase.js");
    const { crearApp } = await import("../../src/app.js");

    firebase = crearFirebaseFalso();
    sustituirFirebaseParaPruebas(firebase.implementacion);
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
    docente1 = await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    docente2 = await crear({ rol: "DOCENTE_SUPERVISOR", documento: "3000000002", nombres: "Claudia", apellidos: "Martínez", correo: "claudia@udi.test" });
    estudiante = await crear({ rol: "ESTUDIANTE", documento: "2000000001", nombres: "Laura", apellidos: "Aguilar", correo: "laura@udi.test", semestre: 1 });
    inst0 = await pedir("/api/v1/institutions", {
      token: tokenDirector, metodo: "POST",
      cuerpo: { nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" },
    });
    asesor = await crear({ rol: "ASESOR_SITIO", documento: "4000000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: inst0.json.data.id });
    tokenDocente = docente1.token;
    tokenEstudiante = estudiante.token;
    niveles = (await pedir("/api/v1/practice-levels", { token: tokenDirector })).json.data;
    periodoActivo = (await pedir("/api/v1/periods", { token: tokenDirector })).json.data.find((p) => p.es_activo);
    inst = inst0.json.data.id;
    directorId = (await pool.query("SELECT id FROM usuarios WHERE firebase_uid = 'uid-director'")).rows[0].id;
    // Cuatro estudiantes en el periodo activo: uno termina el nivel, uno deja la solicitud abierta, uno en curso y uno del último semestre.
    nuevos = {};
    for (const [clave, doc, semestre] of [["finaliza", "2100000001", 1], ["solicitud", "2100000002", 1], ["encurso", "2100000003", 1]]) {
      nuevos[clave] = await crear({ rol: "ESTUDIANTE", documento: doc, nombres: clave, apellidos: "Prueba", correo: `${clave}@udi.test`, semestre });
    }
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (cerrarPool) await cerrarPool();
  });

  const asignar = async (usuarioId, estado, semestre) => {
    const m = (await pool.query("SELECT id FROM matriculas_estudiantes WHERE estudiante_id = $1 AND periodo_academico_id = $2", [usuarioId, periodoActivo.id])).rows[0];
    const n = (await pool.query("SELECT id FROM niveles_practica WHERE numero_semestre = $1", [semestre])).rows[0];
    await pool.query(
      `INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asignada_por_id, estado)
       VALUES ($1, $2, $3, $4, $5, $6)`, [m.id, n.id, inst, docente1.id, directorId, estado]);
  };
  const semestreEn = async (usuarioId, periodoId) =>
    (await pool.query("SELECT numero_semestre AS s FROM matriculas_estudiantes WHERE estudiante_id = $1 AND periodo_academico_id = $2", [usuarioId, periodoId])).rows[0]?.s;
  let asignacionId, tipoId;
  const nombresDelEstudiante = async () =>
    (await pedir(`/api/v1/practice-assignments/${asignacionId}/legal-documents`, { token: tokenEstudiante })).json.data.documentos.map((d) => d.tipo.nombre);
  const aplicar = (cuerpo) => pedir(`/api/v1/document-requirements/types/${tipoId}/levels`, { token: tokenDirector, metodo: "PUT", cuerpo });

  before(async () => {
    await asignar(estudiante.id, "ACTIVA", 1);
    asignacionId = (await pool.query("SELECT a.id FROM asignaciones_practica a JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id WHERE m.estudiante_id = $1", [estudiante.id])).rows[0].id;
  });

  it("solo el Director configura los documentos", async () => {
    assert.equal((await pedir("/api/v1/document-requirements")).estado, 401);
    assert.equal((await pedir("/api/v1/document-requirements", { token: tokenDocente })).estado, 403);
    assert.equal((await pedir("/api/v1/document-requirements/types", { token: tokenEstudiante, metodo: "POST", cuerpo: { nombre: "Otro" } })).estado, 403);
  });

  it("lista los cuatro tipos base y los pide en todos los niveles", async () => {
    const r = await pedir("/api/v1/document-requirements", { token: tokenDirector });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.tipos.length, 4);
    assert.ok(r.json.data.niveles.every((n) => n.requisitos.length === 4 && n.requisitos.every((q) => q.obligatorio)));
    assert.deepEqual((await nombresDelEstudiante()).length, 4);
  });

  it("crea un tipo nuevo, genera su código y rechaza nombres repetidos o inválidos", async () => {
    const r = await pedir("/api/v1/document-requirements/types", { token: tokenDirector, metodo: "POST", cuerpo: { nombre: "Certificado de EPS", descripcion: "Afiliación vigente", tamano_maximo_mb: 5 } });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.data.codigo, "CERTIFICADO_DE_EPS");
    assert.equal(r.json.data.tamano_maximo_mb, 5);
    tipoId = r.json.data.id;
    assert.equal((await pedir("/api/v1/document-requirements/types", { token: tokenDirector, metodo: "POST", cuerpo: { nombre: "certificado de eps" } })).estado, 409);
    assert.equal((await pedir("/api/v1/document-requirements/types", { token: tokenDirector, metodo: "POST", cuerpo: { nombre: "ab" } })).estado, 400);
    assert.ok(!(await nombresDelEstudiante()).includes("Certificado de EPS"), "aún no se pide en ningún nivel");
  });

  it("opcional en un nivel no pide confirmación", async () => {
    const opcional = await aplicar({ niveles: [{ nivel_id: niveles[0].id, obligatorio: false }] });
    assert.equal(opcional.estado, 200, JSON.stringify(opcional.json));
    assert.equal(opcional.json.data.estudiantes_afectados, 0);
    assert.ok((await nombresDelEstudiante()).includes("Certificado de EPS"));
  });

  it("un obligatorio nuevo se exige a quien no tiene expediente aprobado y exenta a las prácticas en curso", async () => {
    const r = await pedir("/api/v1/users", { token: tokenDirector, metodo: "POST", cuerpo: { rol: "ESTUDIANTE", documento: "2000000002", nombres: "Mateo", apellidos: "Rojas", correo: "mateo@udi.test", semestre: 1 } });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    await asignar(r.json.data.id, "ENVIADA", 1);
    const asignacionNueva = (await pool.query("SELECT a.id FROM asignaciones_practica a JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id WHERE m.estudiante_id = $1", [r.json.data.id])).rows[0].id;
    const uid = (await pool.query("SELECT firebase_uid FROM usuarios WHERE id = $1", [r.json.data.id])).rows[0].firebase_uid;
    const tokenNuevo = firebase.emitirToken(uid);
    const documentosDe = async (id, token) => (await pedir(`/api/v1/practice-assignments/${id}/legal-documents`, { token })).json.data.documentos;
    const eps = (docs) => docs.find((d) => d.tipo.nombre === "Certificado de EPS");
    const { contarObligatorios } = await import("../../src/repositories/documentRepository.js");

    const sin = await aplicar({ niveles: [{ nivel_id: niveles[0].id, obligatorio: true }] });
    assert.equal(sin.estado, 409);
    assert.equal(sin.json.error.code, "CONFIRMATION_REQUIRED");
    assert.deepEqual(
      { p: sin.json.error.details[0].sin_expediente_aprobado, c: sin.json.error.details[0].en_curso, t: sin.json.error.details[0].estudiantes_afectados },
      { p: 1, c: 1, t: 1 }
    );
    assert.match(sin.json.error.message, /aún no tienen su expediente aprobado/);

    const con = await aplicar({ niveles: [{ nivel_id: niveles[0].id, obligatorio: true }], confirmar: true });
    assert.equal(con.estado, 200, JSON.stringify(con.json));
    assert.equal(con.json.data.estudiantes_afectados, 1);
    assert.equal(con.json.data.practicas_en_curso_exentas, 1);
    assert.equal(eps(await documentosDe(asignacionNueva, tokenNuevo)).obligatorio, true, "quien aún no tiene expediente aprobado sí lo debe");
    assert.equal(eps(await documentosDe(asignacionId, tokenEstudiante)).obligatorio, false, "la práctica en curso queda exenta");
    assert.equal((await contarObligatorios(asignacionNueva)).total, 5);
    assert.equal((await contarObligatorios(asignacionId)).total, 4, "su bitácora no se bloquea por el documento nuevo");
    assert.ok(firebase.estado.eventos.some((e) => e.accion === "REQUISITOS_DOCUMENTALES_CAMBIADOS" && e.valor_nuevo?.practicas_en_curso_exentas === 1));

    // Después el Director decide aplicarlo también a las prácticas en curso.
    const aplicarTodas = { niveles: [{ nivel_id: niveles[0].id, obligatorio: true }], aplicar_en_curso: true };
    const aviso = await aplicar(aplicarTodas);
    assert.equal(aviso.estado, 409);
    assert.equal(aviso.json.error.details[0].en_curso, 1);
    assert.equal(aviso.json.error.details[0].estudiantes_afectados, 1);
    assert.match(aviso.json.error.message, /bitácora quedará bloqueada/);
    const hecho = await aplicar({ ...aplicarTodas, confirmar: true });
    assert.equal(hecho.estado, 200, JSON.stringify(hecho.json));
    assert.equal(hecho.json.data.practicas_en_curso_exentas, 0);
    assert.equal(eps(await documentosDe(asignacionId, tokenEstudiante)).obligatorio, true);
    assert.equal((await contarObligatorios(asignacionId)).total, 5);
    const nivel = hecho.json.data.niveles.find((n) => n.id === niveles[0].id);
    assert.equal(nivel.requisitos.find((q) => q.tipo_id === tipoId).obligatorio, true);
  });

  it("si solo hay prácticas en curso y no se marca la casilla, no pide confirmación", async () => {
    await aplicar({ niveles: [{ nivel_id: niveles[0].id, obligatorio: false }] });
    await pool.query("UPDATE asignaciones_practica SET estado = 'ACTIVA' WHERE id <> $1 AND eliminado_en IS NULL", [asignacionId]);
    const r = await aplicar({ niveles: [{ nivel_id: niveles[0].id, obligatorio: true }] });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.estudiantes_afectados, 0);
    assert.equal(r.json.data.practicas_en_curso_exentas, 2);
  });

  it("rechaza niveles inexistentes o repetidos", async () => {
    assert.equal((await aplicar({ niveles: [{ nivel_id: "11111111-1111-4111-8111-111111111111", obligatorio: true }] })).estado, 422);
    assert.equal((await aplicar({ niveles: [{ nivel_id: niveles[0].id, obligatorio: true }, { nivel_id: niveles[0].id, obligatorio: false }], confirmar: true })).estado, 422);
  });

  it("quitar el documento de un nivel o desactivarlo lo oculta al estudiante", async () => {
    const quitado = await aplicar({ niveles: [] });
    assert.equal(quitado.estado, 200);
    assert.ok(!(await nombresDelEstudiante()).includes("Certificado de EPS"));
    await aplicar({ niveles: [{ nivel_id: niveles[0].id, obligatorio: false }] });
    assert.ok((await nombresDelEstudiante()).includes("Certificado de EPS"));
    const off = await pedir(`/api/v1/document-requirements/types/${tipoId}`, { token: tokenDirector, metodo: "PATCH", cuerpo: { activo: false } });
    assert.equal(off.estado, 200);
    assert.equal(off.json.data.activo, false);
    assert.ok(!(await nombresDelEstudiante()).includes("Certificado de EPS"));
    assert.equal((await pedir(`/api/v1/document-requirements/types/${tipoId}`, { token: tokenDirector, metodo: "PATCH", cuerpo: {} })).estado, 400);
  });

  it("renombra un tipo sin tocar su código", async () => {
    const r = await pedir(`/api/v1/document-requirements/types/${tipoId}`, { token: tokenDirector, metodo: "PATCH", cuerpo: { nombre: "Certificado EPS vigente", activo: true } });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.nombre, "Certificado EPS vigente");
    assert.equal(r.json.data.codigo, "CERTIFICADO_DE_EPS");
  });
});

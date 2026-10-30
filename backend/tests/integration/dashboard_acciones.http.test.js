/**
 * Pruebas HTTP de las tarjetas de acción inmediata (Fase 4 del flujo v2): GET /dashboard/actions para Director y Docente.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
const pdfNumero = (n) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${n}\n`, "latin1"), PDF.subarray(9)]);

describe("API HTTP · tarjetas de acción", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
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

  const acciones = async (token) => {
    const r = await pedir("/api/v1/dashboard/actions", { token });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    return { ...r.json.data, por: Object.fromEntries(r.json.data.tarjetas.map((t) => [t.codigo, t.total])) };
  };
  const guia = (token, nivelId, periodoId) =>
    pedir(`/api/v1/levels/${nivelId}/periods/${periodoId}/criteria-guide`, { token, metodo: "POST", cuerpo: pdfNumero(777), cabeceras: { "Content-Type": "application/pdf", "X-File-Name": "criterios.pdf" } });

  it("solo Director y Docente tienen tarjetas (sin sesión 401; estudiante y asesor 403; periodo inexistente 404)", async () => {
    assert.equal((await pedir("/api/v1/dashboard/actions")).estado, 401);
    assert.equal((await pedir("/api/v1/dashboard/actions", { token: estudiantes[0].token })).estado, 403);
    assert.equal((await pedir("/api/v1/dashboard/actions", { token: asesorA.token })).estado, 403);
    const r = await pedir("/api/v1/dashboard/actions?periodo_id=00000000-0000-4000-8000-000000000000", { token: tokenDirector });
    assert.equal(r.estado, 404);
    assert.equal(r.json.error.code, "PERIOD_NOT_FOUND");
    assert.equal((await pedir("/api/v1/dashboard/actions?periodo_id=no-es-uuid", { token: tokenDirector })).estado, 400);
  });

  it("Director al inicio: el nivel con estudiantes sin docente y nada por revisar", async () => {
    const d = await acciones(tokenDirector);
    assert.equal(d.rol, "DIRECTOR_PROGRAMA");
    assert.equal(d.por.NIVELES_SIN_DOCENTE, 1, "solo cuenta el nivel con estudiantes matriculados (los demás no son tarea todavía)");
    assert.equal(d.por.DOCUMENTOS_POR_REVISAR, 0);
    assert.equal(d.por.SOLICITUDES_LISTAS_PARA_ASIGNAR, 0);
    assert.equal(d.por.NIVELES_SIN_CUESTIONARIO, 0, "sin docente no se exige cuestionario");
    // además de los niveles sin docente, los 5 estudiantes matriculados aún no envían su solicitud
    assert.equal(d.por.ESTUDIANTES_SIN_SOLICITUD, estudiantes.length);
    assert.equal(d.pendientes, 1 + estudiantes.length);
    const sinSolicitud = d.tarjetas.find((t) => t.codigo === "ESTUDIANTES_SIN_SOLICITUD");
    assert.equal(sinSolicitud.casos.length, 3, "cada tarjeta muestra como máximo 3 casos");
    assert.deepEqual(Object.keys(sinSolicitud.casos[0]).sort(), ["destino", "detalle", "id", "titulo"]);
    assert.equal(sinSolicitud.casos[0].destino.pantalla, "perfil");
    assert.equal(sinSolicitud.casos[0].destino.id, sinSolicitud.casos[0].id);
    const sinDocente = d.tarjetas.find((t) => t.codigo === "NIVELES_SIN_DOCENTE");
    assert.equal(sinDocente.tipo, "accion");
    assert.deepEqual(sinDocente.destino.filtro.nivel_ids, [nivel("PP1").id]);
  });

  it("el flujo de una solicitud mueve las tarjetas: documentos por revisar → lista para asignar", async () => {
    const id = await solicitudEnviada(estudiantes[0]);
    let d = await acciones(tokenDirector);
    assert.equal(d.por.DOCUMENTOS_POR_REVISAR, 1);
    assert.equal(d.por.SOLICITUDES_LISTAS_PARA_ASIGNAR, 0);
    assert.equal((await aprobarTodo(id)).estado, 200);
    d = await acciones(tokenDirector);
    assert.equal(d.por.DOCUMENTOS_POR_REVISAR, 0);
    assert.equal(d.por.SOLICITUDES_LISTAS_PARA_ASIGNAR, 1);
    assert.equal(d.por.SOLICITUDES_ESPERANDO_PLAZA, undefined, "esa tarjeta ya no existe");
    // las tarjetas informativas no suman a "pendientes"
    const informativas = d.tarjetas.filter((t) => t.tipo === "info").reduce((n, t) => n + t.total, 0);
    const todas = d.tarjetas.reduce((n, t) => n + t.total, 0);
    assert.equal(d.pendientes, todas - informativas);
  });

  it("al configurar un docente aparecen las alertas de guía y cuestionario, y el docente ve las suyas", async () => {
    const periodoId = (await pedir("/api/v1/periods", { token: tokenDirector })).json.data.find((p) => p.es_activo).id;
    assert.equal((await pedir(`/api/v1/level-teachers/${nivel("PP1").id}`, { token: tokenDirector, metodo: "PUT", cuerpo: { docente_id: docente.id } })).estado, 200);
    let d = await acciones(tokenDirector);
    assert.equal(d.por.NIVELES_SIN_DOCENTE, 0);
    assert.equal(d.por.NIVELES_SIN_GUIA, 1);
    assert.equal(d.por.NIVELES_SIN_CUESTIONARIO, 1);

    let t = await acciones(docente.token);
    assert.equal(t.rol, "DOCENTE_SUPERVISOR");
    assert.equal(t.por.NIVELES_SIN_GUIA, 1);
    assert.equal(t.por.NIVELES_SIN_CUESTIONARIO, 1);
    assert.equal(t.por.CUESTIONARIOS_SIN_PUBLICAR, 0);
    assert.equal(t.por.EVALUACIONES_POR_CALIFICAR, 0);
    assert.deepEqual(t.tarjetas.find((x) => x.codigo === "NIVELES_SIN_GUIA").destino.filtro.nivel_ids, [nivel("PP1").id]);
    assert.equal(t.pendientes, 2);

    // otro docente sin niveles no tiene pendientes
    const otro = await acciones(docente2.token);
    assert.equal(otro.pendientes, 0);

    // «Mi grupo de práctica»: solo el docente ve sus niveles, con el estado de su guía y su cuestionario
    const mios = await pedir("/api/v1/dashboard/levels", { token: docente.token });
    assert.equal(mios.estado, 200);
    assert.deepEqual(mios.json.data.niveles.map((n) => n.id), [nivel("PP1").id]);
    assert.deepEqual(
      { g: mios.json.data.niveles[0].tiene_guia, c: mios.json.data.niveles[0].tiene_cuestionario, b: mios.json.data.niveles[0].tiene_borrador },
      { g: false, c: false, b: false }
    );
    assert.equal((await pedir("/api/v1/dashboard/levels", { token: docente2.token })).json.data.niveles.length, 0);
    assert.equal((await pedir("/api/v1/dashboard/levels", { token: tokenDirector })).estado, 403);

    // sube la guía, crea un borrador de cuestionario y luego lo publica
    assert.equal((await guia(docente.token, nivel("PP1").id, periodoId)).estado, 201);
    const borrador = await pedir("/api/v1/questionnaires", { token: docente.token, metodo: "POST", cuerpo: { nivel_practica_id: nivel("PP1").id, sin_copia: true } });
    assert.equal(borrador.estado, 201, JSON.stringify(borrador.json));
    t = await acciones(docente.token);
    assert.equal(t.por.NIVELES_SIN_GUIA, 0);
    assert.equal(t.por.CUESTIONARIOS_SIN_PUBLICAR, 1);
    assert.equal(t.por.NIVELES_SIN_CUESTIONARIO, 1, "un borrador todavía no es un cuestionario habilitado");

    const qid = borrador.json.data.id;
    assert.equal((await pedir(`/api/v1/questionnaires/${qid}/questions`, { token: docente.token, metodo: "POST", cuerpo: { tipo: "ABIERTA", enunciado: "¿Qué aprendiste?" } })).estado, 201);
    assert.equal((await pedir(`/api/v1/questionnaires/${qid}/publish`, { token: docente.token, metodo: "POST" })).estado, 200);
    t = await acciones(docente.token);
    assert.equal(t.pendientes, 0);
    d = await acciones(tokenDirector);
    assert.equal(d.por.NIVELES_SIN_GUIA, 0);
    assert.equal(d.por.NIVELES_SIN_CUESTIONARIO, 0);
  });

  it("sin evaluaciones publicadas no hay prácticas listas para cerrar", async () => {
    const d = await acciones(tokenDirector);
    assert.equal(d.por.PRACTICAS_LISTAS_PARA_CERRAR, 0);
  });
  // ───────── Tarjetas de seguimiento del Director (atrasos, casos concretos y avisos) ─────────

  const idSolicitudDe = async (est) =>
    (await pool.query(
      `SELECT a.id FROM asignaciones_practica a JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
        WHERE m.estudiante_id = $1 AND a.eliminado_en IS NULL AND a.estado <> 'CANCELADA'`, [est.id]
    )).rows[0].id;
  /** Cambia columnas de una asignación sin que el trigger de marca de tiempo las pise (para simular que pasaron días). */
  const retroceder = async (id, columna, dias) => {
    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query("ALTER TABLE asignaciones_practica DISABLE TRIGGER USER");
      await cliente.query(`UPDATE asignaciones_practica SET ${columna} = ${columna} - make_interval(days => $2::int) WHERE id = $1`, [id, dias]);
      await cliente.query("ALTER TABLE asignaciones_practica ENABLE TRIGGER USER");
      await cliente.query("COMMIT");
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    } finally {
      cliente.release();
    }
  };
  const tarjetaDe = (d, codigo) => d.tarjetas.find((t) => t.codigo === codigo);

  it("una solicitud con varios días de espera se ve en su tarjeta con cuántos días lleva (no hay tarjeta aparte de «estancadas»)", async () => {
    const idLista = await idSolicitudDe(estudiantes[0]);
    await retroceder(idLista, "enviada_en", 5);
    const d = await acciones(tokenDirector);
    assert.equal(tarjetaDe(d, "SOLICITUDES_ESTANCADAS"), undefined, "esa tarjeta ya no existe");
    const t = tarjetaDe(d, "SOLICITUDES_LISTAS_PARA_ASIGNAR");
    assert.equal(t.casos[0].id, idLista);
    assert.match(t.casos[0].detalle, /enviada hace 5 días/);
    assert.deepEqual(t.casos[0].destino, { pantalla: "solicitudes", id: idLista });
    assert.ok(d.tarjetas.every((x) => x.severidad === undefined && ["accion", "info"].includes(x.tipo)), "las tarjetas no se califican como urgentes");
  });

  it("solicitudes que piden una institución sin asesor, y estudiantes sin solicitud (una en borrador sigue contando)", async () => {
    let d = await acciones(tokenDirector);
    assert.equal(d.por.SOLICITUDES_SIN_ASESOR_EN_PLAZA, 0);
    assert.equal(d.por.ESTUDIANTES_SIN_SOLICITUD, estudiantes.length - 1);
    // estudiantes[2] solo abre un borrador: todavía no envió nada
    assert.equal((await pedir("/api/v1/practice-requests", { token: estudiantes[2].token, metodo: "POST", cuerpo: { nivel_practica_id: nivel("PP1").id } })).estado, 201);
    d = await acciones(tokenDirector);
    assert.equal(d.por.ESTUDIANTES_SIN_SOLICITUD, estudiantes.length - 1);
    // estudiantes[1] envía pidiendo una institución sin asesor vinculado
    const id = await solicitudEnviada(estudiantes[1], instSinAsesor);
    d = await acciones(tokenDirector);
    const t = tarjetaDe(d, "SOLICITUDES_SIN_ASESOR_EN_PLAZA");
    assert.equal(t.total, 1);
    assert.equal(t.casos[0].id, id);
    assert.equal(t.casos[0].detalle, "Pide Jardín Sin Asesor");
    assert.equal(d.por.ESTUDIANTES_SIN_SOLICITUD, estudiantes.length - 2);
    const nombres = tarjetaDe(d, "ESTUDIANTES_SIN_SOLICITUD").casos.map((c) => c.titulo);
    assert.ok(!nombres.includes("Estudiante1 Prueba1") && !nombres.includes("Estudiante2 Prueba2"));
    assert.ok(nombres.includes("Estudiante3 Prueba3"), "el del borrador sigue pendiente");
  });

  it("solicitudes devueltas: la informativa cuenta todas y la de «sin respuesta» solo pasados 5 días", async () => {
    const id = await idSolicitudDe(estudiantes[1]);
    const doc = (await pool.query("SELECT id FROM documentos_legales_estudiantes WHERE asignacion_practica_id = $1 AND eliminado_en IS NULL LIMIT 1", [id])).rows[0].id;
    const r = await pedir(`/api/v1/legal-documents/${doc}/review`, { token: tokenDirector, metodo: "POST", cuerpo: { decision: "RECHAZAR", observacion: "El archivo no es legible" } });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    let d = await acciones(tokenDirector);
    assert.equal(await estadoDe(id), "DEVUELTA");
    assert.equal(d.por.SOLICITUDES_DEVUELTAS, 1);
    assert.equal(d.por.DEVUELTAS_SIN_RESPUESTA, 0);
    await retroceder(id, "actualizado_en", 6);
    d = await acciones(tokenDirector);
    const t = tarjetaDe(d, "DEVUELTAS_SIN_RESPUESTA");
    assert.equal(t.total, 1);
        assert.equal(t.casos[0].id, id);
    assert.match(t.casos[0].detalle, /devuelta hace 6 días/);
    assert.deepEqual(t.destino, { pantalla: "solicitudes", filtro: { estado: "DEVUELTA" } });
  });

  it("prácticas activas cuyo estudiante no abrió su bitácora y aviso de cierre del periodo", async () => {
    const id = await idSolicitudDe(estudiantes[0]);
    const hoy = (await pool.query("SELECT current_date::text AS hoy")).rows[0].hoy; // la fecha según la base de datos
    const asignada = await asignar(id, { asesor_sitio_id: asesorUnico.id, fecha_inicio: hoy });
    assert.equal(asignada.estado, 200, JSON.stringify(asignada.json));
    assert.equal(await estadoDe(id), "ACTIVA");
    let d = await acciones(tokenDirector);
    assert.equal(d.por.PRACTICAS_SIN_AVANCE_DE_BITACORA, 0, "recién iniciada no se reclama");
    assert.equal(d.por.CIERRE_DE_PERIODO, 0, "con el periodo lejos de cerrar no hay aviso");
    await retroceder(id, "fecha_inicio", 10);
    d = await acciones(tokenDirector);
    const t = tarjetaDe(d, "PRACTICAS_SIN_AVANCE_DE_BITACORA");
    assert.equal(t.total, 1);
    assert.equal(t.casos[0].id, id);
    assert.match(t.casos[0].detalle, /inició hace 10 días/);
    assert.deepEqual(t.casos[0].destino, { pantalla: "practica", id });
    // en cuanto el estudiante abre su bitácora deja de contar como «sin abrir»
    assert.equal((await pedir(`/api/v1/practice-assignments/${id}/logbook`, { token: estudiantes[0].token })).estado, 200);
    assert.equal((await acciones(tokenDirector)).por.PRACTICAS_SIN_AVANCE_DE_BITACORA, 0);

    const periodoId = d.periodo.id;
    const fijarCierre = (dias) => pool.query("UPDATE periodos_academicos SET fecha_fin = current_date + $2::int WHERE id = $1", [periodoId, dias]);
    await fijarCierre(30);
    assert.equal((await acciones(tokenDirector)).por.CIERRE_DE_PERIODO, 0);
    await fijarCierre(12);
    d = await acciones(tokenDirector);
    let cierre = tarjetaDe(d, "CIERRE_DE_PERIODO");
    assert.equal(cierre.total, 1);
        assert.match(cierre.titulo, /cierra en 12 días/);
    assert.equal(cierre.suma, false);
    await fijarCierre(4);
    cierre = tarjetaDe(await acciones(tokenDirector), "CIERRE_DE_PERIODO");
    assert.match(cierre.titulo, /cierra en 4 días/);
    await fijarCierre(-2);
    assert.equal((await acciones(tokenDirector)).por.CIERRE_DE_PERIODO, 0, "periodo ya cerrado: sin aviso");
    await fijarCierre(60);
  });

  it("asesores sobrecargados (umbral configurable) y prácticas listas para finalizar con su caso", async () => {
    const dashboardRepository = await import("../../src/repositories/dashboardRepository.js");
    const periodoId = (await acciones(tokenDirector)).periodo.id;
    let r = await dashboardRepository.asesoresSobrecargados({ periodoId, maximo: 5, limite: 3 });
    assert.equal(r.total, 0);
    r = await dashboardRepository.asesoresSobrecargados({ periodoId, maximo: 0, limite: 3 });
    assert.equal(r.total, 1);
    assert.equal(r.casos[0].id, asesorUnico.id);
    assert.equal(r.casos[0].practicantes, 1);
    assert.equal(r.casos[0].institucion, "Jardín Un Asesor");

    // la práctica pasa a evaluación con las dos evaluaciones publicadas
    const id = await idSolicitudDe(estudiantes[0]);
    await pool.query("UPDATE asignaciones_practica SET estado = 'PENDIENTE_EVALUACION' WHERE id = $1", [id]);
    let d = await acciones(tokenDirector);
    assert.equal(d.por.PRACTICAS_LISTAS_PARA_CERRAR, 0, "sin evaluaciones publicadas todavía no");
    for (const [evaluador, tipo] of [[docente.id, "DOCENTE_SUPERVISOR"], [asesorUnico.id, "ASESOR_SITIO"]]) {
      await pool.query(
        `INSERT INTO evaluaciones (asignacion_practica_id, evaluador_id, tipo_evaluador, nota, estado, publicada_en)
         VALUES ($1, $2, $3, 4.5, 'PUBLICADA', now() - interval '2 days')`, [id, evaluador, tipo]
      );
    }
    d = await acciones(tokenDirector);
    const t = tarjetaDe(d, "PRACTICAS_LISTAS_PARA_CERRAR");
    assert.equal(t.total, 1);
    assert.deepEqual(t.destino, { pantalla: "seguimiento", filtro: { grupo: "EN_EVALUACION" } });
    assert.deepEqual(t.casos[0].destino, { pantalla: "practica", pestana: "evaluaciones", id });
    assert.match(t.casos[0].detalle, /evaluaciones publicadas hace 2 días/);
    assert.equal(t.suma, true);
  });
});

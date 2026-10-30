/**
 * Pruebas HTTP del flujo completo de la solicitud (Fase 2b del flujo v2):
 * (v2.1: la plaza se elige antes de enviar y viaja con el expediente)
 * revisión de documentos (DEVUELTA / lista para asignar), "Confirmar y asignar" desde ENVIADA,
 * cambio de plaza con motivo, asesor automático o elegido, rechazo y bitácora al quedar ACTIVA.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
const pdfNumero = (n) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${n}\n`, "latin1"), PDF.subarray(9)]);

describe("API HTTP · asignación de solicitudes", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let pool, cerrarPool, servidor, base, firebase;
  let tokenDirector, docente, estudiantes, niveles, tiposObligatorios;
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
  /** Lleva una solicitud a «lista para asignar»: ENVIADA con la plaza pedida y todos los documentos aprobados. */
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

  // ───────── Revisión de documentos ─────────
  describe("revisión de documentos mueve la solicitud", () => {
    let id;
    it("un documento rechazado devuelve la solicitud al estudiante (DEVUELTA) y le avisa", async () => {
      id = await solicitudEnviada(estudiantes[0]);
      const docs = (await pedir(`/api/v1/practice-assignments/${id}/legal-documents`, { token: tokenDirector })).json.data.documentos;
      const r = await pedir(`/api/v1/legal-documents/${docs[0].documento_id}/review`, {
        token: tokenDirector, metodo: "POST", cuerpo: { decision: "RECHAZAR", observacion: "El archivo no es legible" },
      });
      assert.equal(r.estado, 200, JSON.stringify(r.json));
      assert.equal(await estadoDe(id), "DEVUELTA");
      assert.equal(eventos("SOLICITUD_DEVUELTA").length, 1);
    });

    it("al devolverla, el estudiante vuelve a cargar, puede cambiar su plaza y reenvía", async () => {
      const docs = (await pedir(`/api/v1/practice-assignments/${id}/legal-documents`, { token: estudiantes[0].token })).json.data.documentos;
      const rechazado = docs.find((d) => d.estado === "POR_CORREGIR");
      assert.ok(rechazado.puede_subir);
      assert.equal((await subir(estudiantes[0], id, rechazado.tipo.id)).estado, 201);
      const cambio = await elegir(estudiantes[0], id, instDosAsesores);
      assert.equal(cambio.estado, 200, JSON.stringify(cambio.json));
      assert.equal(cambio.json.data.estado, "DEVUELTA");
      assert.equal(cambio.json.data.institucion_solicitada.id, instDosAsesores);
      const reenvio = await pedir(`/api/v1/practice-requests/${id}/submit`, { token: estudiantes[0].token, metodo: "POST" });
      assert.equal(reenvio.estado, 200, JSON.stringify(reenvio.json));
      assert.equal(await estadoDe(id), "ENVIADA");
    });

    it("al aprobar todos los documentos sigue ENVIADA (lista para asignar) y la bitácora sigue sin existir", async () => {
      const r = await aprobarTodo(id);
      assert.equal(r.estado, 200, JSON.stringify(r.json));
      assert.equal(await estadoDe(id), "ENVIADA");
      assert.equal(eventos("DOCUMENTOS_APROBADOS").length, 0, "ya no hay un estado ni aviso intermedio");
      const bitacora = await pedir(`/api/v1/practice-assignments/${id}/logbook`, { token: estudiantes[0].token });
      assert.ok([403, 404, 409, 422].includes(bitacora.estado) || bitacora.json?.data?.estado === "BLOQUEADA", `bitácora: ${bitacora.estado}`);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM bitacoras WHERE asignacion_practica_id = $1 AND estado <> 'BLOQUEADA'", [id])).rows[0].n, 0);
    });

    it("si Dirección devuelve un documento ya aprobado, la solicitud vuelve a DEVUELTA", async () => {
      const docs = (await pedir(`/api/v1/practice-assignments/${id}/legal-documents`, { token: tokenDirector })).json.data.documentos;
      const r = await pedir(`/api/v1/legal-documents/${docs[1].documento_id}/review`, {
        token: tokenDirector, metodo: "POST", cuerpo: { decision: "RECHAZAR", observacion: "Documento vencido, súbelo de nuevo" },
      });
      assert.equal(r.estado, 200, JSON.stringify(r.json));
      assert.equal(await estadoDe(id), "DEVUELTA");
    });
  });

  // ───────── Plaza y asignación ─────────
  describe("elección de plaza y 'Confirmar y asignar'", () => {
    it("el estudiante ve solo instituciones activas con convenio vigente", async () => {
      const r = await pedir("/api/v1/practice-requests/available-sites", { token: estudiantes[1].token });
      assert.equal(r.estado, 200);
      const ids = r.json.data.map((i) => i.id);
      assert.ok(ids.includes(instUnAsesor) && ids.includes(instDosAsesores));
      assert.ok(!ids.includes(instEnTramite));
      assert.equal((await pedir("/api/v1/practice-requests/available-sites", { token: tokenDirector })).estado, 200);
      assert.equal((await pedir("/api/v1/practice-requests/available-sites")).estado, 401);
    });

    let solicitud;
    it("elige y cambia plaza mientras es borrador, no acepta convenios no vigentes y viaja con el envío", async () => {
      const creada = await pedir("/api/v1/practice-requests", { token: estudiantes[1].token, metodo: "POST", cuerpo: { nivel_practica_id: nivel("PP1").id } });
      solicitud = creada.json.data.id;
      const enTramite = await elegir(estudiantes[1], solicitud, instEnTramite);
      assert.equal(enTramite.estado, 422);
      assert.equal(enTramite.json.error.code, "INSTITUTION_NOT_AVAILABLE");
      assert.equal((await elegir(estudiantes[1], solicitud, instDosAsesores)).estado, 200);
      const cambio = await elegir(estudiantes[1], solicitud, instUnAsesor);
      assert.equal(cambio.estado, 200, JSON.stringify(cambio.json));
      assert.equal(cambio.json.data.estado, "BORRADOR");
      assert.equal(cambio.json.data.institucion_solicitada.id, instUnAsesor);
      assert.equal(cambio.json.data.institucion, null);
      assert.equal(eventos("PLAZA_ELEGIDA").length, 0);
      for (const tipo of tiposObligatorios) assert.equal((await subir(estudiantes[1], solicitud, tipo)).estado, 201);
      const enviada = await pedir(`/api/v1/practice-requests/${solicitud}/submit`, { token: estudiantes[1].token, metodo: "POST" });
      assert.equal(enviada.estado, 200, JSON.stringify(enviada.json));
      assert.equal(enviada.json.data.institucion_solicitada.id, instUnAsesor);
    });

    it("no se puede asignar mientras haya documentos sin aprobar (DOCUMENTS_NOT_APPROVED)", async () => {
      const r = await asignar(solicitud);
      assert.equal(r.estado, 422, JSON.stringify(r.json));
      assert.equal(r.json.error.code, "DOCUMENTS_NOT_APPROVED");
      assert.equal((await aprobarTodo(solicitud)).estado, 200);
      assert.equal(await estadoDe(solicitud), "ENVIADA");
    });

    it("roles sin permiso: el Director no elige plaza por el estudiante ni otro estudiante usa la solicitud", async () => {
      assert.equal((await pedir(`/api/v1/practice-requests/${solicitud}/site`, { token: tokenDirector, metodo: "PATCH", cuerpo: { institucion_id: instUnAsesor } })).estado, 403);
      assert.equal((await elegir(estudiantes[2], solicitud, instUnAsesor)).estado, 404);
      assert.equal((await pedir(`/api/v1/practice-requests/${solicitud}/assign`, { token: estudiantes[1].token, metodo: "POST", cuerpo: {} })).estado, 403);
    });

    it("sin docente configurado para el nivel no se puede asignar (LEVEL_WITHOUT_TEACHER)", async () => {
      const r = await asignar(solicitud);
      assert.equal(r.estado, 422, JSON.stringify(r.json));
      assert.equal(r.json.error.code, "LEVEL_WITHOUT_TEACHER");
      assert.equal(await estadoDe(solicitud), "ENVIADA");
    });

    it("con docente por nivel y un único asesor en la institución, se asigna sola y la práctica queda ACTIVA", async () => {
      const cfg = await pedir(`/api/v1/level-teachers/${nivel("PP1").id}`, { token: tokenDirector, metodo: "PUT", cuerpo: { docente_id: docente.id } });
      assert.equal(cfg.estado, 200, JSON.stringify(cfg.json));
      const r = await asignar(solicitud);
      assert.equal(r.estado, 200, JSON.stringify(r.json));
      const a = r.json.data;
      assert.equal(a.estado, "ACTIVA");
      assert.equal(a.institucion.id, instUnAsesor);
      assert.equal(a.docente.id, docente.id);
      assert.equal(a.asesor.id, asesorUnico.id);
      assert.equal(a.motivo_cambio_plaza, null);
      assert.ok(a.plaza_validada_en);
      assert.equal(eventos("ASIGNACION_CREADA").length >= 1, true);
      assert.equal(eventos("ASIGNACION_NUEVA_TUTORIA").length, 1);
      assert.equal(eventos("ASIGNACION_NUEVO_PRACTICANTE").length, 1);
    });

    it("al quedar ACTIVA el estudiante abre su bitácora (BORRADOR) y el docente y el asesor ya ven al estudiante", async () => {
      const bit = await pedir(`/api/v1/practice-assignments/${solicitud}/logbook`, { token: estudiantes[1].token, metodo: "POST" });
      assert.ok([200, 201].includes(bit.estado), JSON.stringify(bit.json));
      const dato = bit.json.data.bitacora ?? bit.json.data;
      assert.equal(dato.estado, "BORRADOR");
      const tokenDocente = docente.token;
      const lista = await pedir("/api/v1/practice-assignments", { token: tokenDocente });
      assert.ok(lista.json.data.some((x) => x.id === solicitud));
      const lista2 = await pedir("/api/v1/practice-assignments", { token: asesorUnico.token });
      assert.ok(lista2.json.data.some((x) => x.id === solicitud));
    });

    it("no se puede asignar dos veces ni rechazar una práctica ya activa", async () => {
      const otra = await asignar(solicitud);
      assert.equal(otra.estado, 422);
      assert.equal(otra.json.error.code, "REQUEST_NOT_READY");
      const rechazo = await pedir(`/api/v1/practice-requests/${solicitud}/reject`, { token: tokenDirector, metodo: "POST", cuerpo: { motivo: "No procede" } });
      assert.equal(rechazo.estado, 422);
      assert.equal(rechazo.json.error.code, "REQUEST_NOT_REJECTABLE");
    });

    let conVarios;
    it("con varios asesores hay que elegir: el panel muestra cuántos practicantes tiene cada uno", async () => {
      conVarios = await listaParaAsignar(estudiantes[2], instDosAsesores);
      const sin = await asignar(conVarios);
      assert.equal(sin.estado, 422);
      assert.equal(sin.json.error.code, "ADVISOR_REQUIRED");
      assert.equal(sin.json.error.details.length, 2);
      const panel = await pedir(`/api/v1/practice-requests/${conVarios}/advisors`, { token: tokenDirector });
      assert.equal(panel.estado, 200, JSON.stringify(panel.json));
      assert.equal(panel.json.data.docente.id, docente.id);
      assert.equal(panel.json.data.asesores.length, 2);
      assert.ok(panel.json.data.asesores.every((a) => a.practicantes === 0));
      assert.equal(panel.json.data.asesor_unico, null);
      const unico = await pedir(`/api/v1/practice-requests/${solicitud}/advisors?institucion_id=${instUnAsesor}`, { token: tokenDirector });
      assert.equal(unico.json.data.asesor_unico, asesorUnico.id);
      assert.equal(unico.json.data.asesores[0].practicantes, 1);
    });

    it("elegir un asesor de otra institución se rechaza; con el asesor correcto se asigna", async () => {
      const mal = await asignar(conVarios, { asesor_sitio_id: asesorUnico.id });
      assert.equal(mal.estado, 422);
      assert.equal(mal.json.error.code, "ADVISOR_NOT_IN_INSTITUTION");
      const ok = await asignar(conVarios, { asesor_sitio_id: asesorB.id });
      assert.equal(ok.estado, 200, JSON.stringify(ok.json));
      assert.equal(ok.json.data.asesor.id, asesorB.id);
      const panel = await pedir(`/api/v1/practice-requests/${solicitud}/advisors?institucion_id=${instDosAsesores}`, { token: tokenDirector });
      const b = panel.json.data.asesores.find((a) => a.id === asesorB.id);
      assert.equal(b.practicantes, 1);
      assert.equal(panel.json.data.asesores[0].id, asesorA.id, "el asesor con menos practicantes aparece primero");
    });

    it("si el Director cambia la plaza debe dejar el motivo y queda registrada la elección original", async () => {
      const id = await listaParaAsignar(estudiantes[3], instUnAsesor);
      const sinMotivo = await asignar(id, { institucion_id: instDosAsesores, asesor_sitio_id: asesorA.id });
      assert.equal(sinMotivo.estado, 422);
      assert.equal(sinMotivo.json.error.code, "PLACE_CHANGE_REASON_REQUIRED");
      const ok = await asignar(id, { institucion_id: instDosAsesores, asesor_sitio_id: asesorA.id, motivo_cambio_plaza: "Está más cerca de su vivienda" });
      assert.equal(ok.estado, 200, JSON.stringify(ok.json));
      assert.equal(ok.json.data.institucion.id, instDosAsesores);
      assert.equal(ok.json.data.institucion_solicitada.id, instUnAsesor);
      assert.equal(ok.json.data.motivo_cambio_plaza, "Está más cerca de su vivienda");
    });

    it("una institución sin asesores activos impide asignar (NO_ADVISOR_AVAILABLE)", async () => {
      const id = await listaParaAsignar(estudiantes[4], instSinAsesor);
      const r = await asignar(id);
      assert.equal(r.estado, 422);
      assert.equal(r.json.error.code, "NO_ADVISOR_AVAILABLE");
      assert.equal(await estadoDe(id), "ENVIADA");
    });
  });

  // ───────── Bandeja y rechazo ─────────
  describe("bandeja del Director y rechazo", () => {
    it("la bandeja muestra las solicitudes abiertas y se filtra por estado; solo el Director la ve", async () => {
      const abiertas = await pedir("/api/v1/practice-requests", { token: tokenDirector });
      assert.equal(abiertas.estado, 200, JSON.stringify(abiertas.json));
      assert.ok(abiertas.json.data.every((a) => a.expediente && typeof a.expediente.expediente_completo === "boolean"), "cada fila trae el avance de su expediente");
      assert.ok(abiertas.json.data.every((a) => ["ENVIADA", "DEVUELTA", "DOCUMENTOS_APROBADOS", "PLAZA_SELECCIONADA"].includes(a.estado)));
      const enviadas = await pedir("/api/v1/practice-requests?estado=ENVIADA", { token: tokenDirector });
      assert.ok(enviadas.json.data.length >= 1);
      assert.ok(enviadas.json.data.every((a) => a.estado === "ENVIADA"));
      assert.equal((await pedir("/api/v1/practice-requests?estado=ACTIVA", { token: tokenDirector })).estado, 400);
      assert.equal((await pedir("/api/v1/practice-requests", { token: estudiantes[0].token })).estado, 403);
      assert.equal((await pedir("/api/v1/practice-requests", { token: docente.token })).estado, 403);
    });

    it("rechazar exige motivo; la solicitud pasa a RECHAZADA, avisa al estudiante y puede volver a solicitar", async () => {
      // estudiantes[4] quedó con su solicitud ENVIADA y aprobada (institución sin asesores).
      const fila = (await pool.query(
        `SELECT a.id FROM asignaciones_practica a JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id
          WHERE m.estudiante_id = $1 AND a.estado = 'ENVIADA'`, [estudiantes[4].id]
      )).rows[0].id;
      const ruta = `/api/v1/practice-requests/${fila}/reject`;
      assert.equal((await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: {} })).estado, 400);
      const r = await pedir(ruta, { token: tokenDirector, metodo: "POST", cuerpo: { motivo: "No hay plazas en esa institución" } });
      assert.equal(r.estado, 200, JSON.stringify(r.json));
      assert.equal(r.json.data.estado, "RECHAZADA");
      assert.equal(r.json.data.motivo_rechazo, "No hay plazas en esa institución");
      assert.equal(eventos("SOLICITUD_RECHAZADA").length, 1);
      const t = await pedir("/api/v1/me/practice-trajectory", { token: estudiantes[4].token });
      assert.equal(t.json.data.solicitud_abierta, null);
      assert.equal(t.json.data.nivel_propuesto.codigo, "PP1");
      const rechazadas = await pedir("/api/v1/practice-requests?estado=RECHAZADA", { token: tokenDirector });
      assert.ok(rechazadas.json.data.some((a) => a.id === fila));
    });
  });
});

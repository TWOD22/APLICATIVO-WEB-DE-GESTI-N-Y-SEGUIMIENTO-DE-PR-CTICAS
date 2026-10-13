/**
 * Pruebas de la exportación de la bitácora a PDF: contenido, alcance por rol y registro en auditoría.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, prepararEscenario, rechaza, REFLEXION_PRUEBA } from "../helpers/escenario.js";
import { textoDelPdf } from "../helpers/pdf.js";

/** Exportación de la bitácora a PDF: contenido por rol, independencia de evaluaciones, alcance y contrato HTTP. */
describe("Exportación de bitácora a PDF", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, exportacion, evaluaciones, bitacoras, servidor, base;
  let laura, mario, nora, docente, docente2, asesor, aj1, aj2, aj3, bitacoraLaura, bitacoraNora;
  let tokenLaura, tokenMario, tokenDirector;

  const E = (u) => esc.como("ESTUDIANTE", u);
  const D = (u) => esc.como("DOCENTE_SUPERVISOR", u);
  const A = (u) => esc.como("ASESOR_SITIO", u);
  const ctxDe = (u, rol) => esc.ctxDe(u, rol);
  const exportar = async (id, auth, rol) => {
    const r = await exportacion.exportarBitacora(id, auth, ctxDe({ id: auth.usuario.id, firebase_uid: auth.usuario.firebase_uid }, rol));
    return { ...r, texto: textoDelPdf(r.contenido) };
  };
  const idEval = async (asignacion, tipo) =>
    (await evaluaciones.listar({ limit: 10, offset: 0, asignacion_id: asignacion.id, tipo }, esc.director())).filas[0].id;
  const pedir = async (ruta, token) => {
    const r = await fetch(`${base}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { r, cuerpo: Buffer.from(await r.arrayBuffer()) };
  };

  before(async () => {
    esc = await prepararEscenario();
    exportacion = await import("../../src/services/exportService.js");
    evaluaciones = await import("../../src/services/evaluationService.js");
    bitacoras = await import("../../src/services/logbookService.js");
    const { crearApp } = await import("../../src/app.js");

    const estudiante = (n, nombres) => esc.persona({ rol: "ESTUDIANTE", documento: `210000000${n}`, nombres, apellidos: "Peña Núñez", correo: `est${n}@udi.test`, semestre: 1 });
    laura = await estudiante(1, "Laura");
    mario = await estudiante(2, "Mario");
    nora = await estudiante(3, "Nora");
    docente = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3100000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    docente2 = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3100000002", nombres: "Sara", apellidos: "Torres", correo: "sara@udi.test" });
    asesor = await esc.persona({ rol: "ASESOR_SITIO", documento: "4100000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: esc.inst.id });

    const completa = { docente_supervisor_id: docente.id, asesor_sitio_id: asesor.id };
    aj1 = await esc.crearAsignacion(laura, completa);
    aj2 = await esc.crearAsignacion(mario, completa);
    aj3 = await esc.crearAsignacion(nora, completa);
    bitacoraLaura = (await esc.entregarBitacora(aj1, laura)).bitacora_id;
    await esc.entregarBitacora(aj2, mario);

    // Nora: práctica habilitada pero bitácora todavía en borrador (sin enviar).
    await esc.habilitarBitacora(aj3, nora);
    bitacoraNora = (await bitacoras.obtenerDeAsignacion(aj3.id, E(nora))).id;

    tokenLaura = esc.firebase.emitirToken(laura.firebase_uid);
    tokenMario = esc.firebase.emitirToken(mario.firebase_uid);
    tokenDirector = esc.firebase.emitirToken("uid-director");
    servidor = crearApp().listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    if (esc?.cerrarPool) await esc.cerrarPool();
  });

  it("el estudiante exporta su bitácora enviada con datos, reflexión y evidencias", async () => {
    const { contenido, nombre_archivo: nombre, texto } = await exportar(bitacoraLaura, E(laura), "ESTUDIANTE");
    assert.ok(contenido.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"));
    assert.match(nombre, /^bitacora-[a-z0-9-]+-laura-pena-nunez\.pdf$/);
    for (const esperado of ["Bitácora de práctica pedagógica", "Laura Peña Núñez", "Jardín Uno", "Juan Suárez", "Ana Gómez", REFLEXION_PRUEBA, "foto.jpg", "Enviada", "Aún no hay evaluaciones publicadas."]) {
      assert.ok(texto.includes(esperado.slice(0, 60)), `falta: ${esperado}`);
    }
    assert.ok(!texto.includes("borrador: el contenido"), "una bitácora enviada no lleva aviso de borrador");
    // La evidencia de prueba son bytes falsos (no una imagen real): el PDF se genera igual y deja constancia.
    assert.ok(texto.includes("No se pudo incluir la imagen en este PDF"), "una imagen ilegible no impide exportar");
  });

  it("registra la exportación en la auditoría", async () => {
    const antes = esc.auditoria("BITACORA_EXPORTADA").length;
    await exportar(bitacoraLaura, E(laura), "ESTUDIANTE");
    const eventos = esc.auditoria("BITACORA_EXPORTADA");
    assert.equal(eventos.length, antes + 1);
    assert.equal(eventos.at(-1).entidad_id, bitacoraLaura);
    assert.equal(eventos.at(-1).actor_firebase_uid, laura.firebase_uid);
  });

  it("incluye solo evaluaciones publicadas y mantiene la independencia entre evaluadores", async () => {
    const idDocente = await idEval(aj1, "DOCENTE_SUPERVISOR");
    await evaluaciones.guardarBorrador(await idEval(aj1, "ASESOR_SITIO"), { nota: 1.11, retroalimentacion: "Borrador secreto del asesor" }, A(asesor));
    await evaluaciones.publicar(idDocente, { nota: 4.5, retroalimentacion: "Excelente análisis pedagógico" }, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR"));

    const estudiante = await exportar(bitacoraLaura, E(laura), "ESTUDIANTE");
    assert.ok(estudiante.texto.includes("Docente supervisor (nota académica)"));
    assert.ok(estudiante.texto.includes("4.50") && estudiante.texto.includes("Excelente análisis pedagógico"));
    assert.ok(estudiante.texto.includes("Juan Suárez"));
    assert.ok(!estudiante.texto.includes("Borrador secreto") && !estudiante.texto.includes("1.11"), "los borradores nunca se exportan");

    const director = await exportar(bitacoraLaura, esc.director(), "DIRECTOR_PROGRAMA");
    assert.ok(director.texto.includes("4.50") && !director.texto.includes("Borrador secreto"));

    const delDocente = await exportar(bitacoraLaura, D(docente), "DOCENTE_SUPERVISOR");
    assert.ok(delDocente.texto.includes("4.50"));

    // El asesor todavía no publicó: no ve la nota del docente.
    const delAsesor = await exportar(bitacoraLaura, A(asesor), "ASESOR_SITIO");
    assert.ok(!delAsesor.texto.includes("4.50") && !delAsesor.texto.includes("Excelente análisis"));
    assert.ok(delAsesor.texto.includes("Aún no hay evaluaciones publicadas."));

    await evaluaciones.publicar(await idEval(aj1, "ASESOR_SITIO"), { nota: 3.75, retroalimentacion: "Muy buena actitud en el aula" }, A(asesor), ctxDe(asesor, "ASESOR_SITIO"));
    const completo = await exportar(bitacoraLaura, E(laura), "ESTUDIANTE");
    assert.ok(completo.texto.includes("4.50") && completo.texto.includes("3.75") && completo.texto.includes("Evaluada"));
    assert.ok(!completo.texto.includes("Borrador secreto"));
    const soloAsesor = await exportar(bitacoraLaura, A(asesor), "ASESOR_SITIO");
    assert.ok(soloAsesor.texto.includes("3.75") && !soloAsesor.texto.includes("4.50"));
  });

  it("un borrador del estudiante se exporta con aviso; los evaluadores no lo ven", async () => {
    const propio = await exportar(bitacoraNora, E(nora), "ESTUDIANTE");
    assert.ok(propio.texto.includes("Este documento corresponde a un borrador"));
    assert.ok(propio.texto.includes("Borrador (aún no enviada)"));
    await rechaza(exportacion.exportarBitacora(bitacoraNora, D(docente), ctxDe(docente, "DOCENTE_SUPERVISOR")), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
    await rechaza(exportacion.exportarBitacora(bitacoraNora, A(asesor), ctxDe(asesor, "ASESOR_SITIO")), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
  });

  it("respeta el alcance: nadie exporta bitácoras ajenas", async () => {
    await rechaza(exportacion.exportarBitacora(bitacoraLaura, E(mario), ctxDe(mario, "ESTUDIANTE")), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
    await rechaza(exportacion.exportarBitacora(bitacoraLaura, D(docente2), ctxDe(docente2, "DOCENTE_SUPERVISOR")), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
    await rechaza(exportacion.exportarBitacora("00000000-0000-4000-8000-000000000000", esc.director(), esc.ctx), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
  });

  it("HTTP: entrega el archivo con sus cabeceras y valida acceso", async () => {
    assert.equal((await pedir(`/api/v1/logbooks/${bitacoraLaura}/export`)).r.status, 401);
    assert.equal((await pedir("/api/v1/logbooks/no-es-uuid/export", tokenLaura)).r.status, 400);
    assert.equal((await pedir(`/api/v1/logbooks/${bitacoraLaura}/export`, tokenMario)).r.status, 404);

    const { r, cuerpo } = await pedir(`/api/v1/logbooks/${bitacoraLaura}/export`, tokenLaura);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.match(r.headers.get("content-disposition"), /^attachment; filename="bitacora-[a-z0-9-]+-laura-pena-nunez\.pdf"; filename\*=UTF-8''bitacora-/);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    assert.equal(Number(r.headers.get("content-length")), cuerpo.length);
    assert.ok(cuerpo.subarray(0, 5).toString() === "%PDF-" && cuerpo.toString("latin1").trimEnd().endsWith("%%EOF"));

    const director = await pedir(`/api/v1/logbooks/${bitacoraLaura}/export`, tokenDirector);
    assert.equal(director.r.status, 200);
  });
});

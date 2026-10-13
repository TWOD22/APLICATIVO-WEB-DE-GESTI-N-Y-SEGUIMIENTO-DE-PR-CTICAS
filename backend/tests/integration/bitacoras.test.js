/**
 * Pruebas de servicio de bitácoras: bloqueo antes de aprobar documentos, borradores, evidencias, envío y devolución.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, JPG, PNG, PDF, prepararEscenario, rechaza } from "../helpers/escenario.js";

const REFLEXION = "Hoy acompañé al grupo de transición en una actividad de juego simbólico donde los niños construyeron una tienda con cajas y descubrieron cómo cooperar para repartir los roles del juego.";

describe("bitácoras, borradores, evidencias y envío + PostgreSQL real", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, bitacoras, evidencias, cuestionarios;
  let est1, est2, est3, est4, docente, docente2, asesor, asesor2, aj1, aj2, aj3, aj4;
  let preguntas; // { abierta, unica, multiple } del cuestionario v1
  let vista1; // bitácora de est1

  const E = (usuario) => esc.como("ESTUDIANTE", usuario);
  const D = (usuario) => esc.como("DOCENTE_SUPERVISOR", usuario);
  const A = (usuario) => esc.como("ASESOR_SITIO", usuario);
  const ctxEst = (usuario) => esc.ctxDe(usuario, "ESTUDIANTE");
  const draftFirestore = (id) => esc.firebase.estado.documentos.get(`borradores_bitacora/${id}`);
  const opcion = (pregunta, etiqueta) => pregunta.opciones.find((o) => o.etiqueta === etiqueta).id;
  const subirEvidencia = (id, usuario, extra = {}) =>
    evidencias.subir({ bitacoraId: id, contenido: JPG(), tipoMime: "image/jpeg", nombreArchivo: "foto.jpg", ...extra }, E(usuario), ctxEst(usuario));
  const guardar = (id, usuario, cuerpo) => bitacoras.guardarBorrador(id, cuerpo, E(usuario));
  const enviar = (id, usuario, revision_base, llave = "llave-de-prueba-1") =>
    bitacoras.enviar(id, { revision_base }, llave, E(usuario), ctxEst(usuario));
  const respuestasCompletas = () => [
    { pregunta_id: preguntas.abierta.id, texto: "Aprendí a escuchar las ideas de los niños." },
    { pregunta_id: preguntas.unica.id, opciones_ids: [opcion(preguntas.unica, "Bueno")] },
    { pregunta_id: preguntas.multiple.id, opciones_ids: [opcion(preguntas.multiple, "Juego"), opcion(preguntas.multiple, "Arte")] },
  ];
  /** Deja la bitácora lista para enviar y devuelve la revisión guardada. */
  const dejarCompleta = async (vista, usuario) => {
    await subirEvidencia(vista.id, usuario);
    const r = await guardar(vista.id, usuario, { revision_base: vista.contenido.revision, reflexion: REFLEXION, respuestas: respuestasCompletas() });
    return r.revision;
  };
  const filas = async (sql, parametros = []) => (await esc.pool.query(sql, parametros)).rows;

  before(async () => {
    esc = await prepararEscenario();
    bitacoras = await import("../../src/services/logbookService.js");
    evidencias = await import("../../src/services/evidenceService.js");
    cuestionarios = await import("../../src/services/questionnaireService.js");

    const estudiante = (n, nombres) => esc.persona({ rol: "ESTUDIANTE", documento: `200000000${n}`, nombres, apellidos: "Prueba", correo: `est${n}@udi.test`, semestre: 1 });
    est1 = await estudiante(1, "Laura");
    est2 = await estudiante(2, "Mario");
    est3 = await estudiante(3, "Nora");
    est4 = await estudiante(4, "Pablo");
    docente = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3000000001", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" });
    docente2 = await esc.persona({ rol: "DOCENTE_SUPERVISOR", documento: "3000000002", nombres: "Sara", apellidos: "Torres", correo: "sara@udi.test" });
    asesor = await esc.persona({ rol: "ASESOR_SITIO", documento: "4000000001", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: esc.inst.id });
    asesor2 = await esc.persona({ rol: "ASESOR_SITIO", documento: "4000000002", nombres: "Luis", apellidos: "Mora", correo: "luis@jardin2.test", institucion_id: esc.inst2.id });

    const completa = { docente_supervisor_id: docente.id, asesor_sitio_id: asesor.id };
    aj1 = await esc.crearAsignacion(est1, completa);
    aj2 = await esc.crearAsignacion(est2, completa);
    aj3 = await esc.crearAsignacion(est3); // sin docente ni asesor
    aj4 = await esc.crearAsignacion(est4, completa);

    // Cuestionario del nivel 1: una abierta obligatoria, una cerrada única obligatoria y una múltiple opcional.
    const c = await cuestionarios.crear({ nivel_practica_id: esc.niveles[1], sin_copia: true }, esc.ctx);
    await cuestionarios.agregarPregunta(c.id, { tipo: "ABIERTA", enunciado: "¿Qué aprendiste?", obligatoria: true });
    await cuestionarios.agregarPregunta(c.id, { tipo: "CERRADA_UNICA", enunciado: "¿Cómo fue el clima?", obligatoria: true, opciones: [{ etiqueta: "Excelente" }, { etiqueta: "Bueno" }] });
    await cuestionarios.agregarPregunta(c.id, { tipo: "CERRADA_MULTIPLE", enunciado: "¿Qué estrategias usaste?", obligatoria: false, opciones: [{ etiqueta: "Juego" }, { etiqueta: "Arte" }] });
    const publicado = await cuestionarios.publicar(c.id, esc.ctx);
    preguntas = { abierta: publicado.preguntas[0], unica: publicado.preguntas[1], multiple: publicado.preguntas[2] };
  });

  after(async () => {
    if (esc?.cerrarPool) await esc.cerrarPool();
  });

  describe("antes de aprobar los documentos", () => {
    it("la bitácora nace BLOQUEADA, sin cuestionario ni edición, y obtenerla de nuevo no la duplica", async () => {
      const primera = await bitacoras.obtenerDeAsignacion(aj1.id, E(est1));
      assert.equal(primera.estado, "BLOQUEADA");
      assert.equal(primera.creada, true);
      assert.equal(primera.editable, false);
      assert.equal(primera.cuestionario, null);
      assert.equal(primera.contenido.origen, "VACIO");
      const segunda = await bitacoras.obtenerDeAsignacion(aj1.id, E(est1));
      assert.equal(segunda.id, primera.id);
      assert.equal(segunda.creada, false);
      assert.equal((await filas("SELECT count(*)::int AS n FROM bitacoras WHERE asignacion_practica_id = $1", [aj1.id]))[0].n, 1);
    });

    it("no se puede guardar borrador ni subir evidencias mientras esté bloqueada", async () => {
      const { id } = await bitacoras.obtenerDeAsignacion(aj1.id, E(est1));
      await rechaza(guardar(id, est1, { revision_base: 0, reflexion: "hola", respuestas: [] }), { estado: 422, codigo: "LOGBOOK_LOCKED" });
      await rechaza(subirEvidencia(id, est1), { estado: 422, codigo: "LOGBOOK_LOCKED" });
      await rechaza(enviar(id, est1, 0), { estado: 422, codigo: "LOGBOOK_LOCKED" });
    });

    it("solo el dueño la ve; Dirección la consulta; docente, asesor y otros estudiantes no", async () => {
      const { id } = await bitacoras.obtenerDeAsignacion(aj1.id, E(est1));
      await rechaza(bitacoras.obtener(id, E(est2)), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
      await rechaza(bitacoras.obtenerDeAsignacion(aj1.id, E(est2)), { estado: 404, codigo: "ASSIGNMENT_NOT_FOUND" });
      // Evaluadores no ven nada hasta que se envíe
      await rechaza(bitacoras.obtener(id, D(docente)), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
      await rechaza(bitacoras.obtener(id, A(asesor)), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
      assert.equal((await bitacoras.obtener(id, esc.director())).estado, "BLOQUEADA");
      // Para Dirección una práctica sin bitácora creada responde 404 (la UI muestra "no habilitada")
      await rechaza(bitacoras.obtenerDeAsignacion(aj2.id, esc.director()), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
    });

    it("solo el estudiante puede modificar", async () => {
      const { id } = await bitacoras.obtenerDeAsignacion(aj1.id, E(est1));
      await rechaza(bitacoras.guardarBorrador(id, { revision_base: 0, reflexion: "x", respuestas: [] }, esc.director()), { estado: 403 });
      await rechaza(bitacoras.guardarBorrador(id, { revision_base: 0, reflexion: "x", respuestas: [] }, D(docente)), { estado: 403 });
    });
  });

  describe("con el expediente aprobado", () => {
    before(async () => {
      for (const [aj, est] of [[aj1, est1], [aj2, est2], [aj3, est3], [aj4, est4]]) await esc.habilitarBitacora(aj, est);
    });

    it("se habilita (BORRADOR) y toma el cuestionario vigente", async () => {
      vista1 = await bitacoras.obtenerDeAsignacion(aj1.id, E(est1));
      assert.equal(vista1.estado, "BORRADOR");
      assert.equal(vista1.editable, true);
      assert.equal(vista1.cuestionario.numero_version, 1);
      assert.equal(vista1.cuestionario.preguntas.length, 3);
      assert.equal(vista1.contenido.revision, 0);
      assert.equal(vista1.contenido.reflexion, "");
      assert.equal(vista1.requisitos.listo_para_enviar, false);
      assert.equal(vista1.requisitos.preguntas_obligatorias_pendientes.length, 2);
      assert.equal(vista1.asignacion.docente.nombre_completo, "Juan Suárez");
      const [fila] = await filas("SELECT cuestionario_id FROM bitacoras WHERE id = $1", [vista1.id]);
      assert.equal(fila.cuestionario_id, vista1.cuestionario.id);
    });

    describe("borrador (Firestore)", () => {
      it("autoguarda con control de revisión: una pestaña desactualizada recibe DRAFT_CONFLICT", async () => {
        const r1 = await guardar(vista1.id, est1, { revision_base: 0, reflexion: "Primer texto", respuestas: [] });
        assert.equal(r1.revision, 1);
        assert.ok(r1.guardado_en);
        assert.equal(r1.requisitos.palabras, 2);
        const r2 = await guardar(vista1.id, est1, { revision_base: 1, reflexion: "Primer texto, ampliado", respuestas: [] });
        assert.equal(r2.revision, 2);
        // La otra pestaña todavía cree que va por la revisión 1
        await assert.rejects(guardar(vista1.id, est1, { revision_base: 1, reflexion: "pisando", respuestas: [] }), (e) => {
          assert.equal(e.estado_http, 409);
          assert.equal(e.codigo, "DRAFT_CONFLICT");
          assert.deepEqual(e.detalles, [{ revision_actual: 2 }]);
          return true;
        });
        assert.equal(draftFirestore(vista1.id).reflexion, "Primer texto, ampliado", "el texto de la pestaña vieja no pisó el borrador");
      });

      it("el borrador vive en Firestore: PostgreSQL no guarda la reflexión hasta el envío", async () => {
        const [fila] = await filas("SELECT reflexion FROM bitacoras WHERE id = $1", [vista1.id]);
        assert.equal(fila.reflexion, null);
        assert.equal((await filas("SELECT count(*)::int AS n FROM respuestas_bitacora WHERE bitacora_id = $1", [vista1.id]))[0].n, 0);
        const releida = await bitacoras.obtener(vista1.id, E(est1));
        assert.equal(releida.contenido.reflexion, "Primer texto, ampliado");
        assert.equal(releida.contenido.revision, 2);
        assert.equal(draftFirestore(vista1.id).propietario_uid, est1.firebase_uid);
      });

      it("rechaza respuestas que no corresponden al cuestionario", async () => {
        const base = { revision_base: 2, reflexion: "x", respuestas: [] };
        const intento = (respuestas) => guardar(vista1.id, est1, { ...base, respuestas });
        await rechaza(intento([{ pregunta_id: "00000000-0000-4000-8000-000000000000", texto: "a" }]), { estado: 422, codigo: "INVALID_ANSWER" });
        await rechaza(intento([{ pregunta_id: preguntas.unica.id, opciones_ids: [opcion(preguntas.unica, "Excelente"), opcion(preguntas.unica, "Bueno")] }]), { estado: 422, codigo: "INVALID_ANSWER" });
        await rechaza(intento([{ pregunta_id: preguntas.unica.id, opciones_ids: [opcion(preguntas.multiple, "Juego")] }]), { estado: 422, codigo: "INVALID_ANSWER" });
        await rechaza(intento([{ pregunta_id: preguntas.unica.id, texto: "texto en pregunta cerrada" }]), { estado: 422, codigo: "INVALID_ANSWER" });
        await rechaza(intento([{ pregunta_id: preguntas.abierta.id, opciones_ids: [opcion(preguntas.unica, "Bueno")] }]), { estado: 422, codigo: "INVALID_ANSWER" });
        await rechaza(intento([{ pregunta_id: preguntas.abierta.id, texto: "a" }, { pregunta_id: preguntas.abierta.id, texto: "b" }]), { estado: 422, codigo: "INVALID_ANSWER" });
        assert.equal(draftFirestore(vista1.id).revision, 2, "los intentos inválidos no alteraron el borrador");
      });

      it("si Firestore no responde, el autoguardado falla con un error claro (no se simula éxito)", async () => {
        esc.firebase.estado.fallar.firestore = true;
        try {
          await rechaza(guardar(vista1.id, est1, { revision_base: 2, reflexion: "x", respuestas: [] }), { estado: 502, codigo: "DRAFT_STORE_ERROR" });
          await rechaza(bitacoras.obtener(vista1.id, E(est1)), { estado: 502, codigo: "DRAFT_STORE_ERROR" });
        } finally {
          esc.firebase.estado.fallar.firestore = false;
        }
        assert.equal((await bitacoras.obtener(vista1.id, E(est1))).contenido.revision, 2);
      });
    });

    describe("evidencias", () => {
      it("acepta JPG, PNG y PDF válidos y los lista en orden", async () => {
        const jpg = await subirEvidencia(vista1.id, est1, { descripcion: "Actividad de juego" });
        const png = await subirEvidencia(vista1.id, est1, { contenido: PNG(), tipoMime: "image/png", nombreArchivo: "mural.PNG" });
        const pdf = await subirEvidencia(vista1.id, est1, { contenido: PDF, tipoMime: "application/pdf", nombreArchivo: "planeacion.pdf" });
        assert.deepEqual([jpg.orden, png.orden, pdf.orden], [1, 2, 3]);
        assert.equal(jpg.es_imagen, true);
        assert.equal(pdf.es_imagen, false);
        assert.equal(jpg.descripcion, "Actividad de juego");
        const lista = (await bitacoras.obtener(vista1.id, E(est1))).evidencias;
        assert.deepEqual(lista.map((e) => e.nombre), ["foto.jpg", "mural.PNG", "planeacion.pdf"]);
        const [archivo] = await filas("SELECT ruta_almacenamiento, hash_sha256, estado FROM archivos a JOIN evidencias_bitacora e ON e.archivo_id = a.id WHERE e.id = $1", [jpg.id]);
        assert.match(archivo.ruta_almacenamiento, new RegExp(`^bitacoras/[0-9a-f-]{36}/${vista1.id}/evidencias/[0-9a-f-]{36}\\.jpg$`));
        assert.match(archivo.hash_sha256, /^[0-9a-f]{64}$/);
        assert.equal(archivo.estado, "DISPONIBLE");
        assert.ok(esc.almacen.has(archivo.ruta_almacenamiento));
        assert.equal(esc.auditoria("EVIDENCIA_CARGADA").length, 3);
      });

      it("valida el contenido real, la extensión, el tamaño y el formato", async () => {
        const intento = (extra) => subirEvidencia(vista1.id, est1, extra);
        await rechaza(intento({ contenido: Buffer.alloc(0) }), { estado: 400, codigo: "FILE_REQUIRED" });
        await rechaza(intento({ contenido: undefined }), { estado: 400, codigo: "FILE_REQUIRED" });
        await rechaza(intento({ contenido: Buffer.from("GIF89a....."), tipoMime: "image/gif", nombreArchivo: "a.gif" }), { estado: 422, codigo: "FILE_TYPE_NOT_ALLOWED" });
        await rechaza(intento({ contenido: Buffer.from("MZ ejecutable disfrazado de foto") }), { estado: 422, codigo: "FILE_NOT_READABLE" });
        await rechaza(intento({ contenido: PNG(), tipoMime: "image/jpeg" }), { estado: 422, codigo: "FILE_NOT_READABLE" }); // PNG que dice ser JPG
        await rechaza(intento({ contenido: JPG().subarray(0, 10) }), { estado: 422, codigo: "FILE_NOT_READABLE" }); // JPG truncado
        await rechaza(intento({ nombreArchivo: "foto.png" }), { estado: 422, codigo: "FILE_EXTENSION_NOT_ALLOWED" });
        await rechaza(intento({ contenido: JPG(10 * 1024 * 1024) }), { estado: 413, codigo: "FILE_TOO_LARGE" });
        await rechaza(intento({ descripcion: "x".repeat(501) }), { estado: 400, codigo: "VALIDATION_ERROR" });
        assert.equal((await filas("SELECT count(*)::int AS n FROM evidencias_bitacora WHERE bitacora_id = $1", [vista1.id]))[0].n, 3, "los rechazos no dejaron registros");
      });

      it("el nombre se sanea (sin rutas) y solo el dueño puede cargar", async () => {
        const ev = await subirEvidencia(vista1.id, est1, { nombreArchivo: "..\\..\\etc/pasaporte.jpg" });
        assert.equal(ev.nombre, "pasaporte.jpg");
        await evidencias.eliminar(vista1.id, ev.id, E(est1), ctxEst(est1));
        await rechaza(subirEvidencia(vista1.id, est2), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
        await rechaza(evidencias.subir({ bitacoraId: vista1.id, contenido: JPG(), tipoMime: "image/jpeg", nombreArchivo: "x.jpg" }, D(docente), esc.ctx), { estado: 403 });
      });

      it("edita la descripción y retira evidencias de forma lógica (el archivo se conserva)", async () => {
        const lista = (await bitacoras.obtener(vista1.id, E(est1))).evidencias;
        const editada = await evidencias.actualizarDescripcion(vista1.id, lista[1].id, { descripcion: "Mural del aula" }, E(est1));
        assert.equal(editada.descripcion, "Mural del aula");
        const extra = await subirEvidencia(vista1.id, est1, { nombreArchivo: "borrar.jpg" });
        const [{ ruta_almacenamiento: ruta }] = await filas("SELECT a.ruta_almacenamiento FROM archivos a JOIN evidencias_bitacora e ON e.archivo_id = a.id WHERE e.id = $1", [extra.id]);
        await evidencias.eliminar(vista1.id, extra.id, E(est1), ctxEst(est1));
        assert.equal((await bitacoras.obtener(vista1.id, E(est1))).evidencias.length, 3);
        assert.equal((await filas("SELECT count(*)::int AS n FROM evidencias_bitacora WHERE id = $1 AND eliminado_en IS NOT NULL", [extra.id]))[0].n, 1);
        assert.ok(esc.almacen.has(ruta), "el archivo no se borra del almacenamiento");
        assert.ok(!esc.eliminados.includes(ruta));
        await rechaza(evidencias.eliminar(vista1.id, extra.id, E(est1), ctxEst(est1)), { estado: 404, codigo: "EVIDENCE_NOT_FOUND" });
        assert.equal(esc.auditoria("EVIDENCIA_ELIMINADA").length, 2);
      });

      it("limita a 20 evidencias por bitácora", async () => {
        const v = await bitacoras.obtenerDeAsignacion(aj4.id, E(est4));
        for (let i = 0; i < 20; i += 1) await subirEvidencia(v.id, est4, { contenido: JPG(16 + i), nombreArchivo: `f${i}.jpg` });
        await rechaza(subirEvidencia(v.id, est4, { contenido: JPG(99) }), { estado: 422, codigo: "EVIDENCE_LIMIT_REACHED" });
      });

      it("si falla el registro en PostgreSQL se retira el archivo huérfano", async () => {
        const antes = esc.almacen.size;
        await esc.pool.query("ALTER TABLE evidencias_bitacora ADD CONSTRAINT ck_prueba_falla CHECK (false) NOT VALID");
        try {
          await assert.rejects(subirEvidencia(vista1.id, est1, { contenido: JPG(77), nombreArchivo: "falla.jpg" }));
        } finally {
          await esc.pool.query("ALTER TABLE evidencias_bitacora DROP CONSTRAINT ck_prueba_falla");
        }
        assert.equal(esc.almacen.size, antes, "no quedaron archivos huérfanos");
        assert.equal(esc.eliminados.length > 0, true);
      });
    });

    describe("envío", () => {
      it("la revisión debe coincidir con la última guardada", async () => {
        await rechaza(enviar(vista1.id, est1, 1), { estado: 409, codigo: "DRAFT_CONFLICT" });
      });

      it("detalla qué falta cuando la bitácora está incompleta", async () => {
        // Reflexión corta, evidencias sí, sin responder las obligatorias
        await assert.rejects(enviar(vista1.id, est1, 2), (e) => {
          assert.equal(e.estado_http, 422);
          assert.equal(e.codigo, "LOGBOOK_INCOMPLETE");
          const campos = e.detalles.map((d) => d.campo);
          assert.deepEqual(campos, ["reflexion", "respuestas", "respuestas"]);
          assert.deepEqual(e.detalles.filter((d) => d.pregunta_id).map((d) => d.pregunta_id).sort(), [preguntas.abierta.id, preguntas.unica.id].sort());
          return true;
        });
        // La opcional no es obligatoria; sin evidencias (est4 las tiene, est2 no): se informa
        const v2 = await bitacoras.obtenerDeAsignacion(aj2.id, E(est2));
        const r = await guardar(v2.id, est2, { revision_base: 0, reflexion: REFLEXION, respuestas: respuestasCompletas() });
        await assert.rejects(enviar(v2.id, est2, r.revision), (e) => {
          assert.equal(e.codigo, "LOGBOOK_INCOMPLETE");
          assert.deepEqual(e.detalles.map((d) => d.campo), ["evidencias"]);
          return true;
        });
        // Nada oficial se escribió en los intentos fallidos
        assert.equal((await filas("SELECT estado FROM bitacoras WHERE id = $1", [vista1.id]))[0].estado, "BORRADOR");
        assert.equal((await filas("SELECT count(*)::int AS n FROM evaluaciones WHERE bitacora_id = $1", [vista1.id]))[0].n, 0);
      });

      it("sin docente y asesor asignados no se puede enviar (EVALUATORS_MISSING)", async () => {
        const v3 = await bitacoras.obtenerDeAsignacion(aj3.id, E(est3));
        const revision = await dejarCompleta(v3, est3);
        await rechaza(enviar(v3.id, est3, revision), { estado: 422, codigo: "EVALUATORS_MISSING" });
        assert.equal((await filas("SELECT estado FROM bitacoras WHERE id = $1", [v3.id]))[0].estado, "BORRADOR");
      });

      it("envía una vez: copia a las tablas oficiales, crea las dos evaluaciones y pasa la práctica a evaluación", async () => {
        const revision = (await guardar(vista1.id, est1, { revision_base: 2, reflexion: REFLEXION, respuestas: respuestasCompletas() })).revision;
        const resultado = await enviar(vista1.id, est1, revision, "llave-envio-laura-01");
        assert.equal(resultado.estado, "ENVIADA");
        assert.equal(resultado.idempotente, false);
        assert.deepEqual(resultado.evaluaciones.map((e) => [e.tipo, e.estado]), [["DOCENTE_SUPERVISOR", "PENDIENTE"], ["ASESOR_SITIO", "PENDIENTE"]]);

        const [bit] = await filas("SELECT estado, reflexion, numero_revision_borrador, enviada_en, llave_idempotencia FROM bitacoras WHERE id = $1", [vista1.id]);
        assert.equal(bit.estado, "ENVIADA");
        assert.equal(bit.reflexion, REFLEXION);
        assert.equal(bit.numero_revision_borrador, revision);
        assert.ok(bit.enviada_en);
        assert.equal(bit.llave_idempotencia, `${vista1.id}:llave-envio-laura-01`);

        const resp = await filas("SELECT pregunta_id, respuesta_texto, (SELECT count(*)::int FROM respuestas_opciones o WHERE o.respuesta_bitacora_id = r.id) AS n FROM respuestas_bitacora r WHERE bitacora_id = $1 ORDER BY pregunta_id", [vista1.id]);
        assert.equal(resp.length, 3);
        assert.equal(resp.find((r) => r.pregunta_id === preguntas.abierta.id).respuesta_texto, "Aprendí a escuchar las ideas de los niños.");
        assert.equal(resp.find((r) => r.pregunta_id === preguntas.multiple.id).n, 2);

        const evs = await filas("SELECT evaluador_id, tipo_evaluador, estado, nota FROM evaluaciones WHERE asignacion_practica_id = $1 AND eliminado_en IS NULL ORDER BY tipo_evaluador", [aj1.id]);
        assert.deepEqual(evs.map((e) => [e.tipo_evaluador, e.evaluador_id, e.estado, e.nota]), [["DOCENTE_SUPERVISOR", docente.id, "PENDIENTE", null], ["ASESOR_SITIO", asesor.id, "PENDIENTE", null]]);
        assert.equal((await filas("SELECT estado FROM asignaciones_practica WHERE id = $1", [aj1.id]))[0].estado, "PENDIENTE_EVALUACION");

        assert.equal(draftFirestore(vista1.id).bloqueado, true, "el borrador queda bloqueado");
        assert.equal(esc.auditoria("BITACORA_ENVIADA").length, 1);
        assert.equal(esc.avisos("BITACORA_ENVIADA", docente.firebase_uid).length, 1);
        assert.equal(esc.avisos("BITACORA_ENVIADA", asesor.firebase_uid).length, 1);
        assert.equal(esc.avisos("BITACORA_RECIBIDA", est1.firebase_uid).length, 1);
      });

      it("repetir el envío con la misma llave devuelve el resultado original sin duplicar nada", async () => {
        const r = await enviar(vista1.id, est1, 99, "llave-envio-laura-01");
        assert.equal(r.idempotente, true);
        assert.equal(r.estado, "ENVIADA");
        assert.equal((await filas("SELECT count(*)::int AS n FROM evaluaciones WHERE bitacora_id = $1 AND eliminado_en IS NULL", [vista1.id]))[0].n, 2);
        assert.equal(esc.auditoria("BITACORA_ENVIADA").length, 1);
        assert.equal(esc.avisos("BITACORA_ENVIADA", docente.firebase_uid).length, 1);
      });

      it("con otra llave, una bitácora ya enviada responde 409", async () => {
        await rechaza(enviar(vista1.id, est1, 2, "llave-distinta-xyz"), { estado: 409, codigo: "LOGBOOK_ALREADY_SUBMITTED" });
      });

      it("enviada, ya no se edita: ni borrador, ni evidencias, ni descripciones", async () => {
        const [evidencia] = (await bitacoras.obtener(vista1.id, E(est1))).evidencias;
        await rechaza(guardar(vista1.id, est1, { revision_base: 3, reflexion: "cambio", respuestas: [] }), { estado: 409, codigo: "LOGBOOK_ALREADY_SUBMITTED" });
        await rechaza(subirEvidencia(vista1.id, est1), { estado: 409, codigo: "LOGBOOK_ALREADY_SUBMITTED" });
        await rechaza(evidencias.eliminar(vista1.id, evidencia.id, E(est1), ctxEst(est1)), { estado: 409, codigo: "LOGBOOK_ALREADY_SUBMITTED" });
        await rechaza(evidencias.actualizarDescripcion(vista1.id, evidencia.id, { descripcion: "otra" }, E(est1)), { estado: 409, codigo: "LOGBOOK_ALREADY_SUBMITTED" });
      });

      it("dos envíos simultáneos con la misma llave se resuelven en uno solo", async () => {
        const v = await bitacoras.obtenerDeAsignacion(aj4.id, E(est4));
        const revision = (await guardar(v.id, est4, { revision_base: v.contenido.revision, reflexion: REFLEXION, respuestas: respuestasCompletas() })).revision;
        const [a, b] = await Promise.all([enviar(v.id, est4, revision, "llave-carrera-est4"), enviar(v.id, est4, revision, "llave-carrera-est4")]);
        assert.deepEqual([a.idempotente, b.idempotente].sort(), [false, true]);
        assert.equal((await filas("SELECT count(*)::int AS n FROM evaluaciones WHERE bitacora_id = $1", [v.id]))[0].n, 2);
        assert.equal(esc.auditoria("BITACORA_ENVIADA").filter((e) => e.entidad_id === v.id).length, 1);
      });
    });

    describe("consulta de la entrega", () => {
      it("docente y asesor asignados ven la bitácora enviada (solo lectura) con sus evidencias", async () => {
        for (const rol of [D(docente), A(asesor)]) {
          const v = await bitacoras.obtener(vista1.id, rol);
          assert.equal(v.estado, "ENVIADA");
          assert.equal(v.editable, false);
          assert.equal(v.contenido.origen, "OFICIAL");
          assert.equal(v.contenido.reflexion, REFLEXION);
          assert.equal(v.contenido.respuestas.length, 3);
          assert.equal(v.evidencias.length, 3);
          assert.equal((await bitacoras.obtenerDeAsignacion(aj1.id, rol)).id, v.id);
        }
      });

      it("evaluadores y estudiantes ajenos reciben 404", async () => {
        await rechaza(bitacoras.obtener(vista1.id, D(docente2)), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
        await rechaza(bitacoras.obtener(vista1.id, A(asesor2)), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
        await rechaza(bitacoras.obtener(vista1.id, E(est2)), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
      });

      it("las evidencias se descargan con URL firmada solo con acceso a la bitácora", async () => {
        const [evidencia] = (await bitacoras.obtener(vista1.id, E(est1))).evidencias;
        for (const rol of [E(est1), esc.director(), D(docente), A(asesor)]) {
          const r = await evidencias.urlDeDescarga(vista1.id, evidencia.id, rol);
          assert.match(r.url, /^https:\/\/storage\.test\/bitacoras\//);
          assert.equal(r.nombre, "foto.jpg");
        }
        await rechaza(evidencias.urlDeDescarga(vista1.id, evidencia.id, D(docente2)), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
        await rechaza(evidencias.urlDeDescarga(vista1.id, evidencia.id, E(est2)), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
        await rechaza(evidencias.urlDeDescarga(vista1.id, "00000000-0000-4000-8000-000000000000", E(est1)), { estado: 404, codigo: "EVIDENCE_NOT_FOUND" });
      });
    });

    describe("devolución", () => {
      it("solo se devuelve una bitácora enviada, y con motivo", async () => {
        const borrador = await bitacoras.obtenerDeAsignacion(aj2.id, E(est2));
        await rechaza(bitacoras.devolver(borrador.id, { motivo: "Falta detalle" }, esc.ctx), { estado: 422, codigo: "INVALID_LOGBOOK_TRANSITION" });
        await rechaza(bitacoras.devolver("00000000-0000-4000-8000-000000000000", { motivo: "Falta detalle" }, esc.ctx), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });
      });

      it("no se devuelve si un evaluador ya publicó su nota", async () => {
        await esc.pool.query("UPDATE evaluaciones SET estado = 'PUBLICADA', nota = 4.5, publicada_en = now() WHERE bitacora_id = $1 AND tipo_evaluador = 'ASESOR_SITIO'", [vista1.id]);
        await rechaza(bitacoras.devolver(vista1.id, { motivo: "Falta detalle" }, esc.ctx), { estado: 422, codigo: "EVALUATION_ALREADY_PUBLISHED" });
        await esc.pool.query("UPDATE evaluaciones SET estado = 'BORRADOR', nota = NULL, publicada_en = NULL WHERE bitacora_id = $1 AND tipo_evaluador = 'ASESOR_SITIO'", [vista1.id]);
      });

      it("devuelve: la práctica vuelve a ACTIVA, se retiran las evaluaciones y el estudiante recibe su contenido para corregir", async () => {
        const r = await bitacoras.devolver(vista1.id, { motivo: "Amplía la reflexión con un ejemplo concreto" }, esc.ctx);
        assert.equal(r.estado, "DEVUELTA");
        assert.equal((await filas("SELECT estado FROM asignaciones_practica WHERE id = $1", [aj1.id]))[0].estado, "ACTIVA");
        assert.equal((await filas("SELECT count(*)::int AS n FROM evaluaciones WHERE bitacora_id = $1 AND eliminado_en IS NULL", [vista1.id]))[0].n, 0);
        assert.equal(esc.auditoria("BITACORA_DEVUELTA").length, 1);
        assert.equal(esc.avisos("BITACORA_DEVUELTA", est1.firebase_uid).length, 1);

        // Los evaluadores dejan de verla
        await rechaza(bitacoras.obtener(vista1.id, D(docente)), { estado: 404, codigo: "LOGBOOK_NOT_FOUND" });

        const v = await bitacoras.obtener(vista1.id, E(est1));
        assert.equal(v.estado, "DEVUELTA");
        assert.equal(v.editable, true);
        assert.equal(v.motivo_devolucion, "Amplía la reflexión con un ejemplo concreto");
        assert.equal(v.contenido.reflexion, REFLEXION, "parte de lo que entregó");
        assert.equal(v.contenido.respuestas.length, 3);
        assert.equal(v.evidencias.length, 3);
        assert.equal(draftFirestore(vista1.id).bloqueado, false);
        assert.ok(v.contenido.revision >= 4);
      });

      it("el estudiante corrige y reenvía con una llave nueva: se recrean las dos evaluaciones", async () => {
        const v = await bitacoras.obtener(vista1.id, E(est1));
        const guardado = await guardar(vista1.id, est1, {
          revision_base: v.contenido.revision,
          reflexion: `${REFLEXION} Además, observé cómo Mateo propuso turnos para la caja registradora.`,
          respuestas: respuestasCompletas(),
        });
        // Una solicitud repetida y tardía con la llave del envío anterior NO reenvía la entrega
        await rechaza(enviar(vista1.id, est1, guardado.revision, "llave-envio-laura-01"), { estado: 409, codigo: "IDEMPOTENCY_KEY_REUSED" });
        assert.equal((await filas("SELECT estado FROM bitacoras WHERE id = $1", [vista1.id]))[0].estado, "DEVUELTA");
        const r = await enviar(vista1.id, est1, guardado.revision, "llave-envio-laura-02");
        assert.equal(r.estado, "ENVIADA");
        assert.equal(r.idempotente, false);
        const evs = await filas("SELECT eliminado_en FROM evaluaciones WHERE bitacora_id = $1", [vista1.id]);
        assert.equal(evs.length, 4);
        assert.equal(evs.filter((e) => e.eliminado_en === null).length, 2);
        const [bit] = await filas("SELECT reflexion, devuelta_en, motivo_devolucion FROM bitacoras WHERE id = $1", [vista1.id]);
        assert.match(bit.reflexion, /Mateo propuso turnos/);
        assert.equal(bit.devuelta_en, null);
        assert.equal(bit.motivo_devolucion, null);
        assert.equal((await filas("SELECT count(*)::int AS n FROM respuestas_bitacora WHERE bitacora_id = $1 AND eliminado_en IS NULL", [vista1.id]))[0].n, 3, "las respuestas anteriores se retiraron, no se duplicaron");
        assert.equal((await filas("SELECT estado FROM asignaciones_practica WHERE id = $1", [aj1.id]))[0].estado, "PENDIENTE_EVALUACION");
      });
    });

    describe("versionado de cuestionarios frente a bitácoras ya iniciadas", () => {
      it("una nueva versión no altera las bitácoras existentes; las nuevas toman la vigente", async () => {
        const nuevaVersion = await cuestionarios.crear({ nivel_practica_id: esc.niveles[1] }, esc.ctx);
        await cuestionarios.agregarPregunta(nuevaVersion.id, { tipo: "ABIERTA", enunciado: "Pregunta solo de la versión 2", obligatoria: false });
        await cuestionarios.publicar(nuevaVersion.id, esc.ctx);

        assert.equal((await bitacoras.obtener(vista1.id, E(est1))).cuestionario.numero_version, 1, "la bitácora de Laura conserva la v1");
        assert.equal((await bitacoras.obtenerDeAsignacion(aj2.id, E(est2))).cuestionario.numero_version, 1, "la de Mario ya estaba enlazada a la v1");

        // Una práctica nueva (sin bitácora previa) toma la v2
        const est5 = await esc.persona({ rol: "ESTUDIANTE", documento: "2000000005", nombres: "Elena", apellidos: "Prueba", correo: "est5@udi.test", semestre: 1 });
        const aj5 = await esc.crearAsignacion(est5, { docente_supervisor_id: docente.id, asesor_sitio_id: asesor.id });
        await esc.habilitarBitacora(aj5, est5);
        const v5 = await bitacoras.obtenerDeAsignacion(aj5.id, E(est5));
        assert.equal(v5.cuestionario.numero_version, 2);
        assert.equal(v5.cuestionario.preguntas.length, 4);
      });
    });
  });
});

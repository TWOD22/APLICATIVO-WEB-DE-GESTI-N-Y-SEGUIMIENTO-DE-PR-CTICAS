/**
 * Pruebas de cuestionarios: edición del borrador, preguntas y opciones, publicación e inmutabilidad, y versionado.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, prepararEscenario, rechaza } from "../helpers/escenario.js";

describe("cuestionarios y versionado + PostgreSQL real", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL" }, () => {
  let esc, service, v1, v2;
  const crear = (extra) => service.crear({ nivel_practica_id: esc.niveles[1], ...extra }, esc.ctx);
  const abierta = (extra) => ({ tipo: "ABIERTA", enunciado: "¿Qué aprendiste esta semana?", obligatoria: true, ...extra });
  const unica = { tipo: "CERRADA_UNICA", enunciado: "¿Cómo fue el clima del aula?", obligatoria: true, opciones: [{ etiqueta: "Excelente" }, { etiqueta: "Bueno" }, { etiqueta: "Difícil" }] };
  const multiple = { tipo: "CERRADA_MULTIPLE", enunciado: "¿Qué estrategias usaste?", obligatoria: false, opciones: [{ etiqueta: "Juego" }, { etiqueta: "Arte" }] };
  const orden = (detalle) => detalle.preguntas.map((p) => p.enunciado);

  before(async () => {
    esc = await prepararEscenario();
    service = await import("../../src/services/questionnaireService.js");
  });
  after(async () => {
    if (esc?.cerrarPool) await esc.cerrarPool();
  });

  describe("borrador", () => {
    it("crea la versión 1 en blanco; solo puede haber un borrador por nivel", async () => {
      v1 = await crear({ sin_copia: true });
      assert.equal(v1.numero_version, 1);
      assert.equal(v1.estado, "BORRADOR");
      assert.equal(v1.habilitado, false);
      assert.equal(v1.editable, true);
      assert.deepEqual(v1.preguntas, []);
      await rechaza(crear({ sin_copia: true }), { estado: 409, codigo: "DRAFT_ALREADY_EXISTS" });
      await rechaza(service.crear({ nivel_practica_id: "00000000-0000-4000-8000-000000000000" }, esc.ctx), { estado: 404, codigo: "LEVEL_NOT_FOUND" });
      assert.equal(esc.auditoria("CUESTIONARIO_CREADO").length, 1);
    });

    it("valida las opciones de las preguntas", async () => {
      await rechaza(service.agregarPregunta(v1.id, { ...unica, opciones: [{ etiqueta: "Única" }] }), { estado: 422, codigo: "OPTIONS_REQUIRED" });
      await rechaza(service.agregarPregunta(v1.id, { ...unica, opciones: undefined }), { estado: 422, codigo: "OPTIONS_REQUIRED" });
      await rechaza(service.agregarPregunta(v1.id, { ...unica, opciones: [{ etiqueta: "Sí" }, { etiqueta: " sí " }] }), { estado: 422, codigo: "DUPLICATE_OPTIONS" });
      await rechaza(service.agregarPregunta(v1.id, abierta({ opciones: [{ etiqueta: "No debería" }] })), { estado: 422, codigo: "OPTIONS_NOT_ALLOWED" });
      const once = Array.from({ length: 11 }, (_, i) => ({ etiqueta: `Op ${i}` }));
      await rechaza(service.agregarPregunta(v1.id, { ...unica, opciones: once }), { estado: 422, codigo: "TOO_MANY_OPTIONS" });
      assert.deepEqual((await service.obtener(v1.id)).preguntas, [], "ningún intento fallido dejó preguntas a medias");
    });

    it("agrega, edita, reordena y elimina preguntas del borrador", async () => {
      await service.agregarPregunta(v1.id, abierta());
      await service.agregarPregunta(v1.id, unica);
      const conTres = await service.agregarPregunta(v1.id, multiple);
      assert.deepEqual(orden(conTres), ["¿Qué aprendiste esta semana?", "¿Cómo fue el clima del aula?", "¿Qué estrategias usaste?"]);
      assert.deepEqual(conTres.preguntas[1].opciones.map((o) => o.etiqueta), ["Excelente", "Bueno", "Difícil"]);
      assert.deepEqual(conTres.preguntas.map((p) => p.orden), [1, 2, 3]);

      const [p1, p2, p3] = conTres.preguntas;
      // Cambiar el enunciado conserva las opciones
      let d = await service.actualizarPregunta(p2.id, { enunciado: "¿Cómo describirías el clima del aula?" });
      assert.equal(d.preguntas[1].opciones.length, 3);
      // Cerrada → abierta: las opciones se retiran
      d = await service.actualizarPregunta(p3.id, { tipo: "ABIERTA" });
      assert.deepEqual(d.preguntas[2].opciones, []);
      // Abierta → cerrada exige opciones
      await rechaza(service.actualizarPregunta(p3.id, { tipo: "CERRADA_UNICA" }), { estado: 422, codigo: "OPTIONS_REQUIRED" });
      d = await service.actualizarPregunta(p3.id, { tipo: "CERRADA_MULTIPLE", opciones: [{ etiqueta: "Juego" }, { etiqueta: "Arte" }, { etiqueta: "Música" }] });
      assert.equal(d.preguntas[2].opciones.length, 3);

      // Reordenar: debe traer exactamente las mismas preguntas
      await rechaza(service.reordenar(v1.id, { orden: [p1.id, p2.id] }), { estado: 422, codigo: "REORDER_MISMATCH" });
      await rechaza(service.reordenar(v1.id, { orden: [p1.id, p1.id, p2.id] }), { estado: 422, codigo: "REORDER_MISMATCH" });
      d = await service.reordenar(v1.id, { orden: [p3.id, p1.id, p2.id] });
      assert.deepEqual(d.preguntas.map((p) => p.id), [p3.id, p1.id, p2.id]);
      assert.deepEqual(d.preguntas.map((p) => p.orden), [1, 2, 3]);

      // Eliminar retira la pregunta (borrado lógico) y el siguiente orden no choca
      await service.eliminarPregunta(p1.id);
      d = await service.obtener(v1.id);
      assert.deepEqual(d.preguntas.map((p) => p.id), [p3.id, p2.id]);
      assert.equal((await esc.pool.query("SELECT count(*)::int AS n FROM preguntas WHERE id = $1 AND eliminado_en IS NOT NULL", [p1.id])).rows[0].n, 1);
      await rechaza(service.eliminarPregunta(p1.id), { estado: 404, codigo: "QUESTION_NOT_FOUND" });
      d = await service.agregarPregunta(v1.id, abierta({ enunciado: "Comentario final" }));
      assert.deepEqual(d.preguntas.map((p) => p.orden), [1, 2, 3], "el orden queda contiguo tras eliminar");
    });

    it("no se puede publicar un cuestionario vacío", async () => {
      const vacio = await service.crear({ nivel_practica_id: esc.niveles[2], sin_copia: true }, esc.ctx);
      await rechaza(service.publicar(vacio.id, esc.ctx), { estado: 422, codigo: "QUESTIONNAIRE_EMPTY" });
      await rechaza(service.cambiarHabilitado(vacio.id, { habilitado: true }, esc.ctx), { estado: 422, codigo: "QUESTIONNAIRE_NOT_PUBLISHED" });
    });
  });

  describe("publicación", () => {
    it("publicar lo deja inmutable y habilitado", async () => {
      v1 = await service.publicar(v1.id, esc.ctx);
      assert.equal(v1.estado, "PUBLICADO");
      assert.equal(v1.habilitado, true);
      assert.equal(v1.editable, false);
      assert.ok(v1.publicado_en);
      assert.equal(esc.auditoria("CUESTIONARIO_PUBLICADO").length, 1);
      await rechaza(service.publicar(v1.id, esc.ctx), { estado: 409, codigo: "QUESTIONNAIRE_PUBLISHED" });
    });

    it("las preguntas de una versión publicada no se agregan, editan, eliminan ni reordenan", async () => {
      const [p] = v1.preguntas;
      await rechaza(service.agregarPregunta(v1.id, abierta()), { estado: 409, codigo: "QUESTIONNAIRE_PUBLISHED" });
      await rechaza(service.actualizarPregunta(p.id, { enunciado: "Cambio" }), { estado: 409, codigo: "QUESTIONNAIRE_PUBLISHED" });
      await rechaza(service.eliminarPregunta(p.id), { estado: 409, codigo: "QUESTIONNAIRE_PUBLISHED" });
      await rechaza(service.reordenar(v1.id, { orden: [...v1.preguntas].reverse().map((x) => x.id) }), { estado: 409, codigo: "QUESTIONNAIRE_PUBLISHED" });
      await rechaza(service.actualizar(v1.id, { titulo: "Otro título" }), { estado: 409, codigo: "QUESTIONNAIRE_PUBLISHED" });
    });

    it("la base de datos también impide modificar una versión publicada (defensa en profundidad)", async () => {
      const [p] = v1.preguntas;
      await assert.rejects(esc.pool.query("UPDATE preguntas SET enunciado = 'manipulada' WHERE id = $1", [p.id]), { code: "23514" });
      await assert.rejects(esc.pool.query("UPDATE opciones_pregunta SET etiqueta = 'x' WHERE pregunta_id = $1", [v1.preguntas[1].id]), { code: "23514" });
      await assert.rejects(esc.pool.query("DELETE FROM preguntas WHERE id = $1", [p.id]), { code: "23514" });
    });

    it("la nueva versión copia lo vigente y al publicarla reemplaza a la anterior como habilitada", async () => {
      v2 = await crear();
      assert.equal(v2.numero_version, 2);
      assert.equal(v2.estado, "BORRADOR");
      assert.deepEqual(orden(v2), orden(v1));
      assert.notDeepEqual(v2.preguntas.map((p) => p.id), v1.preguntas.map((p) => p.id), "son preguntas nuevas, no las mismas");
      assert.deepEqual(v2.preguntas.map((p) => p.opciones.map((o) => o.etiqueta)), v1.preguntas.map((p) => p.opciones.map((o) => o.etiqueta)));

      v2 = await service.agregarPregunta(v2.id, abierta({ enunciado: "Pregunta nueva de la versión 2" }));
      assert.equal((await service.obtener(v1.id)).preguntas.length, v1.preguntas.length, "v1 no cambia");

      v2 = await service.publicar(v2.id, esc.ctx);
      const lista = await service.listar({ nivel_practica_id: esc.niveles[1] });
      assert.deepEqual(lista.map((c) => [c.numero_version, c.habilitado, c.estado]), [[2, true, "PUBLICADO"], [1, false, "PUBLICADO"]]);
      assert.equal(lista[0].total_preguntas, v1.preguntas.length + 1);
      assert.equal(esc.auditoria("CUESTIONARIO_PUBLICADO").length, 2);
    });

    it("habilitar una versión deshabilita las demás; siempre hay a lo sumo una habilitada por nivel", async () => {
      await service.cambiarHabilitado(v1.id, { habilitado: true }, esc.ctx);
      let lista = await service.listar({ nivel: 1 });
      assert.deepEqual(lista.map((c) => [c.numero_version, c.habilitado]), [[2, false], [1, true]]);
      await service.cambiarHabilitado(v1.id, { habilitado: false }, esc.ctx);
      lista = await service.listar({ nivel: 1 });
      assert.ok(lista.every((c) => !c.habilitado), "se puede dejar el nivel sin cuestionario habilitado");
      await service.cambiarHabilitado(v2.id, { habilitado: true }, esc.ctx);
      assert.equal(esc.auditoria("CUESTIONARIO_HABILITADO").length, 2);
      assert.equal(esc.auditoria("CUESTIONARIO_DESHABILITADO").length, 1);
      // La base impide dos habilitados aunque se intente por SQL
      await assert.rejects(esc.pool.query("UPDATE cuestionarios SET habilitado = true WHERE id = $1", [v1.id]), { code: "23505" });
    });

    it("un cuestionario inexistente responde 404", async () => {
      await rechaza(service.obtener("00000000-0000-4000-8000-000000000000"), { estado: 404, codigo: "QUESTIONNAIRE_NOT_FOUND" });
      await rechaza(service.publicar("00000000-0000-4000-8000-000000000000", esc.ctx), { estado: 404, codigo: "QUESTIONNAIRE_NOT_FOUND" });
    });
  });
});

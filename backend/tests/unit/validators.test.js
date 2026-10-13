/**
 * Pruebas unitarias de los validadores Zod de entrada.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actualizarUsuarioBody, cambiarEstadoUsuarioBody, crearUsuarioBody, listarUsuariosQuery,
} from "../../src/validators/userSchemas.js";
import {
  actualizarInstitucionBody, crearInstitucionBody, listarInstitucionesQuery,
} from "../../src/validators/institutionSchemas.js";
import { fechaIso } from "../../src/validators/commonSchemas.js";
import {
  borradorEvaluacionBody, listarEvaluacionesQuery, publicarEvaluacionBody, reabrirEvaluacionBody,
} from "../../src/validators/evaluationSchemas.js";
import {
  actualizarAsignacionBody, cancelarAsignacionBody, crearAsignacionBody, listarAsignacionesQuery,
} from "../../src/validators/assignmentSchemas.js";
import {
  asignacionTipoParams, listarExpedientesQuery, revisarDocumentoBody,
} from "../../src/validators/documentSchemas.js";
import {
  actualizarPreguntaBody, crearCuestionarioBody, crearPreguntaBody, listarCuestionariosQuery, reordenarBody,
} from "../../src/validators/questionnaireSchemas.js";
import {
  descripcionEvidenciaBody, devolverBitacoraBody, enviarBitacoraBody, guardarBorradorBody, llaveIdempotencia,
} from "../../src/validators/logbookSchemas.js";

const baseEstudiante = {
  rol: "ESTUDIANTE", documento: "1098000001", nombres: "Luis", apellidos: "Pérez", correo: "  LUIS@UDI.EDU.CO ", semestre: "6",
};
const campos = (resultado) => resultado.error.issues.map((i) => i.path.join("."));

describe("validadores de usuarios", () => {
  it("normaliza correo y convierte semestre", () => {
    const r = crearUsuarioBody.safeParse(baseEstudiante);
    assert.equal(r.success, true);
    assert.equal(r.data.correo, "luis@udi.edu.co");
    assert.equal(r.data.semestre, 6);
  });
  it("el estudiante requiere semestre entre 1 y 8", () => {
    const sin = crearUsuarioBody.safeParse({ ...baseEstudiante, semestre: undefined });
    assert.deepEqual(campos(sin), ["semestre"]);
    assert.equal(crearUsuarioBody.safeParse({ ...baseEstudiante, semestre: 9 }).success, false);
    assert.equal(crearUsuarioBody.safeParse({ ...baseEstudiante, semestre: 0 }).success, false);
  });
  it("el asesor requiere institución", () => {
    const base = { rol: "ASESOR_SITIO", documento: "1098000003", nombres: "Ana", apellidos: "Gómez", correo: "ana@x.co" };
    assert.deepEqual(campos(crearUsuarioBody.safeParse(base)), ["institucion_id"]);
    assert.equal(crearUsuarioBody.safeParse({ ...base, institucion_id: "5f8b3c1e-8f3a-4d3a-9c0e-2b1a7c6d5e4f" }).success, true);
  });
  it("no permite crear Directores ni roles desconocidos desde la API", () => {
    assert.equal(crearUsuarioBody.safeParse({ ...baseEstudiante, rol: "DIRECTOR_PROGRAMA" }).success, false);
    assert.equal(crearUsuarioBody.safeParse({ ...baseEstudiante, rol: "ADMIN" }).success, false);
  });
  it("rechaza campos desconocidos (asignación masiva) y datos inválidos", () => {
    assert.equal(crearUsuarioBody.safeParse({ ...baseEstudiante, estado: "ACTIVO" }).success, false);
    assert.equal(crearUsuarioBody.safeParse({ ...baseEstudiante, correo: "no-es-correo" }).success, false);
    assert.equal(crearUsuarioBody.safeParse({ ...baseEstudiante, documento: "12" }).success, false);
  });
  it('convierte "" en null en campos opcionales', () => {
    const r = crearUsuarioBody.safeParse({ ...baseEstudiante, telefono: "" });
    assert.equal(r.success, true);
    assert.equal(r.data.telefono, null);
  });
  it("actualizar exige al menos un campo", () => {
    assert.equal(actualizarUsuarioBody.safeParse({}).success, false);
    assert.equal(actualizarUsuarioBody.safeParse({ nombres: "Luisa" }).success, true);
    assert.equal(actualizarUsuarioBody.safeParse({ estado: "ACTIVO" }).success, false);
  });
  it("cambio de estado acepta solo estados válidos", () => {
    assert.equal(cambiarEstadoUsuarioBody.safeParse({ estado: "INACTIVO", confirmar: true }).success, true);
    assert.equal(cambiarEstadoUsuarioBody.safeParse({ estado: "BORRADO" }).success, false);
  });
  it("la query de listado aplica paginación por defecto y límites", () => {
    const r = listarUsuariosQuery.parse({});
    assert.deepEqual([r.page, r.page_size], [1, 20]);
    assert.equal(listarUsuariosQuery.safeParse({ page_size: "500" }).success, false);
    assert.equal(listarUsuariosQuery.parse({ semestre: "3", rol: "ESTUDIANTE" }).semestre, 3);
  });
});

describe("validadores de instituciones", () => {
  const base = { nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "contacto@jardin.test" };
  it("aplica convenio EN_TRAMITE por defecto", () => {
    assert.equal(crearInstitucionBody.parse(base).estado_convenio, "EN_TRAMITE");
  });
  it("valida NIT, correo y fechas", () => {
    assert.equal(crearInstitucionBody.safeParse({ ...base, nit: "ABC" }).success, false);
    assert.equal(crearInstitucionBody.safeParse({ ...base, correo: "x" }).success, false);
    assert.equal(crearInstitucionBody.safeParse({ ...base, convenio_inicio: "2026-02-30" }).success, false);
    assert.equal(crearInstitucionBody.safeParse({ ...base, convenio_inicio: "2026-02-28" }).success, true);
    assert.equal(crearInstitucionBody.safeParse({ ...base, correo: undefined }).success, false, "el correo es obligatorio");
  });
  it("actualizar es parcial y rechaza vacío", () => {
    assert.equal(actualizarInstitucionBody.safeParse({}).success, false);
    assert.equal(actualizarInstitucionBody.safeParse({ ciudad: "Girón" }).success, true);
    assert.equal(actualizarInstitucionBody.safeParse({ activa: false }).success, false);
  });
  it('el filtro activa llega como texto "true"/"false"', () => {
    assert.equal(listarInstitucionesQuery.parse({ activa: "false" }).activa, false);
    assert.equal(listarInstitucionesQuery.parse({}).activa, undefined);
    assert.equal(listarInstitucionesQuery.safeParse({ activa: "si" }).success, false);
  });
});

describe("fechaIso", () => {
  it("acepta solo fechas calendario reales", () => {
    assert.equal(fechaIso.safeParse("2026-12-05").success, true);
    assert.equal(fechaIso.safeParse("2026-13-01").success, false);
    assert.equal(fechaIso.safeParse("05/12/2026").success, false);
  });
});

describe("esquemas de asignaciones", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const base = { estudiante_id: id, nivel_practica_id: id, institucion_id: id };

  it("crear: docente y asesor son opcionales y '' se convierte en null", () => {
    assert.equal(crearAsignacionBody.safeParse(base).success, true);
    const r = crearAsignacionBody.parse({ ...base, docente_supervisor_id: "", asesor_sitio_id: "" });
    assert.equal(r.docente_supervisor_id, null);
    assert.equal(r.asesor_sitio_id, null);
  });

  it("crear: rechaza ids inválidos, campos desconocidos y fechas invertidas", () => {
    assert.equal(crearAsignacionBody.safeParse({ ...base, estudiante_id: "x" }).success, false);
    assert.equal(crearAsignacionBody.safeParse({ ...base, estado: "ACTIVA" }).success, false);
    assert.equal(crearAsignacionBody.safeParse({ ...base, fecha_inicio: "2026-08-01", fecha_fin: "2026-07-01" }).success, false);
  });

  it("actualizar: exige al menos un campo y distingue 'no enviado' de 'quitar' (null)", () => {
    assert.equal(actualizarAsignacionBody.safeParse({}).success, false);
    const r = actualizarAsignacionBody.parse({ docente_supervisor_id: null });
    assert.equal(r.docente_supervisor_id, null);
    assert.equal("asesor_sitio_id" in r, false);
  });

  it("cancelar: el motivo es obligatorio y solo se acepta CANCELADA", () => {
    assert.equal(cancelarAsignacionBody.safeParse({ estado: "CANCELADA" }).success, false);
    assert.equal(cancelarAsignacionBody.safeParse({ estado: "CANCELADA", motivo: "ab" }).success, false);
    assert.equal(cancelarAsignacionBody.safeParse({ estado: "ACTIVA", motivo: "motivo válido" }).success, false);
    assert.equal(cancelarAsignacionBody.safeParse({ estado: "CANCELADA", motivo: "motivo válido" }).success, true);
  });

  it("listar: convierte la paginación y valida filtros", () => {
    const r = listarAsignacionesQuery.parse({ page: "2", nivel: "3", completitud: "SIN_ASESOR", todos_los_periodos: "true" });
    assert.equal(r.page, 2);
    assert.equal(r.nivel, 3);
    assert.equal(r.todos_los_periodos, true);
    assert.equal(listarAsignacionesQuery.safeParse({ nivel: "9" }).success, false);
  });
});

describe("esquemas de documentos legales", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("revisión: rechazar exige observación; aprobar y devolver a revisión no", () => {
    assert.equal(revisarDocumentoBody.safeParse({ decision: "APROBAR" }).success, true);
    assert.equal(revisarDocumentoBody.safeParse({ decision: "PENDIENTE" }).success, true);
    assert.equal(revisarDocumentoBody.safeParse({ decision: "RECHAZAR" }).success, false);
    assert.equal(revisarDocumentoBody.safeParse({ decision: "RECHAZAR", observacion: "no" }).success, false);
    assert.equal(revisarDocumentoBody.safeParse({ decision: "RECHAZAR", motivo: "Documento vencido", observacion: "Venció en mayo" }).success, true);
  });

  it("revisión: rechaza decisiones desconocidas y campos extra", () => {
    assert.equal(revisarDocumentoBody.safeParse({ decision: "BORRAR" }).success, false);
    assert.equal(revisarDocumentoBody.safeParse({ decision: "APROBAR", estado: "APROBADO" }).success, false);
  });

  it("expedientes: convierte la paginación y valida los filtros", () => {
    const r = listarExpedientesQuery.parse({ page: "2", nivel: "3", estado: "POR_CORREGIR" });
    assert.equal(r.page, 2);
    assert.equal(r.nivel, 3);
    assert.equal(listarExpedientesQuery.safeParse({ estado: "OTRO" }).success, false);
  });

  it("parámetros: exigen identificadores válidos", () => {
    assert.equal(asignacionTipoParams.safeParse({ id, tipoId: id }).success, true);
    assert.equal(asignacionTipoParams.safeParse({ id, tipoId: "x" }).success, false);
  });
});

describe("esquemas de cuestionarios", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("pregunta: valida tipo, enunciado y opciones; obligatoria es true por defecto", () => {
    const r = crearPreguntaBody.parse({ tipo: "ABIERTA", enunciado: "  ¿Qué aprendiste?  " });
    assert.equal(r.enunciado, "¿Qué aprendiste?");
    assert.equal(r.obligatoria, true);
    assert.equal(crearPreguntaBody.safeParse({ tipo: "OTRO", enunciado: "¿Qué?" }).success, false);
    assert.equal(crearPreguntaBody.safeParse({ tipo: "ABIERTA", enunciado: "ab" }).success, false);
    assert.equal(crearPreguntaBody.safeParse({ tipo: "ABIERTA", enunciado: "¿Qué?", extra: 1 }).success, false);
    assert.equal(crearPreguntaBody.safeParse({ tipo: "CERRADA_UNICA", enunciado: "¿Cómo?", opciones: [{ etiqueta: "" }] }).success, false);
  });

  it("actualizar pregunta exige al menos un campo", () => {
    assert.equal(actualizarPreguntaBody.safeParse({}).success, false);
    assert.equal(actualizarPreguntaBody.safeParse({ obligatoria: false }).success, true);
  });

  it("crear cuestionario, listar y reordenar", () => {
    assert.equal(crearCuestionarioBody.safeParse({}).success, false);
    assert.equal(crearCuestionarioBody.safeParse({ nivel_practica_id: id, sin_copia: true }).success, true);
    assert.equal(listarCuestionariosQuery.parse({ nivel: "2" }).nivel, 2);
    assert.equal(listarCuestionariosQuery.safeParse({ nivel: "9" }).success, false);
    assert.equal(reordenarBody.safeParse({ orden: [] }).success, false);
    assert.equal(reordenarBody.safeParse({ orden: [id] }).success, true);
  });
});

describe("esquemas de bitácoras", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("borrador: exige revision_base y limita los textos; respuestas y reflexión tienen valores por defecto", () => {
    const r = guardarBorradorBody.parse({ revision_base: 0 });
    assert.equal(r.reflexion, "");
    assert.deepEqual(r.respuestas, []);
    assert.equal(guardarBorradorBody.safeParse({ reflexion: "hola" }).success, false);
    assert.equal(guardarBorradorBody.safeParse({ revision_base: -1 }).success, false);
    assert.equal(guardarBorradorBody.safeParse({ revision_base: 1.5 }).success, false);
    assert.equal(guardarBorradorBody.safeParse({ revision_base: 0, reflexion: "x".repeat(20001) }).success, false);
    assert.equal(guardarBorradorBody.safeParse({ revision_base: 0, estado: "ENVIADA" }).success, false);
    assert.equal(guardarBorradorBody.safeParse({ revision_base: 0, respuestas: [{ pregunta_id: "x" }] }).success, false);
    assert.equal(guardarBorradorBody.safeParse({ revision_base: 0, respuestas: [{ pregunta_id: id, texto: null, opciones_ids: [id] }] }).success, true);
  });

  it("envío y devolución", () => {
    assert.equal(enviarBitacoraBody.safeParse({ revision_base: 3 }).success, true);
    assert.equal(enviarBitacoraBody.safeParse({}).success, false);
    assert.equal(devolverBitacoraBody.safeParse({ motivo: "no" }).success, false);
    assert.equal(devolverBitacoraBody.parse({ motivo: "  Amplía la reflexión  " }).motivo, "Amplía la reflexión");
    assert.equal(descripcionEvidenciaBody.safeParse({ descripcion: "" }).success, true);
    assert.equal(descripcionEvidenciaBody.safeParse({ descripcion: "x".repeat(501) }).success, false);
  });

  it("la llave de idempotencia solo admite 8 a 63 caracteres seguros", () => {
    assert.equal(llaveIdempotencia.safeParse("3f2c9a10-7d54-4a0e-9a53-0c8d7f1b2e44").success, true);
    assert.equal(llaveIdempotencia.safeParse("corta").success, false);
    assert.equal(llaveIdempotencia.safeParse("x".repeat(64)).success, false);
    assert.equal(llaveIdempotencia.safeParse("con espacios en medio").success, false);
    assert.equal(llaveIdempotencia.safeParse("<script>alert(1)</script>").success, false);
  });
});

describe("esquemas de evaluaciones", () => {
  it("borrador: nota opcional entre 0 y 5 con máximo dos decimales; lo que no se envía queda vacío", () => {
    assert.deepEqual(borradorEvaluacionBody.parse({}), { nota: null, retroalimentacion: null });
    assert.equal(borradorEvaluacionBody.parse({ nota: 0 }).nota, 0);
    assert.equal(borradorEvaluacionBody.parse({ nota: 5 }).nota, 5);
    assert.equal(borradorEvaluacionBody.parse({ nota: 4.25 }).nota, 4.25);
    assert.equal(borradorEvaluacionBody.parse({ nota: 3.1 }).nota, 3.1);
    for (const nota of [-0.01, 5.01, 6, 4.123, "4", NaN]) {
      assert.equal(borradorEvaluacionBody.safeParse({ nota }).success, false, `nota ${nota}`);
    }
    assert.equal(borradorEvaluacionBody.safeParse({ nota: 4, estado: "PUBLICADA" }).success, false, "no acepta campos desconocidos");
  });

  it("la retroalimentación se recorta, '' equivale a vacío y tiene un máximo", () => {
    assert.equal(borradorEvaluacionBody.parse({ retroalimentacion: "  Buen trabajo  " }).retroalimentacion, "Buen trabajo");
    assert.equal(borradorEvaluacionBody.parse({ retroalimentacion: "   " }).retroalimentacion, null);
    assert.equal(borradorEvaluacionBody.safeParse({ retroalimentacion: "x".repeat(3000) }).success, true);
    assert.equal(borradorEvaluacionBody.safeParse({ retroalimentacion: "x".repeat(3001) }).success, false);
  });

  it("publicar: todo es opcional (usa el borrador), pero lo que se envíe debe ser válido", () => {
    assert.deepEqual(publicarEvaluacionBody.parse({}), {});
    assert.equal(publicarEvaluacionBody.parse({ nota: 4.5 }).nota, 4.5);
    assert.equal(publicarEvaluacionBody.parse({ retroalimentacion: null }).retroalimentacion, null);
    assert.equal(publicarEvaluacionBody.safeParse({ nota: null }).success, false);
    assert.equal(publicarEvaluacionBody.safeParse({ nota: 5.5 }).success, false);
    assert.equal(publicarEvaluacionBody.safeParse({ promedio: 4 }).success, false);
  });

  it("reapertura: el motivo es obligatorio", () => {
    assert.equal(reabrirEvaluacionBody.safeParse({}).success, false);
    assert.equal(reabrirEvaluacionBody.safeParse({ motivo: "ab" }).success, false);
    assert.equal(reabrirEvaluacionBody.parse({ motivo: "  Error de digitación  " }).motivo, "Error de digitación");
    assert.equal(reabrirEvaluacionBody.safeParse({ motivo: "x".repeat(501) }).success, false);
  });

  it("listado: convierte la paginación y valida estado y tipo", () => {
    const q = listarEvaluacionesQuery.parse({});
    assert.equal(q.page, 1);
    assert.equal(q.page_size, 20);
    assert.equal(listarEvaluacionesQuery.parse({ page: "3", page_size: "50", estado: "BORRADOR", tipo: "ASESOR_SITIO" }).page, 3);
    assert.equal(listarEvaluacionesQuery.safeParse({ estado: "OTRO" }).success, false);
    assert.equal(listarEvaluacionesQuery.safeParse({ tipo: "DIRECTOR" }).success, false);
    assert.equal(listarEvaluacionesQuery.safeParse({ page: "0" }).success, false);
    assert.equal(listarEvaluacionesQuery.safeParse({ periodo_id: "x" }).success, false);
  });
});

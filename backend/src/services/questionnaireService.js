/**
 * Servicio de cuestionarios versionados.
 * Cada nivel de práctica tiene versiones del cuestionario: BORRADOR (editable) → PUBLICADO (inmutable) y solo una versión HABILITADA.
 * Las bitácoras conservan la versión con la que se crearon. Todas las modificaciones usan transacciones con bloqueo del nivel.
 */
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { withTransaction } from "../database/transaction.js";
import * as questionnaireRepository from "../repositories/questionnaireRepository.js";
import { ApiError } from "../utils/apiError.js";

// Tipos de pregunta que llevan opciones de respuesta.
const CERRADAS = ["CERRADA_UNICA", "CERRADA_MULTIPLE"];
// Error estándar al intentar modificar un cuestionario ya publicado.
const ERROR_PUBLICADO = () =>
  ApiError.conflicto(
    "Este cuestionario ya fue publicado y no se modifica. Crea una nueva versión para cambiarlo.",
    "QUESTIONNAIRE_PUBLISHED"
  );

// ───────────────────────── Presentación ─────────────────────────

// Estado visible: PUBLICADO o BORRADOR.
const estadoDe = (c) => (c.publicado ? "PUBLICADO" : "BORRADOR");

// Resumen del cuestionario para listados.
function armarResumen(c) {
  return {
    id: c.id,
    nivel: { id: c.nivel_practica_id, codigo: c.nivel_codigo, nombre: c.nivel_nombre, semestre: c.nivel_semestre },
    numero_version: c.numero_version,
    titulo: c.titulo,
    estado: estadoDe(c),
    habilitado: c.habilitado,
    publicado_en: c.publicado_en,
    total_preguntas: c.total_preguntas,
    total_bitacoras: c.total_bitacoras,
  };
}

// Da forma a una pregunta con sus opciones.
const armarPregunta = (p) => ({
  id: p.id,
  tipo: p.tipo,
  enunciado: p.enunciado,
  obligatoria: p.obligatoria,
  orden: p.orden,
  opciones: p.opciones.map((o) => ({ id: o.id, etiqueta: o.etiqueta, valor: o.valor, orden: o.orden })),
});

// Detalle completo: resumen, si es editable y sus preguntas.
async function armarDetalle(id, db) {
  const c = await questionnaireRepository.buscarPorId(id, db);
  const preguntas = await questionnaireRepository.cargarPreguntas(id, db);
  return {
    ...armarResumen({ ...c, total_preguntas: preguntas.length }),
    // Un cuestionario publicado es inmutable: solo el borrador admite cambios.
    editable: !c.publicado,
    preguntas: preguntas.map(armarPregunta),
  };
}

// ───────────────────────── Validaciones ─────────────────────────

/** Normaliza y valida opciones: obligatorias (2 a 10, sin repetir) en preguntas cerradas y ausentes en abiertas. */
function validarOpciones(tipo, etiquetas) {
  if (!CERRADAS.includes(tipo)) {
    if (etiquetas?.length) {
      throw ApiError.reglaDeNegocio("Una pregunta abierta no lleva opciones de respuesta.", "OPTIONS_NOT_ALLOWED");
    }
    return [];
  }
  const limpias = (etiquetas ?? []).map((e) => String(e).trim()).filter(Boolean);
  if (limpias.length < 2) {
    throw ApiError.reglaDeNegocio("Una pregunta cerrada necesita al menos dos opciones.", "OPTIONS_REQUIRED");
  }
  if (limpias.length > 10) {
    throw ApiError.reglaDeNegocio("Una pregunta cerrada admite máximo diez opciones.", "TOO_MANY_OPTIONS");
  }
  const vistas = new Set(limpias.map((e) => e.toLocaleLowerCase("es")));
  if (vistas.size !== limpias.length) {
    throw ApiError.reglaDeNegocio("Las opciones no pueden repetirse.", "DUPLICATE_OPTIONS");
  }
  return limpias;
}

// Carga y bloquea un cuestionario que debe seguir en borrador (404 si no existe, 409 si ya fue publicado).
async function cargarBorradorODetener(id, db) {
  const c = await questionnaireRepository.buscarPorId(id, db, { bloquear: true });
  if (!c) throw ApiError.noEncontrado("El cuestionario no existe.", "QUESTIONNAIRE_NOT_FOUND");
  if (c.publicado) throw ERROR_PUBLICADO();
  return c;
}

// ───────────────────────── Casos de uso ─────────────────────────

/** Lista cuestionarios filtrando por nivel o semestre. */
export async function listar({ nivel_practica_id, nivel }) {
  const filas = await questionnaireRepository.listar({ nivelId: nivel_practica_id, semestre: nivel });
  return filas.map(armarResumen);
}

/** Detalle de un cuestionario con sus preguntas. */
export async function obtener(id) {
  if (!(await questionnaireRepository.buscarPorId(id))) {
    throw ApiError.noEncontrado("El cuestionario no existe.", "QUESTIONNAIRE_NOT_FOUND");
  }
  return armarDetalle(id);
}

/**
 * Crea la siguiente versión (borrador) de un nivel. Por defecto copia las preguntas de la versión habilitada
 * (o, si no hay, de la última publicada) para que Dirección edite a partir de lo vigente.
 */
export async function crear({ nivel_practica_id, titulo, copiar_de, sin_copia }, contexto) {
  const nivel = await questionnaireRepository.buscarNivel(nivel_practica_id);
  if (!nivel) throw ApiError.noEncontrado("El nivel de práctica no existe.", "LEVEL_NOT_FOUND");

      // Solo puede existir un borrador por nivel: se bloquea el nivel para evitar crear dos a la vez.
  const id = await withTransaction(async (client) => {
    await questionnaireRepository.bloquearNivel(nivel.id, client);
    const borrador = await questionnaireRepository.buscarBorradorDeNivel(nivel.id, client);
    if (borrador) {
      throw ApiError.conflicto(
        "Este nivel ya tiene un borrador en edición. Publícalo o continúa editándolo antes de crear otra versión.",
        "DRAFT_ALREADY_EXISTS",
        [{ cuestionario_id: borrador.id, numero_version: borrador.numero_version }]
      );
    }
        // Base de copia: la versión indicada, o la habilitada, o la última publicada (salvo `sin_copia`).
    let base = null;
    if (!sin_copia) {
      if (copiar_de) {
        base = await questionnaireRepository.buscarPorId(copiar_de, client);
        if (!base || base.nivel_practica_id !== nivel.id) {
          throw ApiError.reglaDeNegocio("La versión a copiar no pertenece a este nivel.", "INVALID_SOURCE_QUESTIONNAIRE");
        }
      } else {
        base =
          (await questionnaireRepository.buscarHabilitadoDeNivel(nivel.id, client)) ??
          (await questionnaireRepository.buscarUltimaPublicada(nivel.id, client));
      }
    }
    const numeroVersion = (await questionnaireRepository.ultimaVersion(nivel.id, client)) + 1;
    const creado = await questionnaireRepository.crear(
      {
        nivelId: nivel.id,
        titulo: titulo ?? `Cuestionario ${nivel.nombre} · versión ${numeroVersion}`,
        creadoPorId: contexto.actor.usuario_id,
        numeroVersion,
      },
      client
    );
        // Se copian las preguntas y opciones de la base al nuevo borrador.
    if (base) {
      for (const pregunta of await questionnaireRepository.cargarPreguntas(base.id, client)) {
        const copia = await questionnaireRepository.insertarPregunta(
          { cuestionarioId: creado.id, tipo: pregunta.tipo, enunciado: pregunta.enunciado, obligatoria: pregunta.obligatoria, orden: pregunta.orden },
          client
        );
        await questionnaireRepository.insertarOpciones(copia.id, pregunta.opciones.map((o) => o.etiqueta), client);
      }
    }
    return creado.id;
  });

  const detalle = await armarDetalle(id);
  await registrarAuditoria({
    contexto,
    accion: "CUESTIONARIO_CREADO",
    entidad: "cuestionarios",
    entidad_id: id,
    valor_nuevo: { nivel: nivel.codigo, numero_version: detalle.numero_version, preguntas_copiadas: detalle.preguntas.length },
  });
  return detalle;
}

/** Cambia el título del borrador. */
export async function actualizar(id, { titulo }) {
  await withTransaction(async (client) => {
    await cargarBorradorODetener(id, client);
    await questionnaireRepository.actualizarTitulo(id, titulo, client);
  });
  return armarDetalle(id);
}

/** Agrega una pregunta al final del borrador (valida las opciones según el tipo). */
export async function agregarPregunta(cuestionarioId, { tipo, enunciado, obligatoria, opciones }) {
  const etiquetas = validarOpciones(tipo, opciones?.map((o) => o.etiqueta));
  await withTransaction(async (client) => {
    await cargarBorradorODetener(cuestionarioId, client);
    const orden = await questionnaireRepository.siguienteOrden(cuestionarioId, client);
    const pregunta = await questionnaireRepository.insertarPregunta({ cuestionarioId, tipo, enunciado, obligatoria, orden }, client);
    await questionnaireRepository.insertarOpciones(pregunta.id, etiquetas, client);
  });
  return armarDetalle(cuestionarioId);
}

/** Edita una pregunta del borrador; si cambian las opciones o el tipo, las reemplaza. */
export async function actualizarPregunta(id, cambios) {
  const previa = await questionnaireRepository.buscarPregunta(id);
  if (!previa) throw ApiError.noEncontrado("La pregunta no existe.", "QUESTION_NOT_FOUND");

  await withTransaction(async (client) => {
    await cargarBorradorODetener(previa.cuestionario_id, client);
    const pregunta = await questionnaireRepository.buscarPregunta(id, client, { bloquear: true });
    if (!pregunta) throw ApiError.noEncontrado("La pregunta no existe.", "QUESTION_NOT_FOUND");
    const tipo = cambios.tipo ?? pregunta.tipo;
    const reemplazaOpciones = cambios.opciones !== undefined || CERRADAS.includes(tipo) !== CERRADAS.includes(pregunta.tipo);
    let etiquetas;
    if (reemplazaOpciones) {
      etiquetas = validarOpciones(tipo, cambios.opciones?.map((o) => o.etiqueta));
    }
    await questionnaireRepository.actualizarPregunta(
      id,
      { tipo, enunciado: cambios.enunciado ?? pregunta.enunciado, obligatoria: cambios.obligatoria ?? pregunta.obligatoria },
      client
    );
    if (reemplazaOpciones) {
      await questionnaireRepository.retirarOpciones(id, client);
      await questionnaireRepository.insertarOpciones(id, etiquetas, client);
    }
  });
  return armarDetalle(previa.cuestionario_id);
}

/** Retira la pregunta del borrador. Las preguntas de una versión publicada no se eliminan. */
export async function eliminarPregunta(id) {
  const previa = await questionnaireRepository.buscarPregunta(id);
  if (!previa) throw ApiError.noEncontrado("La pregunta no existe.", "QUESTION_NOT_FOUND");
  await withTransaction(async (client) => {
    await cargarBorradorODetener(previa.cuestionario_id, client);
    await questionnaireRepository.retirarPregunta(id, client);
    // El orden visual queda contiguo (1, 2, 3...) tras retirar una pregunta.
    const restantes = await questionnaireRepository.cargarPreguntas(previa.cuestionario_id, client);
    for (const [indice, pregunta] of restantes.entries()) {
      await questionnaireRepository.fijarOrden(pregunta.id, indice + 1, client);
    }
  });
}

/** Define un nuevo orden: la lista debe contener exactamente las preguntas actuales, sin repetir. */
export async function reordenar(cuestionarioId, { orden }) {
  await withTransaction(async (client) => {
    await cargarBorradorODetener(cuestionarioId, client);
    const actuales = (await questionnaireRepository.cargarPreguntas(cuestionarioId, client)).map((p) => p.id);
    const mismas =
      orden.length === actuales.length && new Set(orden).size === orden.length && orden.every((id) => actuales.includes(id));
    if (!mismas) {
      throw ApiError.reglaDeNegocio(
        "La lista debe contener exactamente las preguntas del cuestionario, sin repetir.",
        "REORDER_MISMATCH"
      );
    }
    for (const [indice, preguntaId] of orden.entries()) {
      await questionnaireRepository.fijarOrden(preguntaId, indice + 1, client);
    }
  });
  return armarDetalle(cuestionarioId);
}

/**
 * Publica el borrador: queda inmutable y pasa a ser el cuestionario habilitado del nivel
 * (la versión habilitada anterior se deshabilita pero se conserva para las bitácoras que ya la usan).
 */
export async function publicar(id, contexto) {
  const previo = await questionnaireRepository.buscarPorId(id);
  if (!previo) throw ApiError.noEncontrado("El cuestionario no existe.", "QUESTIONNAIRE_NOT_FOUND");

  const reemplazada = await withTransaction(async (client) => {
    await questionnaireRepository.bloquearNivel(previo.nivel_practica_id, client);
    const c = await cargarBorradorODetener(id, client);
    const preguntas = await questionnaireRepository.cargarPreguntas(id, client);
    if (!preguntas.length) {
      throw ApiError.reglaDeNegocio("Agrega al menos una pregunta antes de publicar.", "QUESTIONNAIRE_EMPTY");
    }
        // Toda pregunta cerrada necesita al menos dos opciones.
    const cerradasInvalidas = preguntas.filter((p) => CERRADAS.includes(p.tipo) && p.opciones.length < 2);
    if (cerradasInvalidas.length) {
      throw ApiError.reglaDeNegocio("Hay preguntas cerradas con menos de dos opciones.", "OPTIONS_REQUIRED",
        cerradasInvalidas.map((p) => ({ pregunta_id: p.id })));
    }
        // Se deshabilita la versión anterior y se publica y habilita la nueva.
    const anterior = await questionnaireRepository.buscarHabilitadoDeNivel(c.nivel_practica_id, client);
    await questionnaireRepository.deshabilitarOtrosDelNivel(c.nivel_practica_id, id, client);
    await questionnaireRepository.publicarYHabilitar(id, contexto.actor.usuario_id, client);
    return anterior;
  });

  const detalle = await armarDetalle(id);
  await registrarAuditoria({
    contexto,
    accion: "CUESTIONARIO_PUBLICADO",
    entidad: "cuestionarios",
    entidad_id: id,
    valor_anterior: reemplazada ? { cuestionario_habilitado_id: reemplazada.id, numero_version: reemplazada.numero_version } : null,
    valor_nuevo: { nivel: previo.nivel_codigo, numero_version: detalle.numero_version, preguntas: detalle.preguntas.length },
  });
  return detalle;
}

/** Habilita o deshabilita una versión publicada. Solo una versión por nivel puede estar habilitada. */
export async function cambiarHabilitado(id, { habilitado }, contexto) {
  const previo = await questionnaireRepository.buscarPorId(id);
  if (!previo) throw ApiError.noEncontrado("El cuestionario no existe.", "QUESTIONNAIRE_NOT_FOUND");

  await withTransaction(async (client) => {
    await questionnaireRepository.bloquearNivel(previo.nivel_practica_id, client);
    const c = await questionnaireRepository.buscarPorId(id, client, { bloquear: true });
    if (!c.publicado) {
      throw ApiError.reglaDeNegocio("Publica el cuestionario antes de habilitarlo.", "QUESTIONNAIRE_NOT_PUBLISHED");
    }
    if (habilitado) await questionnaireRepository.deshabilitarOtrosDelNivel(c.nivel_practica_id, id, client);
    await questionnaireRepository.cambiarHabilitado(id, habilitado, client);
  });

  await registrarAuditoria({
    contexto,
    accion: habilitado ? "CUESTIONARIO_HABILITADO" : "CUESTIONARIO_DESHABILITADO",
    entidad: "cuestionarios",
    entidad_id: id,
    valor_anterior: { habilitado: previo.habilitado },
    valor_nuevo: { habilitado, nivel: previo.nivel_codigo, numero_version: previo.numero_version },
  });
  return armarDetalle(id);
}

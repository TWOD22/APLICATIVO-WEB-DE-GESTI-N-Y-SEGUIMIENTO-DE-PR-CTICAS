/**
 * Servicio de cuestionarios versionados.
 * Cada nivel de práctica tiene versiones del cuestionario: BORRADOR (editable) → PUBLICADO (inmutable) y solo una versión HABILITADA.
 * Las bitácoras conservan la versión con la que se crearon. Todas las modificaciones usan transacciones con bloqueo del nivel.
 * Flujo v2: el cuestionario lo configura el docente del nivel en el periodo activo; Dirección y los demás docentes
 * solo lo consultan (un docente puede copiar preguntas de cualquier versión publicada, también de otro nivel).
 * `auth` es siempre el último parámetro de cada caso de uso.
 */
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { withTransaction } from "../database/transaction.js";
import * as documentRepository from "../repositories/documentRepository.js";
import * as levelTeacherRepository from "../repositories/levelTeacherRepository.js";
import * as questionnaireRepository from "../repositories/questionnaireRepository.js";
import { crearNotificacion } from "../adapters/firestoreAdapter.js";
import { ApiError } from "../utils/apiError.js";
import { ROLES } from "../utils/constants.js";

// Tipos de pregunta que llevan opciones de respuesta.
const CERRADAS = ["CERRADA_UNICA", "CERRADA_MULTIPLE"];
// Error estándar al intentar modificar un cuestionario ya publicado.
const ERROR_PUBLICADO = () =>
  ApiError.conflicto(
    "Este cuestionario ya fue publicado y no se modifica. Crea una nueva versión para cambiarlo.",
    "QUESTIONNAIRE_PUBLISHED"
  );

// ───────────────────────── Permisos ─────────────────────────

const esDocente = (auth) => auth.rolActivo === ROLES.DOCENTE_SUPERVISOR;

/** Ids de los niveles que el usuario puede configurar (solo un docente, en el periodo activo). */
const nivelesGestionables = async (auth) =>
  esDocente(auth) ? new Set(await levelTeacherRepository.nivelesDelDocenteActivo(auth.usuario.id)) : new Set();

/** Solo el docente asignado al nivel en el periodo activo modifica su cuestionario. */
async function exigirGestionDelNivel(auth, nivelId) {
  if (!(await nivelesGestionables(auth)).has(nivelId)) {
    throw ApiError.prohibido(
      "Solo el docente asignado a este nivel en el periodo activo configura su cuestionario.",
      "NOT_LEVEL_TEACHER"
    );
  }
}

/** Carga el cuestionario (404 si no existe) y exige que el usuario gestione su nivel (403 si no). */
async function cargarGestionable(id, auth) {
  const c = await questionnaireRepository.buscarPorId(id);
  if (!c) throw ApiError.noEncontrado("El cuestionario no existe.", "QUESTIONNAIRE_NOT_FOUND");
  await exigirGestionDelNivel(auth, c.nivel_practica_id);
  return c;
}

// ───────────────────────── Presentación ─────────────────────────

// Estado visible: PUBLICADO o BORRADOR.
const estadoDe = (c) => (c.publicado ? "PUBLICADO" : "BORRADOR");

// Resumen del cuestionario para listados.
function armarResumen(c, gestionables = new Set()) {
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
    gestionable: gestionables.has(c.nivel_practica_id),
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
async function armarDetalle(id, auth, db) {
  const c = await questionnaireRepository.buscarPorId(id, db);
  const preguntas = await questionnaireRepository.cargarPreguntas(id, db);
  const resumen = armarResumen({ ...c, total_preguntas: preguntas.length }, await nivelesGestionables(auth));
  return {
    ...resumen,
    // Un cuestionario publicado es inmutable; además solo el docente del nivel edita (Dirección consulta).
    editable: !c.publicado && resumen.gestionable,
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
export async function listar({ nivel_practica_id, nivel }, auth) {
  const filas = await questionnaireRepository.listar({ nivelId: nivel_practica_id, semestre: nivel });
  const gestionables = await nivelesGestionables(auth);
  return filas.map((f) => armarResumen(f, gestionables));
}

/** Detalle de un cuestionario con sus preguntas. */
export async function obtener(id, auth) {
  if (!(await questionnaireRepository.buscarPorId(id))) {
    throw ApiError.noEncontrado("El cuestionario no existe.", "QUESTIONNAIRE_NOT_FOUND");
  }
  return armarDetalle(id, auth);
}

/**
 * Crea la siguiente versión (borrador) de un nivel. Por defecto copia las preguntas de la versión habilitada
 * (o, si no hay, de la última publicada) para que Dirección edite a partir de lo vigente.
 */
export async function crear({ nivel_practica_id, titulo, copiar_de, sin_copia }, contexto, auth) {
  const nivel = await questionnaireRepository.buscarNivel(nivel_practica_id);
  if (!nivel) throw ApiError.noEncontrado("El nivel de práctica no existe.", "LEVEL_NOT_FOUND");
  await exigirGestionDelNivel(auth, nivel.id);

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
        // Se puede copiar de una versión de este nivel (también un borrador) o de cualquier versión PUBLICADA de otro nivel.
        if (!base || (base.nivel_practica_id !== nivel.id && !base.publicado)) {
          throw ApiError.reglaDeNegocio("La versión a copiar no existe o aún no está publicada.", "INVALID_SOURCE_QUESTIONNAIRE");
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

  const detalle = await armarDetalle(id, auth);
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
export async function actualizar(id, { titulo }, auth) {
  await cargarGestionable(id, auth);
  await withTransaction(async (client) => {
    await cargarBorradorODetener(id, client);
    await questionnaireRepository.actualizarTitulo(id, titulo, client);
  });
  return armarDetalle(id, auth);
}

/** Agrega una pregunta al final del borrador (valida las opciones según el tipo). */
export async function agregarPregunta(cuestionarioId, { tipo, enunciado, obligatoria, opciones }, auth) {
  await cargarGestionable(cuestionarioId, auth);
  const etiquetas = validarOpciones(tipo, opciones?.map((o) => o.etiqueta));
  await withTransaction(async (client) => {
    await cargarBorradorODetener(cuestionarioId, client);
    const orden = await questionnaireRepository.siguienteOrden(cuestionarioId, client);
    const pregunta = await questionnaireRepository.insertarPregunta({ cuestionarioId, tipo, enunciado, obligatoria, orden }, client);
    await questionnaireRepository.insertarOpciones(pregunta.id, etiquetas, client);
  });
  return armarDetalle(cuestionarioId, auth);
}

/** Edita una pregunta del borrador; si cambian las opciones o el tipo, las reemplaza. */
export async function actualizarPregunta(id, cambios, auth) {
  const previa = await questionnaireRepository.buscarPregunta(id);
  if (!previa) throw ApiError.noEncontrado("La pregunta no existe.", "QUESTION_NOT_FOUND");
  await cargarGestionable(previa.cuestionario_id, auth);

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
  return armarDetalle(previa.cuestionario_id, auth);
}

/** Retira la pregunta del borrador. Las preguntas de una versión publicada no se eliminan. */
export async function eliminarPregunta(id, auth) {
  const previa = await questionnaireRepository.buscarPregunta(id);
  if (!previa) throw ApiError.noEncontrado("La pregunta no existe.", "QUESTION_NOT_FOUND");
  await cargarGestionable(previa.cuestionario_id, auth);
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
export async function reordenar(cuestionarioId, { orden }, auth) {
  await cargarGestionable(cuestionarioId, auth);
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
  return armarDetalle(cuestionarioId, auth);
}

/**
 * Publica el borrador: queda inmutable y pasa a ser el cuestionario habilitado del nivel
 * (la versión habilitada anterior se deshabilita pero se conserva para las bitácoras que ya la usan).
 */
export async function publicar(id, contexto, auth) {
  const previo = await cargarGestionable(id, auth);

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

  const detalle = await armarDetalle(id, auth);
  const impacto = await questionnaireRepository.contarImpactoDePublicar(previo.nivel_practica_id);
  await registrarAuditoria({
    contexto,
    accion: "CUESTIONARIO_PUBLICADO",
    entidad: "cuestionarios",
    entidad_id: id,
    valor_anterior: reemplazada ? { cuestionario_habilitado_id: reemplazada.id, numero_version: reemplazada.numero_version } : null,
    valor_nuevo: { nivel: previo.nivel_codigo, numero_version: detalle.numero_version, preguntas: detalle.preguntas.length },
  });
  await avisarADireccion({
    tipo: "CUESTIONARIO_PUBLICADO",
    titulo: "El docente publicó un cuestionario",
    mensaje: `${previo.nivel_nombre}: versión ${detalle.numero_version} publicada y habilitada.`,
    entidad: { tipo: "cuestionario", id },
  });
  return { ...detalle, impacto };
}

/**
 * Qué pasará al publicar este borrador: cuántas bitácoras sin cuestionario lo recibirán y cuántas conservan su versión.
 * Sirve para el aviso de confirmación antes de publicar.
 */
export async function impactoDePublicar(id, auth) {
  const c = await cargarGestionable(id, auth);
  const impacto = await questionnaireRepository.contarImpactoDePublicar(c.nivel_practica_id);
  return { cuestionario_id: id, nivel: { id: c.nivel_practica_id, nombre: c.nivel_nombre }, ...impacto };
}

// Aviso a todos los Directores (mejor esfuerzo, igual que el resto de notificaciones).
async function avisarADireccion(aviso) {
  for (const director of await documentRepository.listarDirectores()) {
    if (director.firebase_uid) await crearNotificacion(director.firebase_uid, aviso);
  }
}

/** Habilita o deshabilita una versión publicada. Solo una versión por nivel puede estar habilitada. */
export async function cambiarHabilitado(id, { habilitado }, contexto, auth) {
  const previo = await cargarGestionable(id, auth);

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
  await avisarADireccion({
    tipo: habilitado ? "CUESTIONARIO_HABILITADO" : "CUESTIONARIO_DESHABILITADO",
    titulo: habilitado ? "El docente habilitó un cuestionario" : "El docente deshabilitó un cuestionario",
    mensaje: `${previo.nivel_nombre}: versión ${previo.numero_version}.`,
    entidad: { tipo: "cuestionario", id },
  });
  return armarDetalle(id, auth);
}

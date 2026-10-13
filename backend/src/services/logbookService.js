/**
 * Servicio de bitácoras.
 * Regla central: la bitácora está BLOQUEADA hasta que todos los documentos legales obligatorios estén aprobados.
 * Ciclo de estados: BLOQUEADA → BORRADOR → ENVIADA → EN_EVALUACION → EVALUADA (o DEVUELTA para corregir).
 * El borrador se autoguarda en Firestore; al enviar se copia a PostgreSQL (fuente de verdad) dentro de una transacción.
 */
import { bloquearBorrador, crearNotificacion, leerBorrador, guardarBorrador as persistirBorrador, registrarAuditoria, sembrarBorrador } from "../adapters/firestoreAdapter.js";
import { withTransaction } from "../database/transaction.js";
import * as assignmentRepository from "../repositories/assignmentRepository.js";
import * as documentRepository from "../repositories/documentRepository.js";
import * as logbookRepository from "../repositories/logbookRepository.js";
import * as questionnaireRepository from "../repositories/questionnaireRepository.js";
import { ApiError } from "../utils/apiError.js";
import { BITACORA, ROLES } from "../utils/constants.js";

const { ALCANCE } = assignmentRepository;

// Estados en los que el estudiante puede editar su bitácora.
export const ESTADOS_EDITABLES = ["BORRADOR", "DEVUELTA"];
// Estados posteriores al envío (ya no se edita).
export const ESTADOS_ENVIADOS = ["ENVIADA", "EN_EVALUACION", "EVALUADA"];
/** Estados de la práctica en los que existe (o puede crearse) una bitácora para diligenciar. */
const ESTADOS_PRACTICA_ABIERTA = ["PENDIENTE_DOCUMENTOS", "ACTIVA"];
// Tipos de pregunta que se responden eligiendo opciones (no con texto).
const CERRADAS = ["CERRADA_UNICA", "CERRADA_MULTIPLE"];

// ───────────────────────── Alcance y estado ─────────────────────────

/** Traduce el rol activo en el alcance de datos: cada rol solo ve las asignaciones que le corresponden. */
export function alcancePorRol(auth) {
  switch (auth.rolActivo) {
    case ROLES.DIRECTOR_PROGRAMA: return ALCANCE.director();
    case ROLES.ESTUDIANTE: return ALCANCE.estudiante(auth.usuario.id);
    case ROLES.DOCENTE_SUPERVISOR: return ALCANCE.docente(auth.usuario.id);
    case ROLES.ASESOR_SITIO: return ALCANCE.asesor(auth.usuario.id);
    default: throw ApiError.prohibido();
  }
}

/** Dirección y el propio estudiante ven la bitácora en cualquier estado; evaluadores solo la entregada. */
const esVisiblePara = (auth, bitacora) =>
  auth.rolActivo === ROLES.ESTUDIANTE ||
  auth.rolActivo === ROLES.DIRECTOR_PROGRAMA ||
  ESTADOS_ENVIADOS.includes(bitacora.estado);

/**
 * Carga la bitácora y valida el alcance del usuario (propiedad, asignación del docente, institución del asesor).
 * Quien no tiene acceso recibe "no existe" para no revelar bitácoras ajenas.
 */
export async function cargarBitacoraAutorizada(id, auth) {
  const bitacora = await logbookRepository.buscarPorId(id);
  const asignacion = bitacora ? await assignmentRepository.buscarPorId(bitacora.asignacion_id, alcancePorRol(auth)) : null;
  if (!bitacora || !asignacion || !esVisiblePara(auth, bitacora)) {
    throw ApiError.noEncontrado("La bitácora no existe.", "LOGBOOK_NOT_FOUND");
  }
  return { bitacora, asignacion };
}

/** Solo el estudiante modifica su bitácora. */
export function exigirEstudiante(auth) {
  if (auth.rolActivo !== ROLES.ESTUDIANTE) throw ApiError.prohibido("Solo el estudiante puede modificar su bitácora.");
}

/** La bitácora solo se edita en BORRADOR o DEVUELTA y con la práctica activa (documentos aprobados). */
export function exigirEditable(bitacora, asignacion) {
  if (ESTADOS_ENVIADOS.includes(bitacora.estado)) {
    throw ApiError.conflicto("La bitácora ya fue enviada y no puede modificarse.", "LOGBOOK_ALREADY_SUBMITTED");
  }
  if (!ESTADOS_EDITABLES.includes(bitacora.estado) || asignacion.estado !== "ACTIVA") {
    throw ApiError.reglaDeNegocio(
      "Tu bitácora aún no está habilitada: Dirección debe aprobar todos tus documentos legales.",
      "LOGBOOK_LOCKED"
    );
  }
}

// ───────────────────────── Contenido y requisitos ─────────────────────────

// Cuenta las palabras de un texto (secuencias separadas por espacios).
const contarPalabras = (texto) => (String(texto ?? "").match(/\S+/g) ?? []).length;

// Una pregunta cerrada está respondida si tiene opciones elegidas; una abierta, si tiene texto.
const estaRespondida = (pregunta, respuesta) =>
  CERRADAS.includes(pregunta.tipo) ? (respuesta?.opciones_ids?.length ?? 0) > 0 : Boolean(respuesta?.texto?.trim());

/**
 * Valida y limpia las respuestas contra las preguntas del cuestionario de la bitácora: la pregunta debe
 * pertenecerle, no repetirse, y las opciones deben ser de esa pregunta (una sola en selección única).
 * Las respuestas vacías se descartan.
 */
export function normalizarRespuestas(respuestas, preguntas) {
  const porId = new Map(preguntas.map((p) => [p.id, p]));
  const vistas = new Set();
  const limpias = [];
  const invalida = (pregunta_id, mensaje) =>
    ApiError.reglaDeNegocio(mensaje, "INVALID_ANSWER", [{ pregunta_id }]);

  for (const respuesta of respuestas ?? []) {
    const pregunta = porId.get(respuesta.pregunta_id);
    if (!pregunta) throw invalida(respuesta.pregunta_id, "Una de las respuestas no corresponde al cuestionario de tu bitácora.");
    if (vistas.has(pregunta.id)) throw invalida(pregunta.id, "Hay dos respuestas para la misma pregunta.");
    vistas.add(pregunta.id);

    const opcionesIds = [...new Set(respuesta.opciones_ids ?? [])];
    const texto = respuesta.texto?.trim() ? respuesta.texto.trim() : null;
    if (CERRADAS.includes(pregunta.tipo)) {
      if (texto) throw invalida(pregunta.id, "Una pregunta cerrada se responde eligiendo opciones, no con texto.");
      const validas = new Set(pregunta.opciones.map((o) => o.id));
      if (opcionesIds.some((id) => !validas.has(id))) throw invalida(pregunta.id, "Una de las opciones no pertenece a la pregunta.");
      if (pregunta.tipo === "CERRADA_UNICA" && opcionesIds.length > 1) {
        throw invalida(pregunta.id, "Esta pregunta admite una sola opción.");
      }
      if (opcionesIds.length) limpias.push({ pregunta_id: pregunta.id, texto: null, opciones_ids: opcionesIds });
    } else {
      if (opcionesIds.length) throw invalida(pregunta.id, "Una pregunta abierta no lleva opciones.");
      if (texto) limpias.push({ pregunta_id: pregunta.id, texto, opciones_ids: [] });
    }
  }
  return limpias;
}

/** Condiciones mínimas para enviar (documento maestro 3.15). La interfaz las usa para activar el botón. */
/** Calcula qué le falta a la bitácora para enviarse: mínimo de palabras, al menos una evidencia y preguntas obligatorias respondidas. */
export function evaluarRequisitos({ reflexion, respuestas, preguntas, totalEvidencias }) {
  const porPregunta = new Map(respuestas.map((r) => [r.pregunta_id, r]));
  const palabras = contarPalabras(reflexion);
  const pendientes = preguntas
    .filter((p) => p.obligatoria && !estaRespondida(p, porPregunta.get(p.id)))
    .map((p) => p.id);
  const requisitos = {
    minimo_palabras: BITACORA.MINIMO_PALABRAS_REFLEXION,
    palabras,
    cumple_reflexion: palabras >= BITACORA.MINIMO_PALABRAS_REFLEXION,
    total_evidencias: totalEvidencias,
    cumple_evidencias: totalEvidencias >= 1,
    preguntas_obligatorias_pendientes: pendientes,
  };
  return { ...requisitos, listo_para_enviar: requisitos.cumple_reflexion && requisitos.cumple_evidencias && pendientes.length === 0 };
}

// Convierte los requisitos incumplidos en mensajes concretos para el estudiante.
function detallesDeIncumplimiento(requisitos) {
  const detalles = [];
  if (!requisitos.cumple_reflexion) {
    detalles.push({ campo: "reflexion", mensaje: `La reflexión necesita al menos ${requisitos.minimo_palabras} palabras (tienes ${requisitos.palabras}).` });
  }
  if (!requisitos.cumple_evidencias) detalles.push({ campo: "evidencias", mensaje: "Adjunta al menos una evidencia." });
  for (const id of requisitos.preguntas_obligatorias_pendientes) {
    detalles.push({ campo: "respuestas", pregunta_id: id, mensaje: "Falta responder una pregunta obligatoria." });
  }
  return detalles;
}

// Contenido ya guardado en PostgreSQL (reflexión y respuestas oficiales).
async function contenidoOficial(bitacora, db) {
  return {
    reflexion: bitacora.reflexion ?? "",
    respuestas: (await logbookRepository.listarRespuestas(bitacora.id, db)).map((r) => ({
      pregunta_id: r.pregunta_id, texto: r.texto, opciones_ids: r.opciones_ids,
    })),
  };
}

// ───────────────────────── Vista ─────────────────────────

// Reduce la asignación a los datos que necesita la vista de la bitácora.
const armarAsignacion = (f) => ({
  id: f.id,
  estado: f.estado,
  periodo: { id: f.periodo_id, codigo: f.periodo_codigo },
  nivel: { id: f.nivel_id, codigo: f.nivel_codigo, nombre: f.nivel_nombre },
  institucion: { id: f.institucion_id, nombre: f.institucion_nombre },
  estudiante: { id: f.estudiante_id, nombre_completo: `${f.estudiante_nombres} ${f.estudiante_apellidos}`, documento: f.estudiante_documento },
  docente: f.docente_id ? { id: f.docente_id, nombre_completo: `${f.docente_nombres} ${f.docente_apellidos}` } : null,
  asesor: f.asesor_id ? { id: f.asesor_id, nombre_completo: `${f.asesor_nombres} ${f.asesor_apellidos}` } : null,
});

// Da forma a una pregunta con sus opciones para el frontend.
const armarPregunta = (p) => ({
  id: p.id, tipo: p.tipo, enunciado: p.enunciado, obligatoria: p.obligatoria, orden: p.orden,
  opciones: p.opciones.map((o) => ({ id: o.id, etiqueta: o.etiqueta, valor: o.valor, orden: o.orden })),
});

/** Arma la vista completa de la bitácora: cuestionario, contenido (borrador u oficial), evidencias y requisitos. */
async function construirVista({ bitacora, asignacion, auth, creada = false }) {
  const editable =
    auth.rolActivo === ROLES.ESTUDIANTE && ESTADOS_EDITABLES.includes(bitacora.estado) && asignacion.estado === "ACTIVA";

  let cuestionario = null;
  let preguntas = [];
  if (bitacora.cuestionario_id) {
    const c = await questionnaireRepository.buscarPorId(bitacora.cuestionario_id);
    preguntas = await questionnaireRepository.cargarPreguntas(bitacora.cuestionario_id);
    cuestionario = { id: c.id, numero_version: c.numero_version, titulo: c.titulo, preguntas: preguntas.map(armarPregunta) };
  }

  let contenido;
  if (editable) {
    // El borrador vive en Firestore; si todavía no existe se parte del contenido oficial (vacío en la primera edición).
    const borrador = await leerBorrador(bitacora.id);
    contenido = borrador
      ? { origen: "BORRADOR", reflexion: borrador.reflexion, respuestas: borrador.respuestas, revision: borrador.revision, guardado_en: borrador.guardado_en }
      : { origen: "BORRADOR", ...(await contenidoOficial(bitacora)), revision: 0, guardado_en: null };
  } else if (ESTADOS_ENVIADOS.includes(bitacora.estado) || bitacora.estado === "DEVUELTA") {
    contenido = { origen: "OFICIAL", ...(await contenidoOficial(bitacora)), revision: bitacora.numero_revision_borrador, guardado_en: bitacora.enviada_en };
  } else {
    contenido = { origen: "VACIO", reflexion: "", respuestas: [], revision: 0, guardado_en: null };
  }

  const evidencias = await logbookRepository.listarEvidencias(bitacora.id);
  return {
    id: bitacora.id,
    estado: bitacora.estado,
    editable,
    creada,
    asignacion: armarAsignacion(asignacion),
    cuestionario,
    contenido,
    evidencias: evidencias.map((e) => ({
      id: e.id, nombre: e.nombre, tipo_mime: e.tipo_mime, tamano_bytes: e.tamano_bytes,
      descripcion: e.descripcion, orden: e.orden, es_imagen: e.tipo_mime.startsWith("image/"), creado_en: e.creado_en,
    })),
    requisitos: evaluarRequisitos({ reflexion: contenido.reflexion, respuestas: contenido.respuestas, preguntas, totalEvidencias: evidencias.length }),
    enviada_en: bitacora.enviada_en,
    devuelta_en: bitacora.devuelta_en,
    motivo_devolucion: bitacora.estado === "DEVUELTA" ? bitacora.motivo_devolucion : null,
  };
}

// ───────────────────────── Casos de uso ─────────────────────────

/**
 * Obtiene (y crea la primera vez, solo para el estudiante dueño) la bitácora de una práctica.
 * Nace BLOQUEADA si faltan documentos aprobados y BORRADOR si la práctica ya está activa; en BORRADOR toma
 * el cuestionario habilitado del nivel (las bitácoras existentes conservan su versión).
 */
async function asegurarBitacora(asignacion, existente) {
  const necesitaCuestionario = (b) => ESTADOS_EDITABLES.includes(b.estado) && !b.cuestionario_id && asignacion.estado === "ACTIVA";
  if (existente && !necesitaCuestionario(existente)) return { bitacora: existente, creada: false };
  if (!existente && !ESTADOS_PRACTICA_ABIERTA.includes(asignacion.estado)) {
    throw ApiError.noEncontrado("La práctica no tiene bitácora.", "LOGBOOK_NOT_FOUND");
  }

  return withTransaction(async (client) => {
    // La asignación se bloquea primero (mismo orden que documentos, envío y devolución) para evitar interbloqueos.
    const bloqueada = await documentRepository.bloquearAsignacion(asignacion.id, client);
    let actual = await logbookRepository.buscarPorAsignacion(asignacion.id, client);
    let creada = false;
    const habilitado = bloqueada.estado === "ACTIVA"
      ? await questionnaireRepository.buscarHabilitadoDeNivel(bloqueada.nivel_practica_id, client)
      : null;
    if (!actual) {
      if (!ESTADOS_PRACTICA_ABIERTA.includes(bloqueada.estado)) throw ApiError.noEncontrado("La práctica no tiene bitácora.", "LOGBOOK_NOT_FOUND");
      await logbookRepository.crear(
        { asignacionId: asignacion.id, estado: bloqueada.estado === "ACTIVA" ? "BORRADOR" : "BLOQUEADA", cuestionarioId: habilitado?.id },
        client
      );
      actual = await logbookRepository.buscarPorAsignacion(asignacion.id, client);
      creada = true;
    } else if (habilitado && ESTADOS_EDITABLES.includes(actual.estado) && !actual.cuestionario_id) {
      await logbookRepository.asignarCuestionario(actual.id, habilitado.id, client);
      actual = await logbookRepository.buscarPorId(actual.id, client);
    }
    return { bitacora: actual, creada };
  });
}

/** Obtiene la bitácora de una asignación (el estudiante dueño la crea la primera vez). */
export async function obtenerDeAsignacion(asignacionId, auth) {
  const asignacion = await assignmentRepository.buscarPorId(asignacionId, alcancePorRol(auth));
  if (!asignacion) throw ApiError.noEncontrado("La asignación no existe.", "ASSIGNMENT_NOT_FOUND");
  const existente = await logbookRepository.buscarPorAsignacion(asignacion.id);

  if (auth.rolActivo === ROLES.ESTUDIANTE) {
    const { bitacora, creada } = await asegurarBitacora(asignacion, existente);
    return construirVista({ bitacora, asignacion, auth, creada });
  }
  if (!existente || !esVisiblePara(auth, existente)) {
    throw ApiError.noEncontrado("La práctica todavía no tiene una bitácora disponible.", "LOGBOOK_NOT_FOUND");
  }
  return construirVista({ bitacora: existente, asignacion, auth });
}

/** Obtiene una bitácora por id, validando el acceso. */
export async function obtener(id, auth) {
  const { bitacora: cargada, asignacion } = await cargarBitacoraAutorizada(id, auth);
  let bitacora = cargada;
  if (auth.rolActivo === ROLES.ESTUDIANTE) ({ bitacora } = await asegurarBitacora(asignacion, cargada));
  return construirVista({ bitacora, asignacion, auth });
}

/** Autoguardado: persiste el borrador en Firestore con control de revisión (varias pestañas no se pisan). */
export async function guardarBorrador(id, { revision_base, reflexion, respuestas }, auth) {
  exigirEstudiante(auth);
  const { bitacora, asignacion } = await cargarBitacoraAutorizada(id, auth);
  exigirEditable(bitacora, asignacion);

  const preguntas = bitacora.cuestionario_id ? await questionnaireRepository.cargarPreguntas(bitacora.cuestionario_id) : [];
  const limpias = normalizarRespuestas(respuestas, preguntas);
  const borrador = await persistirBorrador(bitacora.id, {
    propietarioUid: auth.usuario.firebase_uid,
    reflexion,
    respuestas: limpias,
    revisionBase: revision_base,
    desbloquear: bitacora.estado === "DEVUELTA",
  });
  const { total } = await logbookRepository.contarEvidencias(bitacora.id);
  return {
    revision: borrador.revision,
    guardado_en: borrador.guardado_en,
    requisitos: evaluarRequisitos({ reflexion, respuestas: limpias, preguntas, totalEvidencias: total }),
  };
}

// Crea una notificación solo si el destinatario tiene cuenta en Firebase.
const notificar = (firebaseUid, datos) => (firebaseUid ? crearNotificacion(firebaseUid, datos) : Promise.resolve(false));

/**
 * La llave del último envío se conserva aunque Dirección devuelva la bitácora: una solicitud repetida
 * y tardía con esa llave no debe volver a enviar la entrega; para reenviar se usa una llave nueva.
 */
function exigirLlaveNueva(bitacora, llaveAlmacenada) {
  if (bitacora.llave_idempotencia === llaveAlmacenada) {
    throw ApiError.conflicto(
      "Esa llave de idempotencia ya se usó en un envío anterior. Genera una llave nueva para volver a enviar.",
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
}

// Respuesta del envío: estado, fecha y evaluaciones creadas; `idempotente` indica que fue una repetición.
const resultadoDeEnvio = async (bitacora, idempotente) => ({
  bitacora_id: bitacora.id,
  estado: bitacora.estado,
  enviada_en: bitacora.enviada_en,
  evaluaciones: (await logbookRepository.listarEvaluaciones(bitacora.id)).map((e) => ({ tipo: e.tipo_evaluador, estado: e.estado })),
  idempotente,
});

/**
 * Envío definitivo, transaccional e idempotente (documento maestro 4.4 / guía 17):
 * bloquea la bitácora, verifica documentos, valida el borrador y lo copia a las tablas oficiales,
 * pasa a ENVIADA, crea las dos evaluaciones pendientes y deja la práctica en PENDIENTE_EVALUACION.
 * Repetir la misma `llave` devuelve el resultado original sin duplicar nada.
 */
export async function enviar(id, { revision_base }, llave, auth, contexto) {
  exigirEstudiante(auth);
  const { bitacora, asignacion } = await cargarBitacoraAutorizada(id, auth);
  const llaveAlmacenada = `${bitacora.id}:${llave}`;

  const repetido = async (actual) => {
    if (actual.llave_idempotencia === llaveAlmacenada) return resultadoDeEnvio(actual, true);
    throw ApiError.conflicto("La bitácora ya fue enviada.", "LOGBOOK_ALREADY_SUBMITTED");
  };
  if (ESTADOS_ENVIADOS.includes(bitacora.estado)) return repetido(bitacora);
  exigirEditable(bitacora, asignacion);
  exigirLlaveNueva(bitacora, llaveAlmacenada);

    // Lectura remota ANTES de abrir la transacción (no se hacen llamadas largas con filas bloqueadas).
  // Lectura remota ANTES de abrir la transacción (no se hacen llamadas largas con filas bloqueadas).
  const borrador =
    (await leerBorrador(bitacora.id)) ?? { ...(await contenidoOficial(bitacora)), revision: 0 };
  if (borrador.revision !== revision_base) {
    throw ApiError.conflicto(
      "El borrador cambió desde que lo revisaste. Recarga la bitácora antes de enviar.",
      "DRAFT_CONFLICT",
      [{ revision_actual: borrador.revision }]
    );
  }

    // Transacción: bloquea la asignación y la bitácora, y revalida todo con los datos bloqueados.
  const resultado = await withTransaction(async (client) => {
    const bloqueada = await documentRepository.bloquearAsignacion(asignacion.id, client);
    const actual = await logbookRepository.buscarPorId(bitacora.id, client, { bloquear: true });
    if (ESTADOS_ENVIADOS.includes(actual.estado)) return { repetido: await repetido(actual) };
    exigirEditable(actual, bloqueada);
    exigirLlaveNueva(actual, llaveAlmacenada);

        // Regla: todos los documentos obligatorios deben estar aprobados.
    const { total, aprobados } = await documentRepository.contarObligatorios(asignacion.id, client);
    if (aprobados !== total) {
      throw ApiError.reglaDeNegocio("Hay documentos legales sin aprobar: la bitácora está bloqueada.", "LOGBOOK_LOCKED");
    }
    const fila = await assignmentRepository.buscarPorId(asignacion.id, ALCANCE.director(), client);
        // Regla: debe haber docente supervisor y asesor para que existan quienes evalúen.
    if (!fila.docente_id || !fila.asesor_id) {
      throw ApiError.reglaDeNegocio(
        "Tu práctica aún no tiene docente supervisor y asesor de sitio asignados. Contacta a Dirección para poder enviar.",
        "EVALUATORS_MISSING",
        [{ docente_asignado: Boolean(fila.docente_id), asesor_asignado: Boolean(fila.asesor_id) }]
      );
    }

        // Se validan respuestas y requisitos mínimos antes de copiar el borrador a las tablas oficiales.
    const preguntas = actual.cuestionario_id ? await questionnaireRepository.cargarPreguntas(actual.cuestionario_id, client) : [];
    const respuestas = normalizarRespuestas(borrador.respuestas, preguntas);
    const { total: totalEvidencias } = await logbookRepository.contarEvidencias(actual.id, client);
    const requisitos = evaluarRequisitos({ reflexion: borrador.reflexion, respuestas, preguntas, totalEvidencias });
    if (!requisitos.listo_para_enviar) {
      throw ApiError.reglaDeNegocio("La bitácora no cumple los requisitos mínimos para enviarse.", "LOGBOOK_INCOMPLETE", detallesDeIncumplimiento(requisitos));
    }

        // Se guarda el contenido oficial, se marca ENVIADA, la práctica pasa a PENDIENTE_EVALUACION y se crean las dos evaluaciones.
    await logbookRepository.reemplazarRespuestas(actual.id, respuestas, client);
    await logbookRepository.marcarEnviada(
      { id: actual.id, reflexion: borrador.reflexion.trim(), revision: borrador.revision, llave: llaveAlmacenada },
      client
    );
    await documentRepository.cambiarEstadoAsignacion(asignacion.id, "PENDIENTE_EVALUACION", client);
    await logbookRepository.crearEvaluacionesPendientes(
      { asignacionId: asignacion.id, bitacoraId: actual.id, docenteId: fila.docente_id, asesorId: fila.asesor_id },
      client
    );
    return { fila, requisitos, totalRespuestas: respuestas.length };
  });
    // Si fue una repetición con la misma llave, se devuelve el resultado original.
  if (resultado.repetido) return resultado.repetido;

  // Fuera de la transacción: el envío ya está confirmado en PostgreSQL; lo demás es mejor esfuerzo.
  await bloquearBorrador(bitacora.id);
  await registrarAuditoria({
    contexto,
    accion: "BITACORA_ENVIADA",
    entidad: "bitacoras",
    entidad_id: bitacora.id,
    valor_anterior: { estado: bitacora.estado },
    valor_nuevo: {
      estado: "ENVIADA",
      revision_borrador: borrador.revision,
      palabras: resultado.requisitos.palabras,
      evidencias: resultado.requisitos.total_evidencias,
      respuestas: resultado.totalRespuestas,
    },
  });
  const aviso = {
    tipo: "BITACORA_ENVIADA",
    titulo: "Hay una bitácora para evaluar",
    mensaje: `${resultado.fila.estudiante_nombres} ${resultado.fila.estudiante_apellidos} envió su bitácora.`,
    entidad: { tipo: "bitacora", id: bitacora.id },
  };
  await notificar(resultado.fila.docente_firebase_uid, aviso);
  await notificar(resultado.fila.asesor_firebase_uid, aviso);
  await notificar(asignacion.estudiante_firebase_uid, {
    tipo: "BITACORA_RECIBIDA",
    titulo: "Tu bitácora fue enviada",
    mensaje: "Tu docente y tu asesor ya pueden evaluarla.",
    entidad: { tipo: "bitacora", id: bitacora.id },
  });

  return resultadoDeEnvio(await logbookRepository.buscarPorId(bitacora.id), false);
}

/**
 * Dirección devuelve una bitácora enviada para que el estudiante la corrija. No se puede devolver si algún
 * evaluador ya publicó su nota. Las evaluaciones sin publicar se retiran y se recrean en el siguiente envío.
 */
export async function devolver(id, { motivo }, contexto) {
  const previa = await logbookRepository.buscarPorId(id);
  if (!previa) throw ApiError.noEncontrado("La bitácora no existe.", "LOGBOOK_NOT_FOUND");

    // Transacción: retira las evaluaciones pendientes, marca la bitácora como DEVUELTA y reactiva la práctica.
  const { bitacora, asignacion, evaluacionesRetiradas } = await withTransaction(async (client) => {
    const bloqueada = await documentRepository.bloquearAsignacion(previa.asignacion_id, client);
    const actual = await logbookRepository.buscarPorId(id, client, { bloquear: true });
    if (!["ENVIADA", "EN_EVALUACION"].includes(actual.estado)) {
      throw ApiError.reglaDeNegocio(`No se puede devolver una bitácora en estado ${actual.estado}.`, "INVALID_LOGBOOK_TRANSITION", [{ estado_actual: actual.estado }]);
    }
    if ((await logbookRepository.contarEvaluacionesPublicadas(id, client)) > 0) {
      throw ApiError.reglaDeNegocio("Un evaluador ya publicó su nota: la bitácora no puede devolverse.", "EVALUATION_ALREADY_PUBLISHED");
    }
    const retiradas = await logbookRepository.retirarEvaluacionesDeBitacora(id, client);
    await logbookRepository.marcarDevuelta({ id, motivo }, client);
    await documentRepository.cambiarEstadoAsignacion(bloqueada.id, "ACTIVA", client);
    return { bitacora: actual, asignacion: bloqueada, evaluacionesRetiradas: retiradas };
  });

  // El estudiante corrige a partir de lo que entregó: se vuelve a sembrar el borrador con el contenido oficial.
  const oficial = await contenidoOficial(bitacora);
  await sembrarBorrador(id, {
    propietarioUid: asignacion.estudiante_firebase_uid,
    reflexion: oficial.reflexion,
    respuestas: oficial.respuestas,
    revision: bitacora.numero_revision_borrador + 1,
  });
  await registrarAuditoria({
    contexto,
    accion: "BITACORA_DEVUELTA",
    entidad: "bitacoras",
    entidad_id: id,
    valor_anterior: { estado: bitacora.estado },
    valor_nuevo: { estado: "DEVUELTA", motivo, evaluaciones_retiradas: evaluacionesRetiradas },
  });
  await notificar(asignacion.estudiante_firebase_uid, {
    tipo: "BITACORA_DEVUELTA",
    titulo: "Tu bitácora fue devuelta",
    mensaje: motivo,
    prioridad: "alta",
    entidad: { tipo: "bitacora", id },
  });
  return { bitacora_id: id, estado: "DEVUELTA", motivo_devolucion: motivo };
}

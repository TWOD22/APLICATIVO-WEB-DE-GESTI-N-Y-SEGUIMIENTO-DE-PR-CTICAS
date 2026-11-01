/**
 * Datos de demostración del sistema: crea (y borra) un escenario completo con estudiantes de 1.º a 3.er semestre,
 * docentes, asesores, instituciones de Bucaramanga, solicitudes en todos los estados, bitácoras, evaluaciones e
 * historial de periodos anteriores.
 *
 * Todo se hace con los MISMOS servicios que usa la API (reglas, auditoría, notificaciones, almacenamiento), así que lo
 * que se ve en pantalla es exactamente lo que produciría el uso real. Lo creado se reconoce por el dominio
 * `@demo.udi.test` y por la marca «(demostración)», y `limpiarDemo` lo elimina sin tocar datos reales.
 */
import { pool } from "../config/database.js";
import * as firebaseAuth from "../adapters/firebaseAuthAdapter.js";
import * as storage from "../adapters/storageAdapter.js";
import * as periodRepository from "../repositories/periodRepository.js";
import * as levelTeacherRepository from "../repositories/levelTeacherRepository.js";
import * as questionnaireRepository from "../repositories/questionnaireRepository.js";
import * as institutionRepository from "../repositories/institutionRepository.js";
import * as enrollmentRepository from "../repositories/enrollmentRepository.js";
import * as users from "../services/userService.js";
import * as institutions from "../services/institutionService.js";
import * as levelTeachers from "../services/levelTeacherService.js";
import * as questionnaires from "../services/questionnaireService.js";
import * as guides from "../services/criteriaGuideService.js";
import * as requests from "../services/practiceRequestService.js";
import * as documents from "../services/documentService.js";
import * as assignments from "../services/assignmentService.js";
import * as logbooks from "../services/logbookService.js";
import * as evidences from "../services/evidenceService.js";
import * as evaluations from "../services/evaluationService.js";
import {
  ASESORES, CONTRASENA_DEMO, DOCENTES, DOCENTE_PP1_SI_NO_EXISTE, DOMINIO_DEMO, ESTADOS, INSTITUCIONES,
  MARCA_CUESTIONARIO, MARCA_PERIODO, MOTIVOS_DEVOLUCION_DOCUMENTO, PREGUNTAS_CUESTIONARIO, PREGUNTA_EXTRA_POR_NIVEL,
  REFLEXIONES, RESPUESTAS_ABIERTAS, RETROALIMENTACIONES_ASESOR, RETROALIMENTACIONES_DOCENTE, crearAzar, generarPersonas, correoDemo,
} from "./catalogoDemo.js";
import { pdfDocumentoLegal, pdfGuiaCriterios, pngEvidencia } from "./generadores.js";

const ROL = { DIRECTOR: "DIRECTOR_PROGRAMA", ESTUDIANTE: "ESTUDIANTE", DOCENTE: "DOCENTE_SUPERVISOR", ASESOR: "ASESOR_SITIO" };
const NIVELES = ["PP1", "PP2", "PP3"];
const PREFIJO_ARCHIVO_DEMO = "demo-";
const CLAVES_CON_ASESOR = ["pedro_claver", "normal", "salesiano", "bethlemitas", "americano"];

/** Cuántos días de antigüedad tiene cada situación al correr el script [mín, máx]. Hace que las alertas del Director aparezcan. */
const ANTIGUEDAD_DIAS = {
  BORRADOR: [1, 6], POR_REVISAR: [1, 6], LISTA_PARA_ASIGNAR: [1, 5], DEVUELTA: [2, 9], PIDE_PLAZA_SIN_ASESOR: [1, 4],
  ACTIVA_SIN_AVANCE: [8, 16], ACTIVA_EN_BORRADOR: [6, 14], BITACORA_ENVIADA: [2, 8], EVALUACION_PARCIAL: [4, 10],
  EVALUACION_EN_BORRADOR: [3, 9], LISTA_PARA_CERRAR: [3, 8], FINALIZADA: [10, 25], RECHAZADA: [5, 15],
};

/** Fecha en formato AAAA-MM-DD. */
const iso = (fecha) => new Date(fecha).toISOString().slice(0, 10);
/** Fecha resultante de sumar (o restar) días a otra. */
const sumarDias = (fecha, dias) => new Date(new Date(fecha).getTime() + dias * 86400000);
/** Días de diferencia entre dos fechas. */
const diasEntre = (desde, hasta) => Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000);

// ───────────────────────────── Sembrar ─────────────────────────────

/**
 * Crea todo el escenario. Devuelve un resumen con las cuentas para mostrar al final.
 * @param {{log?: Function, semilla?: number, docenteCorreo?: string}} opciones
 */
export async function sembrarDemo({ log = () => {}, semilla, docenteCorreo } = {}) {
  const azar = crearAzar(semilla);
  const hoy = new Date();

  // 0) Comprobaciones previas
  const { rows: [{ n: yaHay }] } = await pool.query("SELECT count(*)::int AS n FROM usuarios WHERE correo_institucional ILIKE $1", [`%@${DOMINIO_DEMO}`]);
  if (yaHay > 0) {
    throw new Error(`Ya hay datos de demostración (${yaHay} usuarios @${DOMINIO_DEMO}). Elimínalos primero (demo:limpiar) o usa demo:reiniciar.`);
  }
  const actual = await periodRepository.buscarActivo();
  if (!actual) throw new Error("No hay un periodo académico activo. Crea o activa uno antes de generar la demostración.");
  const { rows: [director] } = await pool.query(
    `SELECT u.id, u.firebase_uid FROM usuarios u
       JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.eliminado_en IS NULL
       JOIN roles r ON r.id = ur.rol_id AND r.codigo = $1
      WHERE u.eliminado_en IS NULL AND u.estado = 'ACTIVO' ORDER BY u.creado_en LIMIT 1`, [ROL.DIRECTOR]);
  if (!director) throw new Error("No hay un Director de Programa activo en la base de datos.");
  const { rows: [programa] } = await pool.query("SELECT id FROM programas_academicos WHERE codigo = 'LEI' AND eliminado_en IS NULL");
  const niveles = Object.fromEntries((await pool.query("SELECT id, codigo, nombre FROM niveles_practica WHERE codigo = ANY($1) AND eliminado_en IS NULL", [NIVELES])).rows.map((n) => [n.codigo, n]));
  if (!programa || NIVELES.some((c) => !niveles[c])) throw new Error("Faltan los catálogos base (programa LEI y niveles PP1 a PP3). Ejecuta el seed base.");

  // Sesiones y contextos como los arma la API.
  const como = (rolActivo, u) => ({ rolActivo, usuario: { id: u.id, firebase_uid: u.firebase_uid } });
  /** Contexto de auditoría para una acción hecha por un usuario; deja marcado el origen «demo-datos». */
  const ctxDe = (u, rol) => ({ actor: { usuario_id: u.id, firebase_uid: u.firebase_uid, rol_activo: rol }, direccion_ip: "127.0.0.1", agente_usuario: "demo-datos", request_id: "demo-datos" });
  const ctxDir = ctxDe(director, ROL.DIRECTOR);

  // Documentos de identidad inventados (10 dígitos, rango poco probable para personas reales).
  let consecutivo = 0;
  const nuevoDocumento = () => `88${String(++consecutivo).padStart(8, "0")}`;
  const correos = new Set();

  /** Crea un usuario con el servicio real, le pone la contraseña de demostración en Firebase y devuelve sus datos con el id. */
  const persona = async (datos) => {
    datos = { ...datos, documento: datos.documento ?? nuevoDocumento() };
    const creado = await users.crear({ telefono: null, ...datos }, ctxDir);
    const { rows: [f] } = await pool.query("SELECT id, firebase_uid FROM usuarios WHERE id = $1", [creado.id]);
    await firebaseAuth.actualizarUsuario(f.firebase_uid, { password: CONTRASENA_DEMO, emailVerified: true });
    return { ...datos, id: f.id, firebase_uid: f.firebase_uid, nombre: `${datos.nombres} ${datos.apellidos}` };
  };

  // 1) Instituciones
  log("Creando instituciones…");
  const inst = {};
  for (const i of INSTITUCIONES) {
    const { clave, ...datos } = i;
    const creada = await institutions.crear({ ...datos, correo: `contacto.${clave}@${DOMINIO_DEMO}` }, ctxDir);
    inst[clave] = { id: creada.id, nombre: i.nombre, clave };
  }

  // 2) Periodos anteriores (historial) — solo existen para que los estudiantes de 2.º y 3.º tengan sus prácticas previas.
  const crearPeriodo = async (codigo, inicio, fin) => {
    const { rows } = await pool.query("SELECT id, nombre FROM periodos_academicos WHERE codigo = $1 AND eliminado_en IS NULL", [codigo]);
    if (rows.length) throw new Error(`Ya existe el periodo ${codigo} (${rows[0].nombre}). La demostración necesita crearlo para el historial; renómbralo o elimínalo.`);
    const { rows: [p] } = await pool.query(
      `INSERT INTO periodos_academicos (codigo, nombre, fecha_inicio, fecha_fin, estado) VALUES ($1, $2, $3, $4, 'CERRADO') RETURNING id, codigo, fecha_inicio, fecha_fin`,
      [codigo, `Periodo académico ${codigo} ${MARCA_PERIODO}`, inicio, fin]);
    return { id: p.id, codigo: p.codigo, fecha_inicio: iso(p.fecha_inicio), fecha_fin: iso(p.fecha_fin) };
  };
  const p2025 = await crearPeriodo("2025-2", "2025-07-21", "2025-12-06");
  const p2026 = await crearPeriodo("2026-1", "2026-01-26", "2026-06-13");
  const pActual = { id: actual.id, codigo: actual.codigo, fecha_inicio: iso(actual.fecha_inicio), fecha_fin: iso(actual.fecha_fin) };
  const todosLosPeriodos = [p2025, p2026, pActual];

  // 3) Personal: docentes (el docente real existente es el de Práctica I) y asesores de sitio
  log("Creando docentes y asesores…");
  const docentes = {};
  const { rows: candidatos } = await pool.query(
    `SELECT u.id, u.firebase_uid, u.nombres, u.apellidos, u.correo_institucional AS correo FROM usuarios u
       JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.eliminado_en IS NULL
       JOIN roles r ON r.id = ur.rol_id AND r.codigo = $1
      WHERE u.eliminado_en IS NULL AND u.estado = 'ACTIVO' AND u.correo_institucional NOT ILIKE $2
        AND ($3::text IS NULL OR u.correo_institucional ILIKE $3)
      ORDER BY u.creado_en`, [ROL.DOCENTE, `%@${DOMINIO_DEMO}`, docenteCorreo ?? null]);
  if (docenteCorreo && !candidatos.length) throw new Error(`No se encontró un docente supervisor activo con el correo ${docenteCorreo}.`);
  if (candidatos.length) {
    const d = candidatos[0];
    docentes.PP1 = { ...d, nombre: `${d.nombres} ${d.apellidos}`, existente: true };
    log(`  Docente de Práctica I: ${docentes.PP1.nombre} (cuenta existente ${d.correo}).`);
  } else {
    const d = DOCENTE_PP1_SI_NO_EXISTE;
    docentes.PP1 = await persona({ rol: ROL.DOCENTE, nombres: d.nombres, apellidos: d.apellidos, correo: correoDemo(d.nombres, d.apellidos, correos) });
  }
  for (const d of DOCENTES) {
    docentes[d.nivel] = await persona({ rol: ROL.DOCENTE, nombres: d.nombres, apellidos: d.apellidos, correo: correoDemo(d.nombres, d.apellidos, correos) });
  }
  const asesores = Object.fromEntries(CLAVES_CON_ASESOR.map((c) => [c, []]));
  const cargos = new Map();
  for (const a of ASESORES) {
    const creado = await persona({ rol: ROL.ASESOR, nombres: a.nombres, apellidos: a.apellidos, correo: correoDemo(a.nombres, a.apellidos, correos), institucion_id: inst[a.institucion].id });
    asesores[a.institucion].push(creado);
    cargos.set(creado.id, a.cargo);
  }
  // Vinculaciones de los asesores en los periodos anteriores (la del periodo actual la crea el alta de usuario).
  const todosAsesores = Object.values(asesores).flat();
  for (const a of todosAsesores) {
    const institucionClave = Object.keys(asesores).find((c) => asesores[c].includes(a));
    for (const p of [p2025, p2026]) await institutionRepository.crearVinculacionAsesor({ asesorId: a.id, institucionId: inst[institucionClave].id, periodoId: p.id });
    await pool.query("UPDATE vinculaciones_asesores SET cargo = $2 WHERE asesor_id = $1", [a.id, cargos.get(a.id)]);
  }

  // 4) Estudiantes: 10 por semestre (1.º a 3.º ↔ Práctica I a III), con estados repartidos al azar
  log("Creando 30 estudiantes…");
  const estados = azar.mezclar(ESTADOS);
  const personas = generarPersonas(30, azar, correos);
  const estudiantes = [];
  for (let i = 0; i < 30; i++) {
    const semestre = Math.floor(i / 10) + 1;
    const e = await persona({ rol: ROL.ESTUDIANTE, ...personas[i], semestre });
    estudiantes.push({ ...e, semestre, nivel: NIVELES[semestre - 1], estado: estados[i] });
  }
  // Matrículas de los periodos anteriores para quienes ya cursaron prácticas.
  for (const e of estudiantes) {
    if (e.semestre === 3) await enrollmentRepository.crearMatricula({ estudianteId: e.id, programaId: programa.id, periodoId: p2025.id, semestre: 1 });
    if (e.semestre >= 2) await enrollmentRepository.crearMatricula({ estudianteId: e.id, programaId: programa.id, periodoId: p2026.id, semestre: e.semestre - 1 });
  }

  // ───── utilidades de flujo ─────
  const tiposPorNivel = {};
  for (const c of NIVELES) {
    tiposPorNivel[c] = (await pool.query(
      `SELECT DISTINCT t.id, t.nombre, t.codigo FROM requisitos_documentales r JOIN tipos_documento_legal t ON t.id = r.tipo_documento_legal_id
        WHERE r.nivel_practica_id = $1 AND r.obligatorio AND r.eliminado_en IS NULL AND r.eliminado_en IS NULL ORDER BY t.nombre`, [niveles[c].id])).rows;
  }
  const docentePorPeriodo = {};
  const docenteDe = (periodo, codigo) => docentePorPeriodo[periodo.id][codigo];

  /** Define el docente de cada nivel del periodo (respeta el que ya exista) y deja listos cuestionario y guía. */
  const prepararPeriodo = async (periodo, codigos) => {
    docentePorPeriodo[periodo.id] = {};
    for (const codigo of codigos) {
      const vigente = await levelTeacherRepository.buscarVigente(niveles[codigo].id, periodo.id);
      if (vigente) {
        const { rows: [d] } = await pool.query("SELECT id, firebase_uid, nombres, apellidos FROM usuarios WHERE id = $1", [vigente.docente_id]);
        docentePorPeriodo[periodo.id][codigo] = { ...d, nombre: `${d.nombres} ${d.apellidos}` };
      } else {
        await levelTeachers.definir(niveles[codigo].id, { docente_id: docentes[codigo].id, periodo_id: periodo.id }, ctxDir);
        docentePorPeriodo[periodo.id][codigo] = docentes[codigo];
      }
      const d = docentePorPeriodo[periodo.id][codigo];
      const auth = como(ROL.DOCENTE, d);
      const ctxDoc = ctxDe(d, ROL.DOCENTE);
      if (!(await questionnaireRepository.buscarHabilitadoDeNivel(niveles[codigo].id))) {
        const nuevo = await questionnaires.crear({ nivel_practica_id: niveles[codigo].id, titulo: `Seguimiento semanal · ${niveles[codigo].nombre} ${MARCA_CUESTIONARIO}`, sin_copia: true }, ctxDoc, auth);
        const preguntas = [...PREGUNTAS_CUESTIONARIO, PREGUNTA_EXTRA_POR_NIVEL[codigo]];
        for (const p of preguntas) {
          await questionnaires.agregarPregunta(nuevo.id, { tipo: p.tipo, enunciado: p.enunciado, obligatoria: p.obligatoria, opciones: (p.opciones ?? []).map((etiqueta) => ({ etiqueta })) }, auth);
        }
        await questionnaires.publicar(nuevo.id, ctxDoc, auth);
      }
      const { rowCount } = await pool.query(
        "SELECT 1 FROM guias_criterios WHERE nivel_practica_id = $1 AND periodo_academico_id = $2 AND eliminado_en IS NULL", [niveles[codigo].id, periodo.id]);
      if (!rowCount) {
        await guides.subir({
          nivelId: niveles[codigo].id, periodoId: periodo.id, contenido: pdfGuiaCriterios({ nivel: niveles[codigo].nombre, docente: d.nombre }),
          tipoMime: "application/pdf", nombreArchivo: `${PREFIJO_ARCHIVO_DEMO}guia-criterios-${codigo}-${periodo.codigo}.pdf`,
        }, auth, ctxDoc);
      }
    }
  };

  /** Pone `periodo` como activo mientras corre `fn` (los servicios trabajan siempre sobre el periodo activo) y lo restaura. */
  const conPeriodoActivo = async (periodo, fn) => {
    if (periodo.id === actual.id) return fn();
    await pool.query("UPDATE periodos_academicos SET estado = 'CERRADO' WHERE id = $1", [actual.id]);
    await pool.query("UPDATE periodos_academicos SET estado = 'ACTIVO' WHERE id = $1", [periodo.id]);
    try {
      return await fn();
    } finally {
      await pool.query("UPDATE periodos_academicos SET estado = 'CERRADO' WHERE id = $1", [periodo.id]);
      await pool.query("UPDATE periodos_academicos SET estado = 'ACTIVO' WHERE id = $1", [actual.id]);
    }
  };

  // Pasos del flujo de una práctica
  const sesionDe = (e) => ({ auth: como(ROL.ESTUDIANTE, e), ctx: ctxDe(e, ROL.ESTUDIANTE) });
  /** El estudiante solicita la práctica de un nivel; devuelve el id de la solicitud. */
  const solicitar = async (e, codigo) => {
    const { auth, ctx } = sesionDe(e);
    return (await requests.crear({ nivel_practica_id: niveles[codigo].id }, auth, ctx)).id;
  };
  /** El estudiante elige la institución donde quiere hacer la práctica. */
  const elegirPlaza = (e, id, clave) => requests.elegirPlaza(id, { institucion_id: inst[clave].id }, sesionDe(e).auth, sesionDe(e).ctx);
  /** El estudiante sube los PDF de ejemplo de los documentos legales del nivel (todos, o solo los primeros `cantidad`). */
  const subirDocumentos = async (e, id, codigo, clave, cantidad = Infinity) => {
    const { auth, ctx } = sesionDe(e);
    for (const tipo of tiposPorNivel[codigo].slice(0, cantidad)) {
      await documents.subir({
        asignacionId: id, tipoId: tipo.id, tipoMime: "application/pdf", nombreArchivo: `${tipo.codigo.toLowerCase()}-${e.apellidos.split(" ")[0].toLowerCase()}.pdf`,
        contenido: pdfDocumentoLegal({ tipo: `${tipo.nombre} · ${codigo}`, estudiante: e.nombre, documento: e.documento ?? "—", institucion: clave ? inst[clave].nombre : null }),
      }, auth, ctx);
    }
  };
  /** El estudiante envía la solicitud a Dirección. */
  const enviarSolicitud = (e, id) => requests.enviar(id, sesionDe(e).auth, sesionDe(e).ctx);
  /** Ids de los documentos legales vigentes de una solicitud. */
  const idsDocumentos = async (id) => (await pool.query("SELECT id FROM documentos_legales_estudiantes WHERE asignacion_practica_id = $1 AND es_version_actual AND eliminado_en IS NULL ORDER BY creado_en", [id])).rows.map((r) => r.id);
  /** El Director aprueba el expediente completo. */
  const aprobarTodo = (id) => documents.aprobarExpediente(id, ctxDir);
  /** El Director confirma la solicitud y asigna la práctica (institución, asesor y fechas). */
  const confirmar = (id, datos) => assignments.confirmarSolicitud(id, datos, ctxDir);

  /** Genera respuestas al azar para las preguntas del cuestionario; algunas preguntas opcionales se dejan sin responder. */
  const respuestasPara = (preguntas) => preguntas.flatMap((p) => {
    if (!p.obligatoria && azar.siguiente() < 0.3) return [];
    if (p.tipo === "ABIERTA") return [{ pregunta_id: p.id, texto: azar.elegir(RESPUESTAS_ABIERTAS) }];
    if (p.tipo === "CERRADA_UNICA") return [{ pregunta_id: p.id, opciones_ids: [azar.elegir(p.opciones).id] }];
    return [{ pregunta_id: p.id, opciones_ids: azar.mezclar(p.opciones).slice(0, azar.entero(2, 3)).map((o) => o.id) }];
  });
  /** Abre la bitácora (la crea) y, según `hasta`, la deja en borrador con evidencias o enviada. */
  const trabajarBitacora = async (e, id, hasta) => {
    const { auth, ctx } = sesionDe(e);
    const vista = await logbooks.obtenerDeAsignacion(id, auth);
    if (hasta === "ABRIR") return vista;
    const fotos = azar.entero(1, 3);
    for (let k = 0; k < fotos; k++) {
      await evidences.subir({
        bitacoraId: vista.id, contenido: pngEvidencia({ variante: azar.entero(0, 3) + k }), tipoMime: "image/png",
        nombreArchivo: `actividad-${k + 1}.png`, descripcion: azar.elegir(["Actividad con el grupo", "Trabajo de los niños", "Rincón de arte", "Juego en el patio"]),
      }, auth, ctx);
    }
    const guardado = await logbooks.guardarBorrador(vista.id, { revision_base: vista.contenido.revision, reflexion: azar.elegir(REFLEXIONES), respuestas: respuestasPara(vista.cuestionario?.preguntas ?? []) }, auth);
    if (hasta === "BORRADOR") return vista;
    return logbooks.enviar(vista.id, { revision_base: guardado.revision }, `demo-${vista.id}`.slice(0, 40), auth, ctx);
  };
  /** Nota al azar entre 3,2 y 4,9 con un decimal. */
  const nota = () => Number(azar.entero(32, 49) / 10).toFixed(1);
  /** El docente o el asesor registra su evaluación de una práctica con nota y retroalimentación al azar; la publica o la deja en borrador. */
  const evaluar = async (id, periodo, codigo, quien, { publicar }) => {
    const docente = docenteDe(periodo, codigo);
    const { rows } = await pool.query("SELECT id, tipo_evaluador FROM evaluaciones WHERE asignacion_practica_id = $1 AND eliminado_en IS NULL", [id]);
    const tipo = quien === "DOCENTE" ? "DOCENTE_SUPERVISOR" : "ASESOR_SITIO";
    const evaluacion = rows.find((r) => r.tipo_evaluador === tipo);
    const evaluador = quien === "DOCENTE" ? docente : (await pool.query("SELECT u.id, u.firebase_uid FROM asignaciones_practica a JOIN usuarios u ON u.id = a.asesor_sitio_id WHERE a.id = $1", [id])).rows[0];
    const auth = como(quien === "DOCENTE" ? ROL.DOCENTE : ROL.ASESOR, evaluador);
    const datos = { nota: nota(), retroalimentacion: azar.elegir(quien === "DOCENTE" ? RETROALIMENTACIONES_DOCENTE : RETROALIMENTACIONES_ASESOR) };
    if (publicar) await evaluations.publicar(evaluacion.id, datos, auth, ctxDe(evaluador, auth.rolActivo));
    else await evaluations.guardarBorrador(evaluacion.id, datos, auth);
  };

  /** Desplaza hacia el pasado las fechas de la práctica (y de todo lo que cuelga de ella) para que parezca de hace `dias` días. */
  const retroceder = async (asignacionId, dias, { inicio, fin } = {}) => {
    if (dias <= 0) return;
    const cliente = await pool.connect();
    const GRUPOS = [
      ["asignaciones_practica", "id = $1"],
      ["documentos_legales_estudiantes", "asignacion_practica_id = $1"],
      ["bitacoras", "asignacion_practica_id = $1"],
      ["evidencias_bitacora", "bitacora_id IN (SELECT id FROM bitacoras WHERE asignacion_practica_id = $1)"],
      ["respuestas_bitacora", "bitacora_id IN (SELECT id FROM bitacoras WHERE asignacion_practica_id = $1)"],
      ["evaluaciones", "asignacion_practica_id = $1"],
      ["evaluaciones_historial", "evaluacion_id IN (SELECT id FROM evaluaciones WHERE asignacion_practica_id = $1)"],
    ];
    try {
      await cliente.query("BEGIN");
      for (const [tabla, donde] of GRUPOS) {
        const { rows: cols } = await cliente.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
              AND data_type = 'timestamp with time zone' AND column_name <> 'eliminado_en'`, [tabla]);
        if (!cols.length) continue;
        await cliente.query(`ALTER TABLE ${tabla} DISABLE TRIGGER USER`);
        await cliente.query(`UPDATE ${tabla} SET ${cols.map((c) => `${c.column_name} = ${c.column_name} - make_interval(days => $2::int)`).join(", ")} WHERE ${donde}`, [asignacionId, dias]);
        await cliente.query(`ALTER TABLE ${tabla} ENABLE TRIGGER USER`);
      }
      if (inicio) {
        await cliente.query("ALTER TABLE asignaciones_practica DISABLE TRIGGER USER");
        await cliente.query("UPDATE asignaciones_practica SET fecha_inicio = $2, fecha_fin = $3 WHERE id = $1 AND estado IN ('ACTIVA', 'PENDIENTE_EVALUACION', 'FINALIZADA')", [asignacionId, inicio, fin]);
        await cliente.query("ALTER TABLE asignaciones_practica ENABLE TRIGGER USER");
      }
      await cliente.query("COMMIT");
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    } finally {
      cliente.release();
    }
  };

  /** Una práctica completa de periodos anteriores: solicitada, aprobada, asignada, bitácora evaluada y finalizada. */
  const practicaHistorica = async (e, codigo, periodo) => {
    const clave = azar.elegir(CLAVES_CON_ASESOR);
    const id = await solicitar(e, codigo);
    await elegirPlaza(e, id, clave);
    await subirDocumentos(e, id, codigo, clave);
    await enviarSolicitud(e, id);
    await aprobarTodo(id);
    await confirmar(id, { institucion_id: inst[clave].id, asesor_sitio_id: asesores[clave][0].id });
    await trabajarBitacora(e, id, "ENVIAR");
    await evaluar(id, periodo, codigo, "DOCENTE", { publicar: true });
    await evaluar(id, periodo, codigo, "ASESOR", { publicar: true });
    await evaluations.finalizarPractica(id, ctxDir);
    const dias = Math.max(1, diasEntre(periodo.fecha_fin, hoy) + azar.entero(5, 25));
    await retroceder(id, dias, { inicio: iso(sumarDias(periodo.fecha_inicio, 7)), fin: iso(sumarDias(periodo.fecha_fin, -7)) });
  };

  // 5) Historial: 2025-2 (PP1 de los de 3.º) y 2026-1 (PP1 de los de 2.º, PP2 de los de 3.º)
  log("Creando el historial de periodos anteriores…");
  await conPeriodoActivo(p2025, async () => {
    await prepararPeriodo(p2025, ["PP1"]);
    for (const e of estudiantes.filter((x) => x.semestre === 3)) await practicaHistorica(e, "PP1", p2025);
  });
  await conPeriodoActivo(p2026, async () => {
    await prepararPeriodo(p2026, ["PP1", "PP2"]);
    for (const e of estudiantes.filter((x) => x.semestre === 2)) await practicaHistorica(e, "PP1", p2026);
    for (const e of estudiantes.filter((x) => x.semestre === 3)) await practicaHistorica(e, "PP2", p2026);
  });

  // 6) Periodo actual: cada estudiante en el estado que le tocó
  log("Creando el periodo actual…");
  await prepararPeriodo(pActual, NIVELES);
  // Los 9 practicantes en curso: 6 con la misma asesora (para mostrar la alerta de sobrecarga) y 3 repartidos.
  const sedesEnCurso = azar.mezclar(["normal", "normal", "normal", "normal", "normal", "normal", "salesiano", "bethlemitas", "americano"]);
  const sedesCerradas = azar.mezclar(["pedro_claver", "americano"]);
  let cambioDePlazaHecho = false;
  const resumenEstados = {};

  for (const e of estudiantes) {
    const estado = e.estado;
    resumenEstados[estado] = (resumenEstados[estado] ?? 0) + 1;
    if (estado === "SIN_SOLICITUD") continue;
    const sede = estado === "PIDE_PLAZA_SIN_ASESOR" ? "damaso"
      : ["ACTIVA_SIN_AVANCE", "ACTIVA_EN_BORRADOR", "BITACORA_ENVIADA", "EVALUACION_PARCIAL", "EVALUACION_EN_BORRADOR", "LISTA_PARA_CERRAR"].includes(estado) ? sedesEnCurso.pop()
      : estado === "FINALIZADA" ? sedesCerradas.pop()
      : azar.elegir(CLAVES_CON_ASESOR);

    const id = await solicitar(e, e.nivel);
    e.asignacionId = id;
    if (estado === "BORRADOR") {
      if (azar.siguiente() < 0.7) await elegirPlaza(e, id, sede);
      await subirDocumentos(e, id, e.nivel, sede, azar.entero(0, 3));
    } else {
      // Dirección cambia la plaza en un caso para mostrar el motivo del cambio.
      const cambiaPlaza = !cambioDePlazaHecho && estado === "ACTIVA_SIN_AVANCE" && sede !== "pedro_claver";
      await elegirPlaza(e, id, cambiaPlaza ? "pedro_claver" : sede);
      if (cambiaPlaza) cambioDePlazaHecho = true;
      e.cambiaPlaza = cambiaPlaza;
      await subirDocumentos(e, id, e.nivel, sede);
      await enviarSolicitud(e, id);
      e.sede = sede;
    }

    const docs = estado === "BORRADOR" ? [] : await idsDocumentos(id);
    switch (estado) {
      case "POR_REVISAR":
        // Algunos documentos ya revisados, el resto pendiente.
        for (const d of docs.slice(0, azar.entero(0, 2))) await documents.revisar(d, { decision: "APROBAR" }, ctxDir);
        break;
      case "DEVUELTA":
        await documents.revisar(azar.elegir(docs), { decision: "RECHAZAR", observacion: azar.elegir(MOTIVOS_DEVOLUCION_DOCUMENTO) }, ctxDir);
        break;
      case "RECHAZADA":
        await assignments.rechazarSolicitud(id, { motivo: "La institución solicitada no tiene cupo para practicantes en este periodo." }, ctxDir);
        break;
      case "LISTA_PARA_ASIGNAR":
      case "PIDE_PLAZA_SIN_ASESOR":
        await aprobarTodo(id);
        break;
      case "ACTIVA_SIN_AVANCE": case "ACTIVA_EN_BORRADOR": case "BITACORA_ENVIADA": case "EVALUACION_PARCIAL":
      case "EVALUACION_EN_BORRADOR": case "LISTA_PARA_CERRAR": case "FINALIZADA": {
        await aprobarTodo(id);
        await confirmar(id, {
          institucion_id: inst[sede].id, asesor_sitio_id: asesores[sede][0].id,
          ...(e.cambiaPlaza ? { motivo_cambio_plaza: "La institución solicitada completó su cupo de practicantes; se reubicó en una plaza cercana." } : {}),
        });
        if (estado === "ACTIVA_SIN_AVANCE") break;
        if (estado === "ACTIVA_EN_BORRADOR") { await trabajarBitacora(e, id, "BORRADOR"); break; }
        await trabajarBitacora(e, id, "ENVIAR");
        if (estado === "EVALUACION_PARCIAL") await evaluar(id, pActual, e.nivel, "DOCENTE", { publicar: true });
        if (estado === "EVALUACION_EN_BORRADOR") await evaluar(id, pActual, e.nivel, "DOCENTE", { publicar: false });
        if (estado === "LISTA_PARA_CERRAR" || estado === "FINALIZADA") {
          await evaluar(id, pActual, e.nivel, "DOCENTE", { publicar: true });
          await evaluar(id, pActual, e.nivel, "ASESOR", { publicar: true });
        }
        if (estado === "FINALIZADA") await evaluations.finalizarPractica(id, ctxDir);
        break;
      }
      default:
        break; // BORRADOR: ya está lista
    }

    const [min, max] = ANTIGUEDAD_DIAS[estado] ?? [1, 3];
    const maximoPosible = Math.max(0, diasEntre(pActual.fecha_inicio, hoy));
    const dias = Math.min(azar.entero(min, max), maximoPosible);
    await retroceder(id, dias, { inicio: iso(sumarDias(hoy, -dias)), fin: pActual.fecha_fin });
  }

  const cuentas = {
    contrasena: CONTRASENA_DEMO,
    docentes: [docentes.PP1, docentes.PP2, docentes.PP3].map((d) => ({ nombre: d.nombre, correo: d.correo, nota: d.existente ? "cuenta existente (conserva su contraseña)" : undefined })),
    asesores: todosAsesores.map((a) => ({ nombre: a.nombre, correo: a.correo })),
    estudiantes: estudiantes.map((e) => ({ nombre: e.nombre, correo: e.correo, semestre: e.semestre, estado: e.estado })),
  };
  return { cuentas, resumenEstados, instituciones: Object.keys(inst).length, periodoActual: pActual.codigo };
}

// ───────────────────────────── Limpiar ─────────────────────────────

/** Elimina todo lo que creó `sembrarDemo` (y solo eso). Devuelve cuántas cosas quitó. */
export async function limpiarDemo({ log = () => {} } = {}) {
  const patron = `%@${DOMINIO_DEMO}`;
  const { rows: usuariosDemo } = await pool.query("SELECT id, firebase_uid FROM usuarios WHERE correo_institucional ILIKE $1", [patron]);
  const { rows: periodosDemo } = await pool.query("SELECT id FROM periodos_academicos WHERE nombre ILIKE $1 AND estado <> 'ACTIVO'", [`%${MARCA_PERIODO}%`]);
  const usuarioIds = usuariosDemo.map((u) => u.id);
  const periodoIds = periodosDemo.map((p) => p.id);

  const cliente = await pool.connect();
  const rutasAEliminar = [];
  const tablas = [
    "respuestas_opciones", "respuestas_bitacora", "evidencias_bitacora", "evaluaciones_historial", "evaluaciones", "bitacoras",
    "documentos_legales_estudiantes", "asignaciones_practica", "matriculas_estudiantes", "vinculaciones_asesores", "docentes_niveles",
    "guias_criterios", "opciones_pregunta", "preguntas", "cuestionarios", "archivos", "usuarios_roles", "usuarios", "instituciones", "periodos_academicos",
  ];
  const quitados = {};
  try {
    await cliente.query("BEGIN");
    for (const t of tablas) await cliente.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);

    await cliente.query("CREATE TEMP TABLE d_asig (id uuid) ON COMMIT DROP");
    await cliente.query("INSERT INTO d_asig SELECT a.id FROM asignaciones_practica a JOIN matriculas_estudiantes m ON m.id = a.matricula_estudiante_id WHERE m.estudiante_id = ANY($1::uuid[])", [usuarioIds]);
    await cliente.query("CREATE TEMP TABLE d_bit ON COMMIT DROP AS SELECT id FROM bitacoras WHERE asignacion_practica_id IN (SELECT id FROM d_asig)");
    await cliente.query("CREATE TEMP TABLE d_eva ON COMMIT DROP AS SELECT id FROM evaluaciones WHERE asignacion_practica_id IN (SELECT id FROM d_asig)");
    await cliente.query("CREATE TEMP TABLE d_arch (id uuid) ON COMMIT DROP");
    await cliente.query(
      `INSERT INTO d_arch
         SELECT archivo_id AS id FROM documentos_legales_estudiantes WHERE asignacion_practica_id IN (SELECT id FROM d_asig)
         UNION SELECT archivo_id FROM evidencias_bitacora WHERE bitacora_id IN (SELECT id FROM d_bit)
         UNION SELECT g.archivo_id FROM guias_criterios g JOIN archivos a ON a.id = g.archivo_id WHERE a.nombre_original LIKE $1 OR g.periodo_academico_id = ANY($2::uuid[])`,
      [`${PREFIJO_ARCHIVO_DEMO}%`, periodoIds]);
    rutasAEliminar.push(...(await cliente.query("SELECT ruta_almacenamiento AS ruta FROM archivos WHERE id IN (SELECT id FROM d_arch)")).rows.map((r) => r.ruta));

    /** Ejecuta un DELETE y suma las filas eliminadas al conteo de esa tabla. */
    const borrar = async (nombre, sql, params = []) => { const r = await cliente.query(sql, params); quitados[nombre] = (quitados[nombre] ?? 0) + r.rowCount; };
    await borrar("respuestas_opciones", "DELETE FROM respuestas_opciones WHERE respuesta_bitacora_id IN (SELECT id FROM respuestas_bitacora WHERE bitacora_id IN (SELECT id FROM d_bit))");
    await borrar("respuestas", "DELETE FROM respuestas_bitacora WHERE bitacora_id IN (SELECT id FROM d_bit)");
    await borrar("evidencias", "DELETE FROM evidencias_bitacora WHERE bitacora_id IN (SELECT id FROM d_bit)");
    await borrar("historial_evaluaciones", "DELETE FROM evaluaciones_historial WHERE evaluacion_id IN (SELECT id FROM d_eva)");
    await borrar("evaluaciones", "DELETE FROM evaluaciones WHERE id IN (SELECT id FROM d_eva)");
    await borrar("bitacoras", "DELETE FROM bitacoras WHERE id IN (SELECT id FROM d_bit)");
    await borrar("documentos", "DELETE FROM documentos_legales_estudiantes WHERE asignacion_practica_id IN (SELECT id FROM d_asig)");
    await borrar("asignaciones", "DELETE FROM asignaciones_practica WHERE id IN (SELECT id FROM d_asig)");
    await borrar("matriculas", "DELETE FROM matriculas_estudiantes WHERE estudiante_id = ANY($1::uuid[]) OR periodo_academico_id = ANY($2::uuid[])", [usuarioIds, periodoIds]);
    await borrar("vinculaciones", "DELETE FROM vinculaciones_asesores WHERE asesor_id = ANY($1::uuid[]) OR periodo_academico_id = ANY($2::uuid[]) OR institucion_id IN (SELECT id FROM instituciones WHERE correo ILIKE $3)", [usuarioIds, periodoIds, patron]);
    await borrar("docentes_niveles", "DELETE FROM docentes_niveles WHERE docente_id = ANY($1::uuid[]) OR periodo_academico_id = ANY($2::uuid[])", [usuarioIds, periodoIds]);
    await borrar("guias", "DELETE FROM guias_criterios WHERE archivo_id IN (SELECT id FROM d_arch) OR periodo_academico_id = ANY($1::uuid[])", [periodoIds]);
    await borrar("opciones", "DELETE FROM opciones_pregunta WHERE pregunta_id IN (SELECT p.id FROM preguntas p JOIN cuestionarios c ON c.id = p.cuestionario_id WHERE c.titulo ILIKE $1)", [`%${MARCA_CUESTIONARIO}%`]);
    await borrar("preguntas", "DELETE FROM preguntas WHERE cuestionario_id IN (SELECT id FROM cuestionarios WHERE titulo ILIKE $1)", [`%${MARCA_CUESTIONARIO}%`]);
    await borrar("cuestionarios", "DELETE FROM cuestionarios WHERE titulo ILIKE $1", [`%${MARCA_CUESTIONARIO}%`]);
    await borrar("archivos", "DELETE FROM archivos WHERE id IN (SELECT id FROM d_arch) OR subido_por_id = ANY($1::uuid[])", [usuarioIds]);
    await borrar("roles_de_usuario", "DELETE FROM usuarios_roles WHERE usuario_id = ANY($1::uuid[])", [usuarioIds]);
    await borrar("usuarios", "DELETE FROM usuarios WHERE id = ANY($1::uuid[])", [usuarioIds]);
    await borrar("instituciones", "DELETE FROM instituciones WHERE correo ILIKE $1", [patron]);
    await borrar("periodos", "DELETE FROM periodos_academicos WHERE id = ANY($1::uuid[])", [periodoIds]);

    for (const t of tablas) await cliente.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    await cliente.query("COMMIT");
  } catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
  } finally {
    cliente.release();
  }

  // Fuera de PostgreSQL (mejor esfuerzo: si algo falla solo se avisa).
  const avisos = [];
  for (const ruta of rutasAEliminar) {
    try { await storage.eliminarArchivo(ruta); } catch (error) { avisos.push(`archivo ${ruta}: ${error.message}`); }
  }
  for (const u of usuariosDemo) {
    if (!u.firebase_uid) continue;
    try { await firebaseAuth.eliminarUsuario(u.firebase_uid); } catch (error) { avisos.push(`cuenta ${u.firebase_uid}: ${error.message}`); }
  }
  log(`Eliminado: ${usuariosDemo.length} usuarios, ${rutasAEliminar.length} archivos de almacenamiento.`);
  return { quitados, archivos: rutasAEliminar.length, cuentasFirebase: usuariosDemo.length, avisos };
}

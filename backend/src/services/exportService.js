/**
 * Servicio de exportación de la bitácora a PDF.
 * Genera el documento con los datos de la práctica, reflexión, respuestas, evidencias (imágenes incrustadas)
 * y solo las evaluaciones publicadas que el rol puede ver. Deja registro en la auditoría.
 */
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { descargarArchivo } from "../adapters/storageAdapter.js";
import { logger } from "../config/logger.js";
import * as evaluationRepository from "../repositories/evaluationRepository.js";
import * as logbookRepository from "../repositories/logbookRepository.js";
import { ROLES } from "../utils/constants.js";
import { DocumentoPdf, prepararImagen } from "../utils/pdf.js";
import * as logbookService from "./logbookService.js";

// Zona horaria usada para mostrar fechas en el PDF.
const ZONA_HORARIA = "America/Bogota";
/** Tope de bytes de imágenes incrustadas por PDF: evita documentos enormes y respuestas lentas. */
const MAXIMO_BYTES_IMAGENES = 30 * 1024 * 1024;
// Textos legibles para tipos de evaluación y estados de la bitácora.
const NOMBRE_TIPO = { DOCENTE_SUPERVISOR: "Docente supervisor (nota académica)", ASESOR_SITIO: "Asesor de sitio (nota de sitio)" };
const NOMBRE_ESTADO_BITACORA = {
  BLOQUEADA: "Bloqueada", BORRADOR: "Borrador (aún no enviada)", DEVUELTA: "Devuelta para corrección",
  ENVIADA: "Enviada", EN_EVALUACION: "En evaluación", EVALUADA: "Evaluada",
};
// Evaluación que corresponde a cada rol evaluador.
const TIPO_POR_ROL = { [ROLES.DOCENTE_SUPERVISOR]: "DOCENTE_SUPERVISOR", [ROLES.ASESOR_SITIO]: "ASESOR_SITIO" };

// Fecha larga en español (Colombia).
const formatoFecha = (valor) =>
  valor
    ? new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeStyle: "short", timeZone: ZONA_HORARIA }).format(new Date(valor))
    : null;

// Tamaño de archivo en KB o MB.
const tamanoLegible = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(Math.round(bytes / 1024), 1)} KB`);

/** Texto seguro para nombre de archivo: sin acentos, sin símbolos. */
const paraArchivo = (texto) =>
  String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

/**
 * Evaluaciones PUBLICADAS que el rol puede ver (mismas reglas que /evaluations): Dirección y el estudiante ven las dos;
 * docente y asesor solo la de su propio tipo, para conservar la independencia entre evaluadores. Nunca se incluyen
 * borradores ni evaluaciones pendientes.
 */
async function evaluacionesVisibles(asignacionId, auth) {
  const tipoPropio = TIPO_POR_ROL[auth.rolActivo];
  const vigentes = (await evaluationRepository.listarDeAsignacion(asignacionId)).filter(
    (e) => e.estado === "PUBLICADA" && (!tipoPropio || e.tipo_evaluador === tipoPropio)
  );
  return Promise.all(vigentes.map((e) => evaluationRepository.buscarPorId(e.id)));
}

// Texto de la respuesta: texto libre o etiquetas de las opciones elegidas, separadas por punto y coma.
function respuestaDe(pregunta, respuestas) {
  const dada = respuestas.find((r) => r.pregunta_id === pregunta.id);
  if (!dada) return null;
  if (!pregunta.tipo.startsWith("CERRADA")) return dada.texto?.trim() || null;
  const elegidas = pregunta.opciones.filter((o) => (dada.opciones_ids ?? []).includes(o.id)).map((o) => o.etiqueta);
  return elegidas.length ? elegidas.join("; ") : null;
}

/** Arma el PDF de la bitácora con lo que el rol puede ver. Devuelve { contenido: Buffer, nombre_archivo }. */
export async function exportarBitacora(id, auth, contexto) {
  const vista = await logbookService.obtener(id, auth); // valida alcance y visibilidad (404 si no corresponde)
  const evaluaciones = await evaluacionesVisibles(vista.asignacion.id, auth);
  const a = vista.asignacion;

    // El PDF se construye secuencialmente: portada, datos, reflexión, preguntas, evidencias y evaluaciones.
  const doc = new DocumentoPdf({
    titulo: `Bitácora de práctica · ${a.estudiante.nombre_completo}`,
    autor: "Sistema de Gestión de Prácticas Pedagógicas UDI",
    pie: "Licenciatura en Educación Infantil · UDI",
  });
  doc.titulo("Bitácora de práctica pedagógica");
  doc.parrafo("Licenciatura en Educación Infantil · Universidad de Investigación y Desarrollo (UDI)", { color: "0.35 0.35 0.35" });

  doc.seccion("Datos de la práctica");
  doc.campo("Estudiante", a.estudiante.nombre_completo);
  doc.campo("Documento", a.estudiante.documento);
  doc.campo("Periodo académico", a.periodo.codigo);
  doc.campo("Nivel de práctica", a.nivel.nombre);
  doc.campo("Institución", a.institucion.nombre);
  doc.campo("Docente supervisor", a.docente?.nombre_completo ?? "Sin asignar");
  doc.campo("Asesor de sitio", a.asesor?.nombre_completo ?? "Sin asignar");
  doc.campo("Estado de la bitácora", NOMBRE_ESTADO_BITACORA[vista.estado] ?? vista.estado);
  doc.campo("Fecha de envío", formatoFecha(vista.enviada_en) ?? "Aún no enviada");
  if (vista.contenido.origen === "BORRADOR") {
    doc.espacio(4).parrafo("Este documento corresponde a un borrador: el contenido puede cambiar antes del envío definitivo.", { negrita: true, color: "0.6 0.3 0" });
  }

  doc.seccion("Reflexión");
  doc.parrafo(vista.contenido.reflexion?.trim() || "Sin reflexión registrada.");

  const preguntas = vista.cuestionario?.preguntas ?? [];
  if (preguntas.length) {
    doc.seccion("Preguntas y respuestas");
    preguntas.forEach((p, i) => {
      doc.parrafo(`${i + 1}. ${p.enunciado}${p.obligatoria ? "" : " (opcional)"}`, { negrita: true });
      doc.parrafo(respuestaDe(p, vista.contenido.respuestas) ?? "Sin respuesta.", { sangria: 14 });
    });
  }

  doc.seccion("Evidencias");
  if (vista.evidencias.length) {
    let bytesIncrustados = 0;
    let hayPendientes = false;
    for (const [i, e] of vista.evidencias.entries()) {
      // La imagen es un complemento: si no se puede leer o incrustar, el PDF se genera igual y lo avisa.
      let imagen = null;
      if (e.es_imagen && bytesIncrustados + e.tamano_bytes <= MAXIMO_BYTES_IMAGENES) {
        try {
          const fila = await logbookRepository.buscarEvidencia(e.id, vista.id);
          const contenido = fila ? await descargarArchivo(fila.ruta) : null;
          imagen = contenido ? prepararImagen(contenido) : null;
          if (imagen) bytesIncrustados += contenido.length;
        } catch (error) {
          logger.warn({ err: error, evidencia_id: e.id }, "No se pudo incrustar una imagen en el PDF de la bitácora");
        }
      }
      if (imagen) doc.reservar(50 + doc.tamanoDeImagen(imagen).alto); // rótulo e imagen en la misma página
      doc.parrafo(`${i + 1}. ${e.nombre} (${e.es_imagen ? "imagen" : "PDF"}, ${tamanoLegible(e.tamano_bytes)})`, { negrita: true });
      doc.parrafo(e.descripcion?.trim() || "Sin descripción.", { sangria: 14 });
      if (imagen) { doc.imagen(imagen); continue; }
      hayPendientes = true;
      if (e.es_imagen) doc.parrafo("No se pudo incluir la imagen en este PDF: consúltala en la plataforma.", { tamano: 9, sangria: 14, color: "0.35 0.35 0.35" });
    }
    if (hayPendientes) {
      doc.parrafo("Los archivos PDF adjuntos (y las imágenes que no pudieron incluirse) no van dentro de este PDF: se consultan en la plataforma.", { tamano: 9, color: "0.35 0.35 0.35" });
    }
  } else {
    doc.parrafo("Sin evidencias adjuntas.");
  }

  doc.seccion("Evaluaciones publicadas");
  if (evaluaciones.length) {
    for (const e of evaluaciones) {
      doc.parrafo(NOMBRE_TIPO[e.tipo_evaluador], { negrita: true });
      doc.campo("Evaluador", `${e.evaluador_nombres} ${e.evaluador_apellidos}`);
      doc.campo("Nota", Number(e.nota).toFixed(2));
      doc.campo("Publicada", formatoFecha(e.publicada_en));
      doc.campo("Retroalimentación", e.retroalimentacion?.trim() || "Sin retroalimentación.");
      doc.espacio(6);
    }
    doc.parrafo("Cada nota es independiente: no se calcula promedio entre ellas.", { tamano: 9, color: "0.35 0.35 0.35" });
  } else {
    doc.parrafo("Aún no hay evaluaciones publicadas.");
  }

  doc.espacio(10).parrafo(`Generado el ${formatoFecha(new Date())} (hora de Colombia).`, { tamano: 9, color: "0.35 0.35 0.35" });

  await registrarAuditoria({
    contexto,
    accion: "BITACORA_EXPORTADA",
    entidad: "bitacoras",
    entidad_id: vista.id,
    valor_nuevo: { formato: "pdf", estado_bitacora: vista.estado, evaluaciones_incluidas: evaluaciones.length },
  });

    // Nombre del archivo: bitacora-<periodo>-<estudiante>.pdf
  const nombre = ["bitacora", paraArchivo(a.periodo.codigo), paraArchivo(a.estudiante.nombre_completo)].filter(Boolean).join("-");
  return { contenido: doc.generar(), nombre_archivo: `${nombre}.pdf` };
}

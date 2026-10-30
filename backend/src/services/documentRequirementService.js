/**
 * Configuración de documentos legales (Director): catálogo de tipos y qué se pide en cada nivel de práctica.
 * Un documento obligatorio nuevo (o que pasa de opcional a obligatorio) se exige a los estudiantes que aún no tienen su
 * expediente aprobado; las prácticas en curso quedan exentas salvo que el Director pida aplicarlo también a ellas.
 * Se avisa cuántos son y se exige confirmación. Quitar o hacer opcional un requisito no pide confirmación.
 */
import { withTransaction } from "../database/transaction.js";
import * as repo from "../repositories/documentRequirementRepository.js";
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { ApiError } from "../utils/apiError.js";

const MB = 1024 * 1024;

/** Código estable a partir del nombre: mayúsculas, sin tildes, con guiones bajos. */
const aCodigo = (nombre) =>
  nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "DOCUMENTO";

/** Catálogo de tipos y, por nivel, qué se pide (obligatorio u opcional). */
export async function listar() {
  const [tipos, filas] = await Promise.all([repo.listarTipos(), repo.listarRequisitosPorNivel()]);
  const niveles = new Map();
  for (const f of filas) {
    if (!niveles.has(f.nivel_id)) niveles.set(f.nivel_id, { id: f.nivel_id, nombre: f.nivel_nombre, requisitos: [] });
    if (f.tipo_id) niveles.get(f.nivel_id).requisitos.push({ tipo_id: f.tipo_id, obligatorio: f.obligatorio, orden: f.orden });
  }
  return { tipos: tipos.map((t) => ({ ...t, tamano_maximo_mb: Math.round(t.tamano_maximo_bytes / MB) })), niveles: [...niveles.values()] };
}

/** Crea un tipo de documento (solo PDF). */
export async function crearTipo({ nombre, descripcion, tamano_maximo_mb = 10 }, contexto) {
  if (await repo.existeNombre(nombre)) throw ApiError.conflicto(`Ya existe un documento llamado «${nombre}».`, "DOCUMENT_TYPE_EXISTS");
  let codigo = aCodigo(nombre);
  for (let i = 2; await repo.existeCodigo(codigo); i += 1) codigo = `${aCodigo(nombre).slice(0, 36)}_${i}`;
  const { id } = await repo.crearTipo({ codigo, nombre, descripcion, tamanoMaximoBytes: tamano_maximo_mb * MB });
  await registrarAuditoria({ contexto, accion: "TIPO_DOCUMENTO_CREADO", entidad: "tipos_documento_legal", entidad_id: id, valor_nuevo: { codigo, nombre } });
  return (await listar()).tipos.find((t) => t.id === id);
}

/** Cambia nombre, descripción, tamaño máximo o desactiva/reactiva el tipo. */
export async function actualizarTipo(id, cambios, contexto) {
  const tipo = await repo.buscarTipo(id);
  if (!tipo) throw ApiError.noEncontrado("El tipo de documento no existe.", "DOCUMENT_TYPE_NOT_FOUND");
  if (cambios.nombre && (await repo.existeNombre(cambios.nombre, id))) {
    throw ApiError.conflicto(`Ya existe un documento llamado «${cambios.nombre}».`, "DOCUMENT_TYPE_EXISTS");
  }
  await repo.actualizarTipo(id, {
    nombre: cambios.nombre, descripcion: cambios.descripcion, activo: cambios.activo,
    tamanoMaximoBytes: cambios.tamano_maximo_mb ? cambios.tamano_maximo_mb * MB : undefined,
  });
  await registrarAuditoria({
    contexto, accion: cambios.activo === false ? "TIPO_DOCUMENTO_DESACTIVADO" : "TIPO_DOCUMENTO_ACTUALIZADO",
    entidad: "tipos_documento_legal", entidad_id: id, valor_anterior: { nombre: tipo.nombre, activo: tipo.activo }, valor_nuevo: cambios,
  });
  return (await listar()).tipos.find((t) => t.id === id);
}

/**
 * Define en qué niveles se pide un tipo. `niveles` lista TODOS los niveles donde aplica (con obligatorio true/false);
 * los niveles que no aparezcan dejan de pedirlo. Un obligatorio nuevo se exige a quienes aún no tienen el expediente aprobado;
 * las prácticas en curso quedan exentas salvo que `aplicar_en_curso` sea true. Pide confirmación si hay estudiantes afectados.
 */
export async function definirNiveles(tipoId, { niveles, confirmar = false, aplicar_en_curso: aplicarEnCurso = false }, contexto) {
  const tipo = await repo.buscarTipo(tipoId);
  if (!tipo) throw ApiError.noEncontrado("El tipo de documento no existe.", "DOCUMENT_TYPE_NOT_FOUND");
  const validos = new Set((await repo.nivelesActivos()).map((n) => n.id));
  const repetidos = new Set();
  for (const n of niveles) {
    if (!validos.has(n.nivel_id)) throw ApiError.reglaDeNegocio("Uno de los niveles no existe o está inactivo.", "LEVEL_NOT_FOUND");
    if (repetidos.has(n.nivel_id)) throw ApiError.reglaDeNegocio("Un nivel aparece repetido.", "LEVEL_DUPLICATED");
    repetidos.add(n.nivel_id);
  }
  const actuales = new Map((await repo.requisitosDeTipo(tipoId)).map((r) => [r.nivel_id, r.obligatorio]));
  const quedan = new Map(niveles.map((n) => [n.nivel_id, n.obligatorio]));
  // Niveles donde el documento pasa a ser obligatorio (nuevo u opcional que se endurece).
  const endurecidos = [...quedan].filter(([nivelId, obligatorio]) => obligatorio && actuales.get(nivelId) !== true).map(([nivelId]) => nivelId);
  // Regla: el documento nuevo se exige a quienes aún no tienen el expediente aprobado; las prácticas en curso quedan
  // exentas, salvo que el Director pida expresamente aplicarlo también a ellas.
  const conteo = tipo.activo ? await repo.contarAfectados(endurecidos) : { pendientes: 0, en_curso: 0 };
  // Si el documento ya era obligatorio y quedaron prácticas exentas, "aplicar a las en curso" también las alcanza.
  const reaplicar = [];
  let exentasPrevias = 0;
  if (aplicarEnCurso && tipo.activo) {
    for (const e of await repo.exencionesVigentes(tipoId)) {
      if (quedan.get(e.nivel_id) === true && !endurecidos.includes(e.nivel_id)) { reaplicar.push(e.nivel_id); exentasPrevias += e.total; }
    }
  }
  const pendientes = conteo.pendientes;
  const enCurso = conteo.en_curso + exentasPrevias;
  const afectados = pendientes + (aplicarEnCurso ? enCurso : 0);
  if (afectados > 0 && !confirmar) {
    const extra = aplicarEnCurso && enCurso > 0
      ? ` Además, ${enCurso} práctica(s) en curso deberán cargarlo y su bitácora quedará bloqueada hasta que se apruebe.`
      : "";
    const cuerpo = pendientes > 0
      ? `${pendientes} estudiante(s) que aún no tienen su expediente aprobado deberán cargar «${tipo.nombre}».`
      : `${enCurso} práctica(s) en curso deberán cargar «${tipo.nombre}».`;
    throw ApiError.conflicto(
      `${cuerpo}${pendientes > 0 ? extra : " Su bitácora quedará bloqueada hasta que se apruebe."} Confirma para continuar.`,
      "CONFIRMATION_REQUIRED",
      [{ estudiantes_afectados: afectados, sin_expediente_aprobado: pendientes, en_curso: enCurso, aplicar_en_curso: aplicarEnCurso }]
    );
  }
  await withTransaction(async (client) => {
    for (const [nivelId, obligatorio] of quedan) await repo.fijarRequisito({ nivelId, tipoId, obligatorio }, client);
    for (const nivelId of actuales.keys()) if (!quedan.has(nivelId)) await repo.quitarRequisito({ nivelId, tipoId }, client);
    if (aplicarEnCurso) await repo.quitarExenciones({ tipoId, nivelIds: [...endurecidos, ...reaplicar] }, client);
    else await repo.exentarEnCurso({ tipoId, nivelIds: endurecidos }, client);
  });
  const exentas = aplicarEnCurso ? 0 : enCurso;
  await registrarAuditoria({
    contexto, accion: "REQUISITOS_DOCUMENTALES_CAMBIADOS", entidad: "tipos_documento_legal", entidad_id: tipoId,
    valor_anterior: { niveles: Object.fromEntries(actuales) },
    valor_nuevo: { niveles: Object.fromEntries(quedan), estudiantes_afectados: afectados, practicas_en_curso_exentas: exentas, aplicado_en_curso: aplicarEnCurso },
  });
  return { ...(await listar()), estudiantes_afectados: afectados, practicas_en_curso_exentas: exentas };
}

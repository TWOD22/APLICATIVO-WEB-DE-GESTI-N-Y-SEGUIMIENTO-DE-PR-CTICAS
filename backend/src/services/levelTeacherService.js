/**
 * Servicio de docentes por nivel de práctica (lo configura el Director).
 * Reglas: un docente por nivel y periodo, un docente puede tener varios niveles, el docente debe estar activo
 * y no se configura un periodo cerrado. Cambiar el docente de un nivel no altera las prácticas ya asignadas.
 */
import { withTransaction } from "../database/transaction.js";
import * as levelTeacherRepository from "../repositories/levelTeacherRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { ApiError } from "../utils/apiError.js";

// Periodo pedido o, si no se indica, el activo.
async function resolverPeriodo(periodoId) {
  const periodo = periodoId ? await periodRepository.buscarPorId(periodoId) : await periodRepository.buscarActivo();
  if (!periodo) {
    throw ApiError.noEncontrado(periodoId ? "El periodo no existe." : "No hay un periodo activo.", "PERIOD_NOT_FOUND");
  }
  return periodo;
}

// Da forma a cada fila: el docente va como objeto (o null si el nivel no tiene).
const aNivel = (f) => ({
  nivel: { id: f.nivel_id, codigo: f.nivel_codigo, nombre: f.nivel_nombre, orden: f.orden, programa_id: f.programa_id },
  docente: f.docente_id
    ? { id: f.docente_id, nombres: f.docente_nombres, apellidos: f.docente_apellidos, correo: f.docente_correo }
    : null,
  estudiantes: f.estudiantes,
});

/** Lista los niveles con su docente en el periodo (por defecto el activo). */
export async function listar({ periodo_id, programa_id } = {}) {
  const periodo = await resolverPeriodo(periodo_id);
  const filas = await levelTeacherRepository.listarPorPeriodo({ periodoId: periodo.id, programaId: programa_id ?? null });
  return { periodo: { id: periodo.id, codigo: periodo.codigo, nombre: periodo.nombre, estado: periodo.estado }, niveles: filas.map(aNivel) };
}

/**
 * Define (o quita, con docente_id null) el docente de un nivel en un periodo.
 * Es idempotente: si ya es ese docente no cambia nada.
 */
export async function definir(nivelId, { docente_id, periodo_id }, contexto) {
  const nivel = await levelTeacherRepository.buscarNivel(nivelId);
  if (!nivel) throw ApiError.noEncontrado("El nivel de práctica no existe.", "LEVEL_NOT_FOUND");
  const periodo = await resolverPeriodo(periodo_id);
  if (periodo.estado === "CERRADO") {
    throw ApiError.reglaDeNegocio("El periodo está cerrado: no se puede cambiar el docente del nivel.", "PERIOD_CLOSED");
  }

  const docenteId = docente_id ?? null;
  if (docenteId && !(await levelTeacherRepository.esDocenteActivo(docenteId))) {
    throw ApiError.reglaDeNegocio("El usuario no es un docente supervisor activo.", "TEACHER_INVALID");
  }

  const actual = await levelTeacherRepository.buscarVigente(nivel.id, periodo.id);
  const anteriorId = actual?.docente_id ?? null;
  if (anteriorId !== docenteId) {
    // Quitar y asignar van juntos: el índice único impide dos docentes vigentes en el mismo nivel y periodo.
    await withTransaction(async (client) => {
      await levelTeacherRepository.quitar(nivel.id, periodo.id, client);
      if (docenteId) {
        await levelTeacherRepository.asignar(
          { nivelId: nivel.id, periodoId: periodo.id, docenteId, asignadoPorId: contexto.actor.usuario_id },
          client
        );
      }
    });
    await registrarAuditoria({
      contexto,
      accion: docenteId ? "DOCENTE_NIVEL_DEFINIDO" : "DOCENTE_NIVEL_QUITADO",
      entidad: "docentes_niveles",
      entidad_id: nivel.id,
      valor_anterior: { docente_id: anteriorId, periodo_id: periodo.id },
      valor_nuevo: { docente_id: docenteId, periodo_id: periodo.id },
    });
  }

  const { niveles } = await listar({ periodo_id: periodo.id, programa_id: nivel.programa_id });
  return niveles.find((n) => n.nivel.id === nivel.id);
}

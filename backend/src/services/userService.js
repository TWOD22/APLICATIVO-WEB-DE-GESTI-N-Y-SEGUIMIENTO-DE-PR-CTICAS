/**
 * Servicio de usuarios.
 * Coordina PostgreSQL (fuente de verdad: datos, roles, matrículas) con Firebase Auth (identidad y contraseña).
 * Al crear un usuario: primero la identidad en Firebase, luego la transacción en PostgreSQL; si esta falla, se elimina la identidad (compensación).
 */
import { withTransaction } from "../database/transaction.js";
import * as userRepository from "../repositories/userRepository.js";
import * as roleRepository from "../repositories/roleRepository.js";
import * as programRepository from "../repositories/programRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";
import * as enrollmentRepository from "../repositories/enrollmentRepository.js";
import * as institutionRepository from "../repositories/institutionRepository.js";
import * as firebaseAuth from "../adapters/firebaseAuthAdapter.js";
import { registrarAuditoria } from "../adapters/firestoreAdapter.js";
import { ApiError } from "../utils/apiError.js";
import { calcularCambios } from "../utils/diff.js";
import { logger } from "../config/logger.js";
import { ROLES } from "../utils/constants.js";

// Campos del usuario que el Director puede editar.
const CAMPOS_EDITABLES = ["documento", "nombres", "apellidos", "correo", "telefono"];

// Nombre completo a partir de nombres y apellidos.
const nombreCompleto = (usuario) => `${usuario.nombres} ${usuario.apellidos}`;

/** Quita datos internos (firebase_uid) y agrega el nombre completo. */
function presentar(usuario) {
  const { firebase_uid: _uid, ...publico } = usuario;
  return { ...publico, nombre_completo: nombreCompleto(usuario) };
}

/** Sincronización con Firebase que no debe revertir un cambio ya confirmado en PostgreSQL. */
async function sincronizar(accion, tarea) {
  try {
    await tarea();
    return true;
  } catch (error) {
    logger.warn({ err: error, accion }, "Sincronización con Firebase pendiente");
    return false;
  }
}

// Programa indicado, o el único programa existente; si hay varios y no se indica, se pide.
async function resolverPrograma(programaId) {
  if (programaId) {
    const programa = await programRepository.buscarPorId(programaId);
    if (!programa) throw ApiError.reglaDeNegocio("El programa académico indicado no existe.", "PROGRAM_NOT_FOUND");
    return programa;
  }
  const programas = await programRepository.listar();
  if (programas.length === 1) return programas[0];
  throw ApiError.reglaDeNegocio("Debes indicar el programa académico.", "PROGRAM_REQUIRED");
}

// Documento y correo no pueden repetirse entre usuarios.
async function validarDuplicados({ documento, correo, excluirId = null }) {
  const campos = await userRepository.buscarDuplicados({ documento, correo, excluirId });
  if (campos.length) {
    throw ApiError.conflicto(
      campos.length === 2
        ? "Ya existe un usuario con ese documento y ese correo."
        : campos[0] === "documento"
          ? "Ya existe un usuario con ese documento."
          : "Ya existe un usuario con ese correo.",
      "DUPLICATE_USER",
      campos.map((campo) => ({ campo, mensaje: "Valor ya registrado" }))
    );
  }
}

/** Lista usuarios con filtros (rol, semestre, estado, búsqueda) y paginación. */
export async function listar(filtros) {
  const { filas, total } = await userRepository.listar(filtros);
  return {
    filas: filas.map((fila) => ({ ...fila, nombre_completo: `${fila.nombres} ${fila.apellidos}` })),
    total,
  };
}

/** Detalle del usuario: roles, programas, matrícula actual y vinculaciones institucionales. */
export async function obtenerDetalle(id) {
  const usuario = await userRepository.buscarPorId(id);
  if (!usuario) throw ApiError.noEncontrado("El usuario no existe.", "USER_NOT_FOUND");
  const [roles, programas, matricula_actual, vinculaciones] = await Promise.all([
    roleRepository.listarRolesVigentes(id),
    enrollmentRepository.listarProgramasDeUsuario(id),
    enrollmentRepository.buscarMatriculaActual(id),
    institutionRepository.listarVinculacionesDeAsesor(id),
  ]);
  return {
    ...presentar(usuario),
    roles: roles.map(({ codigo, nombre }) => ({ codigo, nombre })),
    programas,
    matricula_actual,
    vinculaciones_institucionales: vinculaciones,
  };
}

/** Alta de usuario. Valida periodo, programa, semestre e institución según el rol; devuelve el enlace para que la persona defina su contraseña. */
export async function crear(datos, contexto) {
  const { rol } = datos;
  const periodo = await periodRepository.buscarActivo();
  if ((rol === ROLES.ESTUDIANTE || rol === ROLES.ASESOR_SITIO) && !periodo) {
    throw ApiError.reglaDeNegocio("No hay un periodo académico activo configurado.", "NO_ACTIVE_PERIOD");
  }

  let programa = null;
  if (rol === ROLES.ESTUDIANTE || datos.programa_id) programa = await resolverPrograma(datos.programa_id);
  if (rol === ROLES.ESTUDIANTE && datos.semestre > programa.cantidad_semestres) {
    throw ApiError.reglaDeNegocio(`El semestre debe estar entre 1 y ${programa.cantidad_semestres}.`, "INVALID_SEMESTER");
  }

  if (rol === ROLES.ASESOR_SITIO) {
    const institucion = await institutionRepository.buscarPorId(datos.institucion_id);
    if (!institucion) throw ApiError.reglaDeNegocio("La institución indicada no existe.", "INSTITUTION_NOT_FOUND");
    if (!institucion.activa) throw ApiError.reglaDeNegocio("La institución está inactiva.", "INSTITUTION_INACTIVE");
  }

  const rolDb = await roleRepository.buscarPorCodigo(rol);
  if (!rolDb) throw ApiError.reglaDeNegocio("El rol solicitado no está configurado en el sistema.", "ROLE_NOT_CONFIGURED");

  await validarDuplicados({ documento: datos.documento, correo: datos.correo });

  // 1) Preparación: identidad en Firebase (sin contraseña).
  const firebaseUid = await firebaseAuth.crearUsuario({
    correo: datos.correo,
    nombreCompleto: `${datos.nombres} ${datos.apellidos}`,
  });

  // 2) Transacción PostgreSQL. Si falla, se compensa eliminando la identidad creada.
  let creado;
  try {
    creado = await withTransaction(async (client) => {
      const usuario = await userRepository.crear(
        {
          firebaseUid,
          documento: datos.documento,
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          correo: datos.correo,
          telefono: datos.telefono ?? null,
        },
        client
      );
      await roleRepository.asignarRol(usuario.id, rolDb.id, client);
      if (programa) await enrollmentRepository.vincularUsuarioAPrograma(usuario.id, programa.id, client);
      if (rol === ROLES.ESTUDIANTE) {
        await enrollmentRepository.crearMatricula(
          { estudianteId: usuario.id, programaId: programa.id, periodoId: periodo.id, semestre: datos.semestre },
          client
        );
      }
      if (rol === ROLES.ASESOR_SITIO) {
        await institutionRepository.crearVinculacionAsesor(
          { asesorId: usuario.id, institucionId: datos.institucion_id, periodoId: periodo.id },
          client
        );
      }
      return usuario;
    });
  } catch (error) {
    await sincronizar("compensar_creacion_usuario", () => firebaseAuth.eliminarUsuario(firebaseUid));
    throw error;
  }

  // 3) Sincronización idempotente (mejor esfuerzo; PostgreSQL ya es la fuente de verdad).
  const advertencias = [];
  if (!(await sincronizar("claims_roles", () => firebaseAuth.establecerClaimsRoles(firebaseUid, [rol])))) {
    advertencias.push("No se pudo actualizar la caché de roles en Firebase.");
  }
  let enlace = null;
  try {
    enlace = await firebaseAuth.generarEnlaceDefinirContrasena(datos.correo);
  } catch (error) {
    logger.warn({ err: error }, "No se pudo generar el enlace para definir contraseña");
    advertencias.push("No se pudo generar el enlace para definir contraseña; usa la recuperación de contraseña.");
  }

  await registrarAuditoria({
    contexto,
    accion: "USUARIO_CREADO",
    entidad: "usuarios",
    entidad_id: creado.id,
    valor_nuevo: { rol, documento: creado.documento, correo: creado.correo },
  });

  const detalle = await obtenerDetalle(creado.id);
  return { ...detalle, enlace_definir_contrasena: enlace, ...(advertencias.length ? { advertencias } : {}) };
}

/** Edita datos del usuario (y los sincroniza con Firebase cuando corresponde). */
export async function actualizar(id, cambios, contexto) {
  const actual = await userRepository.buscarPorId(id);
  if (!actual) throw ApiError.noEncontrado("El usuario no existe.", "USER_NOT_FOUND");

  const diff = calcularCambios(actual, cambios, CAMPOS_EDITABLES);
  if (!diff.hayCambios) return obtenerDetalle(id);

  if (diff.nuevo.documento !== undefined || diff.nuevo.correo !== undefined) {
    await validarDuplicados({ documento: diff.nuevo.documento, correo: diff.nuevo.correo, excluirId: id });
  }

  // El correo es la credencial de acceso: se cambia primero en Firebase y se compensa si PostgreSQL falla.
  if (diff.nuevo.correo) await firebaseAuth.actualizarCorreo(actual.firebase_uid, diff.nuevo.correo);
  try {
    await withTransaction((client) => userRepository.actualizar(id, diff.nuevo, client));
  } catch (error) {
    if (diff.nuevo.correo) {
      await sincronizar("revertir_correo", () => firebaseAuth.actualizarCorreo(actual.firebase_uid, actual.correo));
    }
    throw error;
  }

  if (diff.nuevo.nombres !== undefined || diff.nuevo.apellidos !== undefined) {
    const nuevoNombre = nombreCompleto({
      nombres: diff.nuevo.nombres ?? actual.nombres,
      apellidos: diff.nuevo.apellidos ?? actual.apellidos,
    });
    await sincronizar("nombre_visible", () => firebaseAuth.actualizarNombre(actual.firebase_uid, nuevoNombre));
  }

  await registrarAuditoria({
    contexto,
    accion: "USUARIO_ACTUALIZADO",
    entidad: "usuarios",
    entidad_id: id,
    valor_anterior: diff.anterior,
    valor_nuevo: diff.nuevo,
  });
  return obtenerDetalle(id);
}

/** Activa, inactiva o suspende un usuario. No se puede cambiar el estado propio; si tiene prácticas en curso se pide confirmación. */
export async function cambiarEstado(id, { estado, confirmar = false }, contexto) {
  if (contexto.actor?.usuario_id === id) {
    throw ApiError.reglaDeNegocio("No puedes cambiar el estado de tu propia cuenta.", "CANNOT_CHANGE_OWN_STATUS");
  }
  const actual = await userRepository.buscarPorId(id);
  if (!actual) throw ApiError.noEncontrado("El usuario no existe.", "USER_NOT_FOUND");
  if (actual.estado === estado) return obtenerDetalle(id);

  if (estado !== "ACTIVO" && !confirmar) {
    const enCurso = await userRepository.contarAsignacionesEnCurso(id);
    if (enCurso > 0) {
      throw ApiError.conflicto(
        "El usuario participa en prácticas en curso. Confirma para continuar.",
        "CONFIRMATION_REQUIRED",
        [{ asignaciones_en_curso: enCurso }]
      );
    }
  }

  await withTransaction((client) => userRepository.cambiarEstado(id, estado, client));

  // La autorización real se decide en PostgreSQL en cada petición; Firebase es refuerzo.
  const deshabilitar = estado !== "ACTIVO";
  const sincronizado = await sincronizar("estado_usuario", async () => {
    await firebaseAuth.establecerDeshabilitado(actual.firebase_uid, deshabilitar);
    if (deshabilitar) await firebaseAuth.revocarSesiones(actual.firebase_uid);
  });

  await registrarAuditoria({
    contexto,
    accion: deshabilitar ? "USUARIO_DESHABILITADO" : "USUARIO_HABILITADO",
    entidad: "usuarios",
    entidad_id: id,
    valor_anterior: { estado: actual.estado },
    valor_nuevo: { estado },
  });

  const detalle = await obtenerDetalle(id);
  return sincronizado ? detalle : { ...detalle, advertencias: ["La sincronización con Firebase quedó pendiente."] };
}

/** Historial de prácticas de un usuario estudiante. */
export async function listarPracticas(id) {
  const usuario = await userRepository.buscarPorId(id);
  if (!usuario) throw ApiError.noEncontrado("El usuario no existe.", "USER_NOT_FOUND");
  return userRepository.listarHistorialPracticas(id);
}

/** "Mi cuenta": el propio usuario edita nombre y teléfono; el correo no es editable. */
export async function actualizarPerfilPropio(usuario, cambios, contexto) {
  const diff = calcularCambios(usuario, cambios, ["nombres", "apellidos", "telefono"]);
  if (diff.hayCambios) {
    await withTransaction((client) => userRepository.actualizar(usuario.id, diff.nuevo, client));
    if (diff.nuevo.nombres !== undefined || diff.nuevo.apellidos !== undefined) {
      const nuevoNombre = nombreCompleto({
        nombres: diff.nuevo.nombres ?? usuario.nombres,
        apellidos: diff.nuevo.apellidos ?? usuario.apellidos,
      });
      await sincronizar("nombre_visible", () => firebaseAuth.actualizarNombre(usuario.firebase_uid, nuevoNombre));
    }
    await registrarAuditoria({
      contexto,
      accion: "PERFIL_PROPIO_ACTUALIZADO",
      entidad: "usuarios",
      entidad_id: usuario.id,
      valor_anterior: diff.anterior,
      valor_nuevo: diff.nuevo,
    });
  }
  const actualizado = await userRepository.buscarPorId(usuario.id);
  return presentar(actualizado);
}

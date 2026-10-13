/**
 * Constantes compartidas del backend: roles, estados, paginación y reglas de negocio (evaluaciones, bitácora).
 * Los códigos de rol coinciden con la tabla `roles` de PostgreSQL.
 */
export const ROLES = Object.freeze({
  DIRECTOR_PROGRAMA: "DIRECTOR_PROGRAMA",
  ESTUDIANTE: "ESTUDIANTE",
  DOCENTE_SUPERVISOR: "DOCENTE_SUPERVISOR",
  ASESOR_SITIO: "ASESOR_SITIO",
});

export const LISTA_ROLES = Object.freeze(Object.values(ROLES));

/** Roles que el Director puede dar de alta desde "Registrar nuevo usuario". */
export const ROLES_REGISTRABLES = Object.freeze([
  ROLES.ESTUDIANTE,
  ROLES.DOCENTE_SUPERVISOR,
  ROLES.ASESOR_SITIO,
]);

export const NOMBRES_ROL = Object.freeze({
  [ROLES.DIRECTOR_PROGRAMA]: "Director de Programa",
  [ROLES.ESTUDIANTE]: "Estudiante",
  [ROLES.DOCENTE_SUPERVISOR]: "Docente Supervisor",
  [ROLES.ASESOR_SITIO]: "Asesor de Sitio",
});

export const ESTADOS_USUARIO = Object.freeze(["ACTIVO", "INACTIVO", "SUSPENDIDO"]);
export const ESTADOS_CONVENIO = Object.freeze(["VIGENTE", "EN_TRAMITE", "SUSPENDIDO", "VENCIDO"]);

/** Estados de una asignación que se consideran "en curso" (impiden deshabilitar sin confirmar). */
export const ESTADOS_ASIGNACION_EN_CURSO = Object.freeze([
  "PENDIENTE_DOCUMENTOS",
  "ACTIVA",
  "PENDIENTE_EVALUACION",
]);

export const PAGINA_TAMANO_POR_DEFECTO = 20;
export const PAGINA_TAMANO_MAXIMO = 100;

/** Reglas de las evaluaciones (documento maestro 3.18 y 3.21). */
export const EVALUACION = Object.freeze({
  NOTA_MINIMA: 0,
  NOTA_MAXIMA: 5,
  MAXIMO_CARACTERES_RETROALIMENTACION: 3000,
  TIPOS: Object.freeze(["DOCENTE_SUPERVISOR", "ASESOR_SITIO"]),
});

/** Reglas de la bitácora (documento maestro 3.15). */
export const BITACORA = Object.freeze({
  MINIMO_PALABRAS_REFLEXION: 20,
  MAXIMO_CARACTERES_REFLEXION: 20000,
  MAXIMO_CARACTERES_RESPUESTA: 5000,
  MAXIMO_EVIDENCIAS: 20,
  MAXIMO_BYTES_EVIDENCIA: 10 * 1024 * 1024,
  TIPOS_EVIDENCIA: Object.freeze({
    "image/jpeg": { extensiones: [".jpg", ".jpeg"], ext: "jpg" },
    "image/png": { extensiones: [".png"], ext: "png" },
    "application/pdf": { extensiones: [".pdf"], ext: "pdf" },
  }),
});

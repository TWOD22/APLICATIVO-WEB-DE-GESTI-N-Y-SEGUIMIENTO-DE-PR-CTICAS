-- Up Migration

-- MIGRACIÓN 2 · Estructura académica y usuarios.
-- Tablas: programas_academicos, periodos_academicos, niveles_practica, roles, usuarios, usuarios_roles,
-- usuarios_programas y matriculas_estudiantes.
-- Todas usan borrado lógico (`eliminado_en`) e índices únicos parciales (solo aplican a filas no eliminadas).

-- Programas académicos (p. ej. Licenciatura en Educación Infantil).
CREATE TABLE programas_academicos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              citext NOT NULL,
  nombre              varchar(200) NOT NULL,
  cantidad_semestres  smallint NOT NULL CHECK (cantidad_semestres BETWEEN 1 AND 12),
  activo              boolean NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  eliminado_en        timestamptz
);
CREATE UNIQUE INDEX uq_programas_codigo ON programas_academicos (codigo) WHERE eliminado_en IS NULL;

-- Periodos académicos (p. ej. 2026-2).
CREATE TABLE periodos_academicos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          citext NOT NULL,
  nombre          varchar(120) NOT NULL,
  fecha_inicio    date NOT NULL,
  fecha_fin       date NOT NULL,
  estado          estado_periodo NOT NULL DEFAULT 'PLANIFICADO',
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz,
  CONSTRAINT ck_periodos_fechas CHECK (fecha_fin >= fecha_inicio)
);
CREATE UNIQUE INDEX uq_periodos_codigo ON periodos_academicos (codigo) WHERE eliminado_en IS NULL;
-- Solo un periodo activo a la vez
CREATE UNIQUE INDEX uq_periodos_un_activo ON periodos_academicos (estado)
  WHERE estado = 'ACTIVO' AND eliminado_en IS NULL;

-- Niveles de práctica pedagógica (I a VIII) de cada programa; cada nivel corresponde a un semestre.
CREATE TABLE niveles_practica (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programa_academico_id uuid NOT NULL REFERENCES programas_academicos (id) ON DELETE RESTRICT,
  codigo          citext NOT NULL,
  nombre          varchar(120) NOT NULL,
  numero_semestre smallint NOT NULL CHECK (numero_semestre BETWEEN 1 AND 8),
  orden_visual    smallint NOT NULL CHECK (orden_visual > 0),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz
);
CREATE UNIQUE INDEX uq_niveles_programa_codigo ON niveles_practica (programa_academico_id, codigo)
  WHERE eliminado_en IS NULL;
CREATE UNIQUE INDEX uq_niveles_programa_orden ON niveles_practica (programa_academico_id, orden_visual)
  WHERE eliminado_en IS NULL;

-- Roles del sistema (Director, Estudiante, Docente Supervisor, Asesor de Sitio).
CREATE TABLE roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          varchar(40) NOT NULL,
  nombre          varchar(80) NOT NULL,
  descripcion     varchar(250),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz
);
CREATE UNIQUE INDEX uq_roles_codigo ON roles (codigo) WHERE eliminado_en IS NULL;

-- Las contraseñas NO se guardan aquí: viven en Firebase Auth.
-- Usuarios del sistema. La identidad y la contraseña viven en Firebase (`firebase_uid` los enlaza).
CREATE TABLE usuarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid    varchar(128) NOT NULL,
  tipo_documento  varchar(10) NOT NULL DEFAULT 'CC'
                  CHECK (tipo_documento IN ('CC', 'CE', 'TI', 'PEP', 'PPT', 'PAS')),
  numero_documento varchar(30) NOT NULL,
  nombres         varchar(120) NOT NULL,
  apellidos       varchar(120) NOT NULL,
  correo_institucional citext NOT NULL,
  telefono        varchar(30),
  estado          estado_usuario NOT NULL DEFAULT 'ACTIVO',
  ultimo_acceso_en timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz,
  CONSTRAINT ck_usuarios_correo CHECK (correo_institucional ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
CREATE UNIQUE INDEX uq_usuarios_firebase_uid ON usuarios (firebase_uid) WHERE eliminado_en IS NULL;
CREATE UNIQUE INDEX uq_usuarios_documento ON usuarios (tipo_documento, numero_documento) WHERE eliminado_en IS NULL;
CREATE UNIQUE INDEX uq_usuarios_correo ON usuarios (correo_institucional) WHERE eliminado_en IS NULL;
CREATE INDEX ix_usuarios_estado ON usuarios (estado) WHERE eliminado_en IS NULL;

-- Roles de cada usuario con vigencia (un usuario puede tener varios roles).
CREATE TABLE usuarios_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  rol_id          uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  asignado_por_id uuid REFERENCES usuarios (id) ON DELETE RESTRICT,
  vigente_desde   date NOT NULL DEFAULT current_date,
  vigente_hasta   date,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz,
  CONSTRAINT ck_usuarios_roles_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE UNIQUE INDEX uq_usuarios_roles ON usuarios_roles (usuario_id, rol_id) WHERE eliminado_en IS NULL;
CREATE INDEX ix_usuarios_roles_rol ON usuarios_roles (rol_id) WHERE eliminado_en IS NULL;

-- Programas a los que pertenece cada usuario.
CREATE TABLE usuarios_programas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  programa_academico_id uuid NOT NULL REFERENCES programas_academicos (id) ON DELETE RESTRICT,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz
);
CREATE UNIQUE INDEX uq_usuarios_programas ON usuarios_programas (usuario_id, programa_academico_id)
  WHERE eliminado_en IS NULL;

-- Matrícula del estudiante en un periodo: programa, semestre y estado académico. Una por estudiante y periodo.
CREATE TABLE matriculas_estudiantes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id   uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  programa_academico_id uuid NOT NULL REFERENCES programas_academicos (id) ON DELETE RESTRICT,
  periodo_academico_id  uuid NOT NULL REFERENCES periodos_academicos (id) ON DELETE RESTRICT,
  numero_semestre smallint NOT NULL CHECK (numero_semestre BETWEEN 1 AND 8),
  estado_academico estado_matricula NOT NULL DEFAULT 'ACTIVA',
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz
);
CREATE UNIQUE INDEX uq_matriculas_estudiante_periodo ON matriculas_estudiantes (estudiante_id, periodo_academico_id)
  WHERE eliminado_en IS NULL;
CREATE INDEX ix_matriculas_periodo ON matriculas_estudiantes (periodo_academico_id) WHERE eliminado_en IS NULL;

-- Reversión: elimina las tablas en orden inverso a su creación.
-- Down Migration

DROP TABLE IF EXISTS matriculas_estudiantes;
DROP TABLE IF EXISTS usuarios_programas;
DROP TABLE IF EXISTS usuarios_roles;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS niveles_practica;
DROP TABLE IF EXISTS periodos_academicos;
DROP TABLE IF EXISTS programas_academicos;

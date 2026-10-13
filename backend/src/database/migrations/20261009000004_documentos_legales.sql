-- Up Migration

-- MIGRACIÓN 4 · Documentos legales.
-- Tablas: tipos_documento_legal, requisitos_documentales, archivos y documentos_legales_estudiantes.
-- Cada documento se versiona: solo una versión es la actual (`es_version_actual`).
-- Catálogo de tipos de documento (cédula, ARL, hoja de vida, carta de aceptación) con formatos y tamaño máximo.
CREATE TABLE tipos_documento_legal (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              varchar(40) NOT NULL,
  nombre              varchar(120) NOT NULL,
  descripcion         varchar(500),
  tipos_mime_permitidos text[] NOT NULL DEFAULT ARRAY['application/pdf']
                      CHECK (cardinality(tipos_mime_permitidos) > 0),
  tamano_maximo_bytes bigint NOT NULL DEFAULT 10485760 CHECK (tamano_maximo_bytes > 0),
  activo              boolean NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  eliminado_en        timestamptz
);
CREATE UNIQUE INDEX uq_tipos_documento_codigo ON tipos_documento_legal (codigo) WHERE eliminado_en IS NULL;

-- Qué documentos exige cada nivel de práctica y si son obligatorios.
CREATE TABLE requisitos_documentales (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nivel_practica_id  uuid NOT NULL REFERENCES niveles_practica (id) ON DELETE RESTRICT,
  tipo_documento_legal_id uuid NOT NULL REFERENCES tipos_documento_legal (id) ON DELETE RESTRICT,
  obligatorio        boolean NOT NULL DEFAULT true,
  orden_visual       smallint NOT NULL DEFAULT 1 CHECK (orden_visual > 0),
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  eliminado_en       timestamptz
);
CREATE UNIQUE INDEX uq_requisitos_nivel_tipo ON requisitos_documentales (nivel_practica_id, tipo_documento_legal_id)
  WHERE eliminado_en IS NULL;

-- Metadatos de archivos. El binario vive en Cloud Storage; aquí solo la ruta privada.
CREATE TABLE archivos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket            varchar(200) NOT NULL,
  ruta_almacenamiento text NOT NULL,
  nombre_original   varchar(255) NOT NULL,
  tipo_mime         varchar(100) NOT NULL,
  tamano_bytes      bigint NOT NULL CHECK (tamano_bytes >= 0),
  hash_sha256       char(64),
  generacion_storage bigint,
  subido_por_id     uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  estado            estado_archivo NOT NULL DEFAULT 'PENDIENTE',
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  eliminado_en      timestamptz,
  CONSTRAINT ck_archivos_ruta_privada CHECK (ruta_almacenamiento !~* '^https?://')
);
CREATE UNIQUE INDEX uq_archivos_ruta ON archivos (bucket, ruta_almacenamiento) WHERE eliminado_en IS NULL;
CREATE INDEX ix_archivos_subido_por ON archivos (subido_por_id) WHERE eliminado_en IS NULL;

-- Documento que sube un estudiante para una asignación; guarda versión, estado de revisión y quién lo revisó.
-- Si el estado es POR_CORREGIR la observación es obligatoria (restricción ck_documentos_observacion).
CREATE TABLE documentos_legales_estudiantes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_practica_id   uuid NOT NULL REFERENCES asignaciones_practica (id) ON DELETE RESTRICT,
  tipo_documento_legal_id  uuid NOT NULL REFERENCES tipos_documento_legal (id) ON DELETE RESTRICT,
  archivo_id               uuid NOT NULL REFERENCES archivos (id) ON DELETE RESTRICT,
  numero_version           integer NOT NULL DEFAULT 1 CHECK (numero_version >= 1),
  es_version_actual        boolean NOT NULL DEFAULT true,
  estado                   estado_documento NOT NULL DEFAULT 'EN_REVISION',
  observacion_revision     text,
  enviado_en               timestamptz,
  revisado_por_id          uuid REFERENCES usuarios (id) ON DELETE RESTRICT,
  revisado_en              timestamptz,
  creado_en                timestamptz NOT NULL DEFAULT now(),
  actualizado_en           timestamptz NOT NULL DEFAULT now(),
  eliminado_en             timestamptz,
  CONSTRAINT ck_documentos_observacion
    CHECK (estado <> 'POR_CORREGIR' OR length(btrim(coalesce(observacion_revision, ''))) > 0)
);
CREATE UNIQUE INDEX uq_documentos_version ON documentos_legales_estudiantes
  (asignacion_practica_id, tipo_documento_legal_id, numero_version) WHERE eliminado_en IS NULL;
CREATE UNIQUE INDEX uq_documentos_version_actual ON documentos_legales_estudiantes
  (asignacion_practica_id, tipo_documento_legal_id) WHERE es_version_actual AND eliminado_en IS NULL;
CREATE UNIQUE INDEX uq_documentos_archivo ON documentos_legales_estudiantes (archivo_id)
  WHERE eliminado_en IS NULL;
CREATE INDEX ix_documentos_estado ON documentos_legales_estudiantes (estado)
  WHERE es_version_actual AND eliminado_en IS NULL;

-- Reversión: elimina las tablas en orden inverso.
-- Down Migration

DROP TABLE IF EXISTS documentos_legales_estudiantes;
DROP TABLE IF EXISTS archivos;
DROP TABLE IF EXISTS requisitos_documentales;
DROP TABLE IF EXISTS tipos_documento_legal;

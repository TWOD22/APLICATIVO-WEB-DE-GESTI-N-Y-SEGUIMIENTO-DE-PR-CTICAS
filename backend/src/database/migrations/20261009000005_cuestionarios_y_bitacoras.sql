-- Up Migration

-- MIGRACIÓN 5 · Cuestionarios versionados, bitácoras, evidencias y respuestas.
-- Incluye triggers que impiden responder preguntas ajenas y modificar cuestionarios ya publicados.
-- Cuestionarios por nivel de práctica: versionados, con estado publicado/habilitado.
CREATE TABLE cuestionarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nivel_practica_id uuid NOT NULL REFERENCES niveles_practica (id) ON DELETE RESTRICT,
  creado_por_id   uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  numero_version  integer NOT NULL CHECK (numero_version >= 1),
  titulo          varchar(200) NOT NULL,
  habilitado      boolean NOT NULL DEFAULT false,
  publicado       boolean NOT NULL DEFAULT false,
  publicado_en    timestamptz,
  publicado_por_id uuid REFERENCES usuarios (id) ON DELETE RESTRICT,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz,
  CONSTRAINT ck_cuestionarios_publicacion CHECK (NOT publicado OR publicado_en IS NOT NULL),
  CONSTRAINT ck_cuestionarios_habilitado CHECK (NOT habilitado OR publicado)
);
CREATE UNIQUE INDEX uq_cuestionarios_nivel_version ON cuestionarios (nivel_practica_id, numero_version)
  WHERE eliminado_en IS NULL;
-- Un único cuestionario habilitado por nivel
CREATE UNIQUE INDEX uq_cuestionarios_habilitado_nivel ON cuestionarios (nivel_practica_id)
  WHERE habilitado AND eliminado_en IS NULL;

-- Preguntas de un cuestionario (abiertas o cerradas) con su orden.
CREATE TABLE preguntas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuestionario_id  uuid NOT NULL REFERENCES cuestionarios (id) ON DELETE RESTRICT,
  tipo             tipo_pregunta NOT NULL,
  enunciado        text NOT NULL CHECK (length(btrim(enunciado)) > 0),
  obligatoria      boolean NOT NULL DEFAULT true,
  orden_visual     integer NOT NULL CHECK (orden_visual > 0),
  activa           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  eliminado_en     timestamptz
);
CREATE INDEX ix_preguntas_cuestionario ON preguntas (cuestionario_id, orden_visual) WHERE eliminado_en IS NULL;

-- Opciones de respuesta de las preguntas cerradas.
CREATE TABLE opciones_pregunta (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pregunta_id     uuid NOT NULL REFERENCES preguntas (id) ON DELETE CASCADE,
  etiqueta        varchar(250) NOT NULL CHECK (length(btrim(etiqueta)) > 0),
  valor           varchar(100) NOT NULL,
  orden_visual    integer NOT NULL CHECK (orden_visual > 0),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz
);
CREATE UNIQUE INDEX uq_opciones_pregunta_valor ON opciones_pregunta (pregunta_id, valor)
  WHERE eliminado_en IS NULL;
CREATE INDEX ix_opciones_pregunta ON opciones_pregunta (pregunta_id, orden_visual) WHERE eliminado_en IS NULL;

-- Bitácora del estudiante (una por asignación): reflexión, estado, revisión del borrador y llave de idempotencia (evita doble envío).
CREATE TABLE bitacoras (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_practica_id  uuid NOT NULL REFERENCES asignaciones_practica (id) ON DELETE RESTRICT,
  cuestionario_id         uuid REFERENCES cuestionarios (id) ON DELETE RESTRICT,
  reflexion               text,
  estado                  estado_bitacora NOT NULL DEFAULT 'BLOQUEADA',
  numero_revision_borrador integer NOT NULL DEFAULT 0 CHECK (numero_revision_borrador >= 0),
  llave_idempotencia      varchar(100),
  enviada_en              timestamptz,
  devuelta_en             timestamptz,
  evaluada_en             timestamptz,
  motivo_devolucion       text,
  creado_en               timestamptz NOT NULL DEFAULT now(),
  actualizado_en          timestamptz NOT NULL DEFAULT now(),
  eliminado_en            timestamptz,
  CONSTRAINT ck_bitacoras_envio CHECK (
    estado NOT IN ('ENVIADA', 'EN_EVALUACION', 'EVALUADA') OR enviada_en IS NOT NULL
  )
);
-- Una bitácora pertenece a una única asignación
CREATE UNIQUE INDEX uq_bitacoras_asignacion ON bitacoras (asignacion_practica_id) WHERE eliminado_en IS NULL;
CREATE UNIQUE INDEX uq_bitacoras_idempotencia ON bitacoras (llave_idempotencia)
  WHERE llave_idempotencia IS NOT NULL AND eliminado_en IS NULL;

-- Evidencias (fotos o PDF) asociadas a la bitácora; el archivo está en la tabla `archivos`.
CREATE TABLE evidencias_bitacora (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bitacora_id     uuid NOT NULL REFERENCES bitacoras (id) ON DELETE RESTRICT,
  archivo_id      uuid NOT NULL REFERENCES archivos (id) ON DELETE RESTRICT,
  creado_por_id   uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  descripcion     varchar(500),
  orden_visual    integer NOT NULL DEFAULT 1 CHECK (orden_visual > 0),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz
);
CREATE UNIQUE INDEX uq_evidencias_archivo ON evidencias_bitacora (archivo_id) WHERE eliminado_en IS NULL;
CREATE INDEX ix_evidencias_bitacora ON evidencias_bitacora (bitacora_id, orden_visual) WHERE eliminado_en IS NULL;

-- Respuesta del estudiante a una pregunta de la bitácora (texto si es abierta).
CREATE TABLE respuestas_bitacora (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bitacora_id      uuid NOT NULL REFERENCES bitacoras (id) ON DELETE RESTRICT,
  pregunta_id      uuid NOT NULL REFERENCES preguntas (id) ON DELETE RESTRICT,
  respuesta_texto  text,
  respondida_en    timestamptz,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  eliminado_en     timestamptz
);
CREATE UNIQUE INDEX uq_respuestas_bitacora_pregunta ON respuestas_bitacora (bitacora_id, pregunta_id)
  WHERE eliminado_en IS NULL;

-- Opciones elegidas en las preguntas cerradas.
CREATE TABLE respuestas_opciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  respuesta_bitacora_id uuid NOT NULL REFERENCES respuestas_bitacora (id) ON DELETE RESTRICT,
  opcion_pregunta_id    uuid NOT NULL REFERENCES opciones_pregunta (id) ON DELETE RESTRICT,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz
);
CREATE UNIQUE INDEX uq_respuestas_opciones ON respuestas_opciones (respuesta_bitacora_id, opcion_pregunta_id)
  WHERE eliminado_en IS NULL;

-- Una pregunta respondida pertenece al cuestionario de la bitácora
CREATE FUNCTION fn_validar_respuesta_bitacora() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.eliminado_en IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM bitacoras b
      JOIN preguntas p ON p.cuestionario_id = b.cuestionario_id
     WHERE b.id = NEW.bitacora_id AND p.id = NEW.pregunta_id
  ) THEN
    RAISE EXCEPTION 'La pregunta no pertenece al cuestionario de la bitácora'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_respuestas_bitacora_validar
  BEFORE INSERT OR UPDATE OF bitacora_id, pregunta_id ON respuestas_bitacora
  FOR EACH ROW EXECUTE FUNCTION fn_validar_respuesta_bitacora();

-- La opción elegida debe pertenecer a la pregunta respondida
CREATE FUNCTION fn_validar_respuesta_opcion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.eliminado_en IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM respuestas_bitacora r
      JOIN opciones_pregunta o ON o.pregunta_id = r.pregunta_id
     WHERE r.id = NEW.respuesta_bitacora_id AND o.id = NEW.opcion_pregunta_id
  ) THEN
    RAISE EXCEPTION 'La opción no pertenece a la pregunta respondida'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_respuestas_opciones_validar
  BEFORE INSERT OR UPDATE OF respuesta_bitacora_id, opcion_pregunta_id ON respuestas_opciones
  FOR EACH ROW EXECUTE FUNCTION fn_validar_respuesta_opcion();

-- Un cuestionario publicado no se modifica (se crea una nueva versión)
CREATE FUNCTION fn_bloquear_cuestionario_publicado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cuestionario_id uuid;
  v_publicado boolean;
BEGIN
  IF TG_TABLE_NAME = 'preguntas' THEN
    v_cuestionario_id := COALESCE(NEW.cuestionario_id, OLD.cuestionario_id);
  ELSE
    SELECT p.cuestionario_id INTO v_cuestionario_id
      FROM preguntas p WHERE p.id = COALESCE(NEW.pregunta_id, OLD.pregunta_id);
  END IF;
  SELECT c.publicado INTO v_publicado FROM cuestionarios c WHERE c.id = v_cuestionario_id;
  IF v_publicado THEN
    RAISE EXCEPTION 'El cuestionario ya fue publicado; cree una nueva versión para modificarlo'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER tg_preguntas_publicado
  BEFORE INSERT OR UPDATE OR DELETE ON preguntas
  FOR EACH ROW EXECUTE FUNCTION fn_bloquear_cuestionario_publicado();
CREATE TRIGGER tg_opciones_publicado
  BEFORE INSERT OR UPDATE OR DELETE ON opciones_pregunta
  FOR EACH ROW EXECUTE FUNCTION fn_bloquear_cuestionario_publicado();

-- Reversión: elimina triggers, funciones y tablas.
-- Down Migration

DROP TRIGGER IF EXISTS tg_opciones_publicado ON opciones_pregunta;
DROP TRIGGER IF EXISTS tg_preguntas_publicado ON preguntas;
DROP FUNCTION IF EXISTS fn_bloquear_cuestionario_publicado();
DROP TRIGGER IF EXISTS tg_respuestas_opciones_validar ON respuestas_opciones;
DROP FUNCTION IF EXISTS fn_validar_respuesta_opcion();
DROP TRIGGER IF EXISTS tg_respuestas_bitacora_validar ON respuestas_bitacora;
DROP FUNCTION IF EXISTS fn_validar_respuesta_bitacora();
DROP TABLE IF EXISTS respuestas_opciones;
DROP TABLE IF EXISTS respuestas_bitacora;
DROP TABLE IF EXISTS evidencias_bitacora;
DROP TABLE IF EXISTS bitacoras;
DROP TABLE IF EXISTS opciones_pregunta;
DROP TABLE IF EXISTS preguntas;
DROP TABLE IF EXISTS cuestionarios;

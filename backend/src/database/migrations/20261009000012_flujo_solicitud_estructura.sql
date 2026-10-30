-- Up Migration

-- MIGRACIÓN 12 · Estructura del flujo de solicitud v2.
--  1. docentes_niveles: un docente por nivel y periodo (lo configura el Director).
--  2. asignaciones_practica: la plaza se define después (institucion_id opcional) y se registra su validación.
--  3. evaluaciones_historial: trazabilidad de las correcciones de nota que hace cada evaluador.
--  4. guias_criterios: PDF de criterios que sube el docente por nivel y periodo.
--  5. eventos_salientes: bandeja de salida (outbox) para el servicio de notificaciones y auditoría.

-- 1. Docente responsable de cada nivel en un periodo
CREATE TABLE docentes_niveles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  docente_id             uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  nivel_practica_id      uuid NOT NULL REFERENCES niveles_practica (id) ON DELETE RESTRICT,
  periodo_academico_id   uuid NOT NULL REFERENCES periodos_academicos (id) ON DELETE RESTRICT,
  asignado_por_id        uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  creado_en              timestamptz NOT NULL DEFAULT now(),
  actualizado_en         timestamptz NOT NULL DEFAULT now(),
  eliminado_en           timestamptz
);
-- Un solo docente por nivel y periodo; un docente puede tener varios niveles
CREATE UNIQUE INDEX uq_docentes_niveles_nivel_periodo
  ON docentes_niveles (nivel_practica_id, periodo_academico_id) WHERE eliminado_en IS NULL;
CREATE INDEX ix_docentes_niveles_docente ON docentes_niveles (docente_id, periodo_academico_id) WHERE eliminado_en IS NULL;

CREATE FUNCTION fn_validar_docente_nivel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.eliminado_en IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM usuarios_roles ur JOIN roles r ON r.id = ur.rol_id
     WHERE ur.usuario_id = NEW.docente_id AND r.codigo = 'DOCENTE_SUPERVISOR' AND ur.eliminado_en IS NULL
  ) THEN
    RAISE EXCEPTION 'El usuario asignado al nivel no tiene el rol DOCENTE_SUPERVISOR'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tg_docentes_niveles_validar
  BEFORE INSERT OR UPDATE OF docente_id, eliminado_en ON docentes_niveles
  FOR EACH ROW EXECUTE FUNCTION fn_validar_docente_nivel();
CREATE TRIGGER tg_docentes_niveles_marca_tiempo BEFORE UPDATE ON docentes_niveles
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_marca_tiempo();

-- 2. Asignaciones: plaza opcional y trazabilidad de su validación
ALTER TABLE asignaciones_practica ALTER COLUMN institucion_id DROP NOT NULL;
ALTER TABLE asignaciones_practica ALTER COLUMN asignada_por_id DROP NOT NULL;
ALTER TABLE asignaciones_practica
  ADD COLUMN solicitada_por_id        uuid REFERENCES usuarios (id) ON DELETE RESTRICT,
  ADD COLUMN institucion_solicitada_id uuid REFERENCES instituciones (id) ON DELETE RESTRICT,
  ADD COLUMN plaza_validada_por_id    uuid REFERENCES usuarios (id) ON DELETE RESTRICT,
  ADD COLUMN plaza_validada_en        timestamptz,
  ADD COLUMN motivo_cambio_plaza      varchar(500),
  ADD COLUMN motivo_rechazo           varchar(500),
  ADD COLUMN enviada_en               timestamptz;

-- Una vez la práctica está en curso o terminada, la plaza y quién asignó deben existir
ALTER TABLE asignaciones_practica ADD CONSTRAINT ck_asignaciones_plaza_definida
  CHECK (estado NOT IN ('ACTIVA', 'PENDIENTE_EVALUACION', 'FINALIZADA') OR institucion_id IS NOT NULL);
ALTER TABLE asignaciones_practica ADD CONSTRAINT ck_asignaciones_plaza_elegida
  CHECK (estado <> 'PLAZA_SELECCIONADA' OR institucion_solicitada_id IS NOT NULL);
ALTER TABLE asignaciones_practica ADD CONSTRAINT ck_asignaciones_motivo_rechazo
  CHECK (estado <> 'RECHAZADA' OR motivo_rechazo IS NOT NULL);
-- Si el Director cambia la plaza que eligió el estudiante, debe dejar el motivo
ALTER TABLE asignaciones_practica ADD CONSTRAINT ck_asignaciones_cambio_plaza
  CHECK (institucion_solicitada_id IS NULL OR institucion_id IS NULL
         OR institucion_solicitada_id = institucion_id OR motivo_cambio_plaza IS NOT NULL);

-- Una solicitud rechazada ya no cuenta como práctica vigente
DROP INDEX uq_asignaciones_una_activa;
CREATE UNIQUE INDEX uq_asignaciones_una_activa ON asignaciones_practica (matricula_estudiante_id)
  WHERE eliminado_en IS NULL AND estado NOT IN ('CANCELADA', 'RECHAZADA');
CREATE INDEX ix_asignaciones_estado ON asignaciones_practica (estado) WHERE eliminado_en IS NULL;
CREATE INDEX ix_asignaciones_solicitada ON asignaciones_practica (institucion_solicitada_id) WHERE eliminado_en IS NULL;

CREATE OR REPLACE FUNCTION fn_validar_asignacion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_periodo_id uuid;
  v_programa_id uuid;
BEGIN
  IF NEW.eliminado_en IS NOT NULL OR NEW.estado IN ('CANCELADA', 'FINALIZADA', 'RECHAZADA') THEN
    RETURN NEW;
  END IF;

  SELECT m.periodo_academico_id, m.programa_academico_id INTO v_periodo_id, v_programa_id
    FROM matriculas_estudiantes m WHERE m.id = NEW.matricula_estudiante_id;

  IF NOT EXISTS (
    SELECT 1 FROM niveles_practica n WHERE n.id = NEW.nivel_practica_id AND n.programa_academico_id = v_programa_id
  ) THEN
    RAISE EXCEPTION 'El nivel de práctica no pertenece al programa de la matrícula'
      USING ERRCODE = 'check_violation';
  END IF;

  -- La plaza definitiva (institucion_id) puede estar vacía mientras la práctica es solo una solicitud.
  IF NEW.institucion_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.institucion_id IS DISTINCT FROM OLD.institucion_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM instituciones i
       WHERE i.id = NEW.institucion_id AND i.activa AND i.eliminado_en IS NULL
    ) THEN
      RAISE EXCEPTION 'La institución no está activa'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- La plaza elegida por el estudiante también debe estar activa.
  IF NEW.institucion_solicitada_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.institucion_solicitada_id IS DISTINCT FROM OLD.institucion_solicitada_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM instituciones i
       WHERE i.id = NEW.institucion_solicitada_id AND i.activa AND i.eliminado_en IS NULL
    ) THEN
      RAISE EXCEPTION 'La institución solicitada no está activa'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.docente_supervisor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM usuarios_roles ur JOIN roles r ON r.id = ur.rol_id
     WHERE ur.usuario_id = NEW.docente_supervisor_id
       AND r.codigo = 'DOCENTE_SUPERVISOR' AND ur.eliminado_en IS NULL
  ) THEN
    RAISE EXCEPTION 'El usuario asignado como docente no tiene el rol DOCENTE_SUPERVISOR'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.asesor_sitio_id IS NOT NULL THEN
    IF NEW.institucion_id IS NULL THEN
      RAISE EXCEPTION 'No se puede asignar un asesor sin una plaza definida'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM usuarios_roles ur JOIN roles r ON r.id = ur.rol_id
       WHERE ur.usuario_id = NEW.asesor_sitio_id
         AND r.codigo = 'ASESOR_SITIO' AND ur.eliminado_en IS NULL
    ) THEN
      RAISE EXCEPTION 'El usuario asignado como asesor no tiene el rol ASESOR_SITIO'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM vinculaciones_asesores v
       WHERE v.asesor_id = NEW.asesor_sitio_id
         AND v.institucion_id = NEW.institucion_id
         AND v.periodo_academico_id = v_periodo_id
         AND v.activa
         AND v.eliminado_en IS NULL
         AND v.vigente_desde <= current_date
         AND (v.vigente_hasta IS NULL OR v.vigente_hasta >= current_date)
    ) THEN
      RAISE EXCEPTION 'El asesor no pertenece a la institución seleccionada en este periodo'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER tg_asignaciones_validar ON asignaciones_practica;
CREATE TRIGGER tg_asignaciones_validar
  BEFORE INSERT OR UPDATE OF matricula_estudiante_id, nivel_practica_id, institucion_id, institucion_solicitada_id,
    docente_supervisor_id, asesor_sitio_id, estado, eliminado_en ON asignaciones_practica
  FOR EACH ROW EXECUTE FUNCTION fn_validar_asignacion();

-- 3. Historial de correcciones de nota (no se puede modificar ni borrar)
CREATE TABLE evaluaciones_historial (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluacion_id     uuid NOT NULL REFERENCES evaluaciones (id) ON DELETE RESTRICT,
  version           integer NOT NULL CHECK (version > 0),
  nota              numeric(3,2) NOT NULL CHECK (nota >= 0 AND nota <= 5),
  retroalimentacion text,
  motivo            varchar(500),
  corregida_por_id  uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  corregida_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_evaluaciones_historial_version UNIQUE (evaluacion_id, version)
);
CREATE FUNCTION fn_historial_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El historial de evaluaciones no se puede modificar ni borrar'
    USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER tg_evaluaciones_historial_inmutable
  BEFORE UPDATE OR DELETE ON evaluaciones_historial
  FOR EACH ROW EXECUTE FUNCTION fn_historial_inmutable();

-- 4. Guía de criterios (PDF) por nivel y periodo
CREATE TABLE guias_criterios (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nivel_practica_id    uuid NOT NULL REFERENCES niveles_practica (id) ON DELETE RESTRICT,
  periodo_academico_id uuid NOT NULL REFERENCES periodos_academicos (id) ON DELETE RESTRICT,
  docente_id           uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  archivo_id           uuid NOT NULL REFERENCES archivos (id) ON DELETE RESTRICT,
  version              integer NOT NULL CHECK (version > 0),
  vigente              boolean NOT NULL DEFAULT true,
  creado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_en       timestamptz NOT NULL DEFAULT now(),
  eliminado_en         timestamptz
);
-- Una sola guía vigente por nivel y periodo; las anteriores quedan como versiones
CREATE UNIQUE INDEX uq_guias_vigente ON guias_criterios (nivel_practica_id, periodo_academico_id)
  WHERE vigente AND eliminado_en IS NULL;
CREATE UNIQUE INDEX uq_guias_version ON guias_criterios (nivel_practica_id, periodo_academico_id, version);
CREATE TRIGGER tg_guias_criterios_marca_tiempo BEFORE UPDATE ON guias_criterios
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_marca_tiempo();

-- 5. Outbox: eventos que el núcleo publica hacia el servicio de notificaciones y auditoría.
-- Se guardan en la misma transacción del cambio de negocio; un publicador los envía a la cola.
CREATE TABLE eventos_salientes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo             varchar(100) NOT NULL,
  version          smallint NOT NULL DEFAULT 1,
  actor_id         uuid REFERENCES usuarios (id) ON DELETE SET NULL,
  entidad_tipo     varchar(60) NOT NULL,
  entidad_id       uuid NOT NULL,
  destinatarios    jsonb NOT NULL DEFAULT '[]'::jsonb,
  carga            jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado           varchar(12) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PUBLICADO', 'FALLIDO')),
  intentos         integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_error     text,
  proximo_intento_en timestamptz NOT NULL DEFAULT now(),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  publicado_en     timestamptz,
  CONSTRAINT ck_eventos_destinatarios CHECK (jsonb_typeof(destinatarios) = 'array')
);
CREATE INDEX ix_eventos_pendientes ON eventos_salientes (proximo_intento_en) WHERE estado = 'PENDIENTE';

-- Reversión: elimina lo creado y restaura la versión anterior de la función de validación.
-- Down Migration

DROP TABLE IF EXISTS eventos_salientes;
DROP TABLE IF EXISTS guias_criterios;
DROP TABLE IF EXISTS evaluaciones_historial;
DROP FUNCTION IF EXISTS fn_historial_inmutable();

DROP TRIGGER IF EXISTS tg_asignaciones_validar ON asignaciones_practica;
DROP INDEX IF EXISTS ix_asignaciones_solicitada;
DROP INDEX IF EXISTS ix_asignaciones_estado;
DROP INDEX IF EXISTS uq_asignaciones_una_activa;
-- Falla si hay asignaciones sin plaza o con estados nuevos: resuélvelas antes de revertir.
ALTER TABLE asignaciones_practica DROP CONSTRAINT IF EXISTS ck_asignaciones_cambio_plaza;
ALTER TABLE asignaciones_practica DROP CONSTRAINT IF EXISTS ck_asignaciones_motivo_rechazo;
ALTER TABLE asignaciones_practica DROP CONSTRAINT IF EXISTS ck_asignaciones_plaza_elegida;
ALTER TABLE asignaciones_practica DROP CONSTRAINT IF EXISTS ck_asignaciones_plaza_definida;
ALTER TABLE asignaciones_practica
  DROP COLUMN IF EXISTS enviada_en,
  DROP COLUMN IF EXISTS motivo_rechazo,
  DROP COLUMN IF EXISTS motivo_cambio_plaza,
  DROP COLUMN IF EXISTS plaza_validada_en,
  DROP COLUMN IF EXISTS plaza_validada_por_id,
  DROP COLUMN IF EXISTS institucion_solicitada_id,
  DROP COLUMN IF EXISTS solicitada_por_id;
ALTER TABLE asignaciones_practica ALTER COLUMN asignada_por_id SET NOT NULL;
ALTER TABLE asignaciones_practica ALTER COLUMN institucion_id SET NOT NULL;
CREATE UNIQUE INDEX uq_asignaciones_una_activa ON asignaciones_practica (matricula_estudiante_id)
  WHERE eliminado_en IS NULL AND estado <> 'CANCELADA';

CREATE OR REPLACE FUNCTION fn_validar_asignacion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_periodo_id uuid;
  v_programa_id uuid;
BEGIN
  IF NEW.eliminado_en IS NOT NULL OR NEW.estado IN ('CANCELADA', 'FINALIZADA') THEN
    RETURN NEW;
  END IF;

  SELECT m.periodo_academico_id, m.programa_academico_id INTO v_periodo_id, v_programa_id
    FROM matriculas_estudiantes m WHERE m.id = NEW.matricula_estudiante_id;

  IF NOT EXISTS (
    SELECT 1 FROM niveles_practica n WHERE n.id = NEW.nivel_practica_id AND n.programa_academico_id = v_programa_id
  ) THEN
    RAISE EXCEPTION 'El nivel de práctica no pertenece al programa de la matrícula'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.institucion_id IS DISTINCT FROM OLD.institucion_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM instituciones i
       WHERE i.id = NEW.institucion_id AND i.activa AND i.eliminado_en IS NULL
    ) THEN
      RAISE EXCEPTION 'La institución no está activa'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.docente_supervisor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM usuarios_roles ur JOIN roles r ON r.id = ur.rol_id
     WHERE ur.usuario_id = NEW.docente_supervisor_id
       AND r.codigo = 'DOCENTE_SUPERVISOR' AND ur.eliminado_en IS NULL
  ) THEN
    RAISE EXCEPTION 'El usuario asignado como docente no tiene el rol DOCENTE_SUPERVISOR'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.asesor_sitio_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM usuarios_roles ur JOIN roles r ON r.id = ur.rol_id
       WHERE ur.usuario_id = NEW.asesor_sitio_id
         AND r.codigo = 'ASESOR_SITIO' AND ur.eliminado_en IS NULL
    ) THEN
      RAISE EXCEPTION 'El usuario asignado como asesor no tiene el rol ASESOR_SITIO'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM vinculaciones_asesores v
       WHERE v.asesor_id = NEW.asesor_sitio_id
         AND v.institucion_id = NEW.institucion_id
         AND v.periodo_academico_id = v_periodo_id
         AND v.activa
         AND v.eliminado_en IS NULL
         AND v.vigente_desde <= current_date
         AND (v.vigente_hasta IS NULL OR v.vigente_hasta >= current_date)
    ) THEN
      RAISE EXCEPTION 'El asesor no pertenece a la institución seleccionada en este periodo'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_asignaciones_validar
  BEFORE INSERT OR UPDATE OF matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id,
    asesor_sitio_id, estado, eliminado_en ON asignaciones_practica
  FOR EACH ROW EXECUTE FUNCTION fn_validar_asignacion();

DROP TABLE IF EXISTS docentes_niveles;
DROP FUNCTION IF EXISTS fn_validar_docente_nivel();

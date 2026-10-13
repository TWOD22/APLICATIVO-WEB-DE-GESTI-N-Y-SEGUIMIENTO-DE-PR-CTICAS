-- Up Migration

-- MIGRACIÓN 6 · Evaluaciones.
-- Cada asignación tiene una evaluación por tipo de evaluador (Docente Supervisor y Asesor de Sitio); nota de 0.00 a 5.00.
-- Tabla de evaluaciones: nota, retroalimentación, estado y fecha de publicación.
CREATE TABLE evaluaciones (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_practica_id  uuid NOT NULL REFERENCES asignaciones_practica (id) ON DELETE RESTRICT,
  bitacora_id             uuid REFERENCES bitacoras (id) ON DELETE RESTRICT,
  evaluador_id            uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  tipo_evaluador          tipo_evaluador NOT NULL,
  nota                    numeric(3,2) CHECK (nota IS NULL OR (nota >= 0 AND nota <= 5)),
  retroalimentacion       text,
  estado                  estado_evaluacion NOT NULL DEFAULT 'PENDIENTE',
  publicada_en            timestamptz,
  creado_en               timestamptz NOT NULL DEFAULT now(),
  actualizado_en          timestamptz NOT NULL DEFAULT now(),
  eliminado_en            timestamptz,
  CONSTRAINT ck_evaluaciones_publicada
    CHECK (estado <> 'PUBLICADA' OR (nota IS NOT NULL AND publicada_en IS NOT NULL))
);
-- Una evaluación por tipo de evaluador y asignación; sin promedio automático
CREATE UNIQUE INDEX uq_evaluaciones_asignacion_tipo
  ON evaluaciones (asignacion_practica_id, tipo_evaluador) WHERE eliminado_en IS NULL;
CREATE INDEX ix_evaluaciones_evaluador ON evaluaciones (evaluador_id, estado) WHERE eliminado_en IS NULL;
CREATE INDEX ix_evaluaciones_bitacora ON evaluaciones (bitacora_id) WHERE eliminado_en IS NULL;

-- Una evaluación publicada es inmutable: para editarla se reabre (estado BORRADOR) antes
CREATE FUNCTION fn_proteger_evaluacion_publicada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'PUBLICADA' AND NEW.estado = 'PUBLICADA' AND (
       NEW.nota IS DISTINCT FROM OLD.nota
    OR NEW.retroalimentacion IS DISTINCT FROM OLD.retroalimentacion
    OR NEW.evaluador_id IS DISTINCT FROM OLD.evaluador_id
  ) THEN
    RAISE EXCEPTION 'Una evaluación publicada no puede modificarse sin reabrirla'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_evaluaciones_inmutable
  BEFORE UPDATE ON evaluaciones
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_evaluacion_publicada();

-- Reversión: elimina trigger, función y tabla.
-- Down Migration

DROP TRIGGER IF EXISTS tg_evaluaciones_inmutable ON evaluaciones;
DROP FUNCTION IF EXISTS fn_proteger_evaluacion_publicada();
DROP TABLE IF EXISTS evaluaciones;

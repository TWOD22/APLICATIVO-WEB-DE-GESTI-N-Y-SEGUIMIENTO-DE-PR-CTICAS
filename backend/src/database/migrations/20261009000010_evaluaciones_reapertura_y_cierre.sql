-- Up Migration

-- MIGRACIÓN 10 · Reapertura de evaluaciones, restricción de bitácora evaluada y ajuste del trigger de asignaciones
-- para que las prácticas FINALIZADAS no se revaliden.
-- Reapertura de evaluaciones: queda registrada en la propia fila (la auditoría detallada vive en Firestore).
ALTER TABLE evaluaciones ADD COLUMN reabierta_en timestamptz;
ALTER TABLE evaluaciones ADD COLUMN motivo_reapertura varchar(500);

-- Una bitácora EVALUADA siempre tiene fecha de evaluación (ambas notas publicadas).
ALTER TABLE bitacoras ADD CONSTRAINT ck_bitacoras_evaluada
  CHECK (estado <> 'EVALUADA' OR evaluada_en IS NOT NULL);

-- Una práctica FINALIZADA es histórica: cerrarla no debe volver a exigir que el convenio o la vinculación
-- del asesor sigan vigentes hoy (el periodo pudo terminar). Igual que CANCELADA, no se revalida.
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

-- Reversión: restaura la versión anterior de la función `fn_validar_asignacion` y quita lo agregado.
-- Down Migration

ALTER TABLE bitacoras DROP CONSTRAINT IF EXISTS ck_bitacoras_evaluada;
ALTER TABLE evaluaciones DROP COLUMN IF EXISTS motivo_reapertura;
ALTER TABLE evaluaciones DROP COLUMN IF EXISTS reabierta_en;

CREATE OR REPLACE FUNCTION fn_validar_asignacion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_periodo_id uuid;
  v_programa_id uuid;
BEGIN
  IF NEW.eliminado_en IS NOT NULL OR NEW.estado = 'CANCELADA' THEN
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

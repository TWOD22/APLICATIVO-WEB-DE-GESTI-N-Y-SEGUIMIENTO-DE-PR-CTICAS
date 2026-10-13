-- Up Migration

-- MIGRACIÓN 3 · Instituciones receptoras y asignaciones de práctica.
-- Incluye triggers que garantizan en la base de datos las reglas de integridad (roles correctos, convenio, vinculación del asesor).
-- Instituciones educativas que reciben practicantes, con su convenio.
CREATE TABLE instituciones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre           varchar(200) NOT NULL,
  nit              varchar(30) NOT NULL,
  ciudad           varchar(100) NOT NULL,
  direccion        varchar(250),
  correo           citext NOT NULL,
  telefono         varchar(30),
  estado_convenio  estado_convenio NOT NULL DEFAULT 'EN_TRAMITE',
  fecha_inicio_convenio date,
  fecha_fin_convenio    date,
  activa           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  eliminado_en     timestamptz,
  CONSTRAINT ck_instituciones_convenio_fechas
    CHECK (fecha_fin_convenio IS NULL OR fecha_inicio_convenio IS NULL OR fecha_fin_convenio >= fecha_inicio_convenio),
  CONSTRAINT ck_instituciones_correo
    CHECK (correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
CREATE UNIQUE INDEX uq_instituciones_nit ON instituciones (nit) WHERE eliminado_en IS NULL;
CREATE INDEX ix_instituciones_filtros ON instituciones (estado_convenio, activa) WHERE eliminado_en IS NULL;

-- Vinculación de un asesor de sitio con una institución en un periodo.
CREATE TABLE vinculaciones_asesores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asesor_id        uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  institucion_id   uuid NOT NULL REFERENCES instituciones (id) ON DELETE RESTRICT,
  periodo_academico_id uuid NOT NULL REFERENCES periodos_academicos (id) ON DELETE RESTRICT,
  cargo            varchar(120),
  activa           boolean NOT NULL DEFAULT true,
  vigente_desde    date NOT NULL DEFAULT current_date,
  vigente_hasta    date,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  eliminado_en     timestamptz,
  CONSTRAINT ck_vinculaciones_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE UNIQUE INDEX uq_vinculaciones_asesor_inst_periodo
  ON vinculaciones_asesores (asesor_id, institucion_id, periodo_academico_id) WHERE eliminado_en IS NULL;
CREATE INDEX ix_vinculaciones_institucion ON vinculaciones_asesores (institucion_id, periodo_academico_id)
  WHERE eliminado_en IS NULL;

-- Asignación de práctica: une matrícula del estudiante, nivel, institución, docente supervisor y asesor de sitio.
CREATE TABLE asignaciones_practica (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_estudiante_id uuid NOT NULL REFERENCES matriculas_estudiantes (id) ON DELETE RESTRICT,
  nivel_practica_id      uuid NOT NULL REFERENCES niveles_practica (id) ON DELETE RESTRICT,
  institucion_id         uuid NOT NULL REFERENCES instituciones (id) ON DELETE RESTRICT,
  docente_supervisor_id  uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  asesor_sitio_id        uuid REFERENCES usuarios (id) ON DELETE RESTRICT,
  fecha_inicio           date,
  fecha_fin              date,
  estado                 estado_asignacion NOT NULL DEFAULT 'PENDIENTE_DOCUMENTOS',
  asignada_por_id        uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  creado_en              timestamptz NOT NULL DEFAULT now(),
  actualizado_en         timestamptz NOT NULL DEFAULT now(),
  eliminado_en           timestamptz,
  CONSTRAINT ck_asignaciones_fechas CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio)
);
-- Una práctica vigente por matrícula (estudiante + periodo)
CREATE UNIQUE INDEX uq_asignaciones_una_activa ON asignaciones_practica (matricula_estudiante_id)
  WHERE eliminado_en IS NULL AND estado <> 'CANCELADA';
CREATE INDEX ix_asignaciones_docente ON asignaciones_practica (docente_supervisor_id) WHERE eliminado_en IS NULL;
CREATE INDEX ix_asignaciones_asesor ON asignaciones_practica (asesor_sitio_id) WHERE eliminado_en IS NULL;
CREATE INDEX ix_asignaciones_institucion ON asignaciones_practica (institucion_id) WHERE eliminado_en IS NULL;
CREATE INDEX ix_asignaciones_nivel ON asignaciones_practica (nivel_practica_id) WHERE eliminado_en IS NULL;

-- Reglas de integridad: rol del asesor al vincularlo
CREATE FUNCTION fn_validar_vinculacion_asesor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.eliminado_en IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM usuarios_roles ur
      JOIN roles r ON r.id = ur.rol_id
     WHERE ur.usuario_id = NEW.asesor_id
       AND r.codigo = 'ASESOR_SITIO'
       AND ur.eliminado_en IS NULL
  ) THEN
    RAISE EXCEPTION 'El usuario % no tiene el rol ASESOR_SITIO', NEW.asesor_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- El trigger se ejecuta antes de insertar o cambiar el asesor, para validar su rol.
CREATE TRIGGER tg_vinculaciones_validar
  BEFORE INSERT OR UPDATE OF asesor_id, eliminado_en ON vinculaciones_asesores
  FOR EACH ROW EXECUTE FUNCTION fn_validar_vinculacion_asesor();

-- Reglas de integridad de una asignación:
--  * institución activa (al crear o cambiar de institución)
--  * el docente tiene rol DOCENTE_SUPERVISOR
--  * el asesor tiene rol ASESOR_SITIO y vinculación vigente con la institución en el periodo
--  * el nivel pertenece al programa de la matrícula
CREATE FUNCTION fn_validar_asignacion() RETURNS trigger
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

-- El trigger revalida la asignación cada vez que cambian sus datos o su estado.
CREATE TRIGGER tg_asignaciones_validar
  BEFORE INSERT OR UPDATE OF matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id,
    asesor_sitio_id, estado, eliminado_en ON asignaciones_practica
  FOR EACH ROW EXECUTE FUNCTION fn_validar_asignacion();

-- Reversión: elimina triggers, funciones y tablas.
-- Down Migration

DROP TRIGGER IF EXISTS tg_asignaciones_validar ON asignaciones_practica;
DROP TRIGGER IF EXISTS tg_vinculaciones_validar ON vinculaciones_asesores;
DROP FUNCTION IF EXISTS fn_validar_asignacion();
DROP FUNCTION IF EXISTS fn_validar_vinculacion_asesor();
DROP TABLE IF EXISTS asignaciones_practica;
DROP TABLE IF EXISTS vinculaciones_asesores;
DROP TABLE IF EXISTS instituciones;

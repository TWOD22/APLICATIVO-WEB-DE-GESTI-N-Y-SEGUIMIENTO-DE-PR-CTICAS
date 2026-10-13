-- Up Migration

-- MIGRACIÓN 1 · Extensiones, tipos enumerados y función de marca de tiempo.
-- Es la base de todo el esquema: define los estados válidos de cada entidad.
--
-- Usa `citext` para textos sin distinción de mayúsculas (correos, códigos).
CREATE EXTENSION IF NOT EXISTS citext;

-- Catálogos de estados (tipos enumerados)
-- Cada tipo enumerado limita los valores posibles de una columna de estado.
-- Ciclo de una bitácora: BLOQUEADA → BORRADOR → ENVIADA → EN_EVALUACION → EVALUADA (o DEVUELTA).
CREATE TYPE estado_usuario AS ENUM ('ACTIVO', 'INACTIVO', 'SUSPENDIDO');
CREATE TYPE estado_periodo AS ENUM ('PLANIFICADO', 'ACTIVO', 'CERRADO');
CREATE TYPE estado_matricula AS ENUM ('ACTIVA', 'RETIRADA', 'FINALIZADA');
CREATE TYPE estado_convenio AS ENUM ('VIGENTE', 'EN_TRAMITE', 'SUSPENDIDO', 'VENCIDO');
CREATE TYPE estado_asignacion AS ENUM (
  'PENDIENTE_DOCUMENTOS', 'ACTIVA', 'PENDIENTE_EVALUACION', 'FINALIZADA', 'CANCELADA'
);
CREATE TYPE estado_archivo AS ENUM ('PENDIENTE', 'DISPONIBLE', 'RECHAZADO', 'ELIMINADO');
CREATE TYPE estado_documento AS ENUM (
  'SIN_CARGAR', 'EN_REVISION', 'APROBADO', 'POR_CORREGIR', 'REEMPLAZADO'
);
CREATE TYPE tipo_pregunta AS ENUM ('ABIERTA', 'CERRADA_UNICA', 'CERRADA_MULTIPLE');
CREATE TYPE estado_bitacora AS ENUM (
  'BLOQUEADA', 'BORRADOR', 'ENVIADA', 'EN_EVALUACION', 'EVALUADA', 'DEVUELTA'
);
CREATE TYPE tipo_evaluador AS ENUM ('DOCENTE_SUPERVISOR', 'ASESOR_SITIO');
CREATE TYPE estado_evaluacion AS ENUM ('PENDIENTE', 'BORRADOR', 'PUBLICADA');

-- Función genérica de trigger: actualiza `actualizado_en` cada vez que se modifica una fila (se enlaza a todas las tablas en la migración 7).
-- Función genérica: mantiene actualizado_en
CREATE FUNCTION fn_actualizar_marca_tiempo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

-- Reversión (se ejecuta con `pnpm migrate:down`): elimina lo creado en orden inverso.
-- Down Migration

DROP FUNCTION IF EXISTS fn_actualizar_marca_tiempo();
DROP TYPE IF EXISTS estado_evaluacion;
DROP TYPE IF EXISTS tipo_evaluador;
DROP TYPE IF EXISTS estado_bitacora;
DROP TYPE IF EXISTS tipo_pregunta;
DROP TYPE IF EXISTS estado_documento;
DROP TYPE IF EXISTS estado_archivo;
DROP TYPE IF EXISTS estado_asignacion;
DROP TYPE IF EXISTS estado_convenio;
DROP TYPE IF EXISTS estado_matricula;
DROP TYPE IF EXISTS estado_periodo;
DROP TYPE IF EXISTS estado_usuario;

-- Up Migration

-- MIGRACIÓN 8 · Permite asignaciones sin docente (se asigna después) y agrega el motivo de cancelación.
-- El documento maestro (3.10) y el boceto permiten crear una asignación sin docente
-- ("Sin Docente"). El trigger fn_validar_asignacion() ya tolera docente NULL.
ALTER TABLE asignaciones_practica ALTER COLUMN docente_supervisor_id DROP NOT NULL;

-- Trazabilidad de la cancelación (motivo obligatorio desde la API).
ALTER TABLE asignaciones_practica ADD COLUMN motivo_cancelacion varchar(500);
ALTER TABLE asignaciones_practica ADD CONSTRAINT ck_asignaciones_motivo_cancelacion
  CHECK (estado <> 'CANCELADA' OR motivo_cancelacion IS NOT NULL);

-- Down Migration

-- Falla si existen asignaciones sin docente: asígnales uno antes de revertir.
ALTER TABLE asignaciones_practica DROP CONSTRAINT IF EXISTS ck_asignaciones_motivo_cancelacion;
ALTER TABLE asignaciones_practica DROP COLUMN IF EXISTS motivo_cancelacion;
ALTER TABLE asignaciones_practica ALTER COLUMN docente_supervisor_id SET NOT NULL;

-- Up Migration
-- Elimina el ciclo asignaciones - bitacoras - evaluaciones: la bitácora es única por asignación
-- (uq_bitacoras_asignacion), así que evaluaciones.bitacora_id repetía lo que ya dicen
-- evaluaciones.asignacion_practica_id y bitacoras.asignacion_practica_id. Desde ahora una evaluación
-- pertenece a la asignación y su bitácora se obtiene por ella.
ALTER TABLE evaluaciones DROP CONSTRAINT IF EXISTS fk_evaluaciones_bitacora_asignacion;
DROP INDEX IF EXISTS ix_evaluaciones_bitacora;
ALTER TABLE evaluaciones DROP COLUMN IF EXISTS bitacora_id;
ALTER TABLE bitacoras DROP CONSTRAINT IF EXISTS uq_bitacoras_id_asignacion;

-- Down Migration
ALTER TABLE bitacoras ADD CONSTRAINT uq_bitacoras_id_asignacion UNIQUE (id, asignacion_practica_id);
ALTER TABLE evaluaciones ADD COLUMN bitacora_id uuid;
UPDATE evaluaciones ev SET bitacora_id = b.id FROM bitacoras b WHERE b.asignacion_practica_id = ev.asignacion_practica_id AND b.eliminado_en IS NULL;
ALTER TABLE evaluaciones ADD CONSTRAINT fk_evaluaciones_bitacora_asignacion
  FOREIGN KEY (bitacora_id, asignacion_practica_id) REFERENCES bitacoras (id, asignacion_practica_id) ON DELETE RESTRICT;
CREATE INDEX ix_evaluaciones_bitacora ON evaluaciones (bitacora_id) WHERE eliminado_en IS NULL;

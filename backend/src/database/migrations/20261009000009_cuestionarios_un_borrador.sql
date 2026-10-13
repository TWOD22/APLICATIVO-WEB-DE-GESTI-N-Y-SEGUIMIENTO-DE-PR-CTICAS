-- Up Migration

-- MIGRACIÓN 9 · Índices: un solo borrador de cuestionario por nivel y búsqueda rápida de respuestas por bitácora.
-- Un solo borrador de cuestionario por nivel: evita versiones en edición en paralelo.
-- Al publicarlo (publicado = true) el nivel queda libre para crear la siguiente versión.
CREATE UNIQUE INDEX uq_cuestionarios_borrador_nivel ON cuestionarios (nivel_practica_id)
  WHERE NOT publicado AND eliminado_en IS NULL;

-- Las respuestas de una bitácora se consultan siempre por bitácora.
CREATE INDEX ix_respuestas_bitacora ON respuestas_bitacora (bitacora_id) WHERE eliminado_en IS NULL;

-- Down Migration

DROP INDEX IF EXISTS ix_respuestas_bitacora;
DROP INDEX IF EXISTS uq_cuestionarios_borrador_nivel;

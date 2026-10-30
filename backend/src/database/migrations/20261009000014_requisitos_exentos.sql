-- Up Migration

-- MIGRACIÓN 14 · Prácticas en curso exentas de un documento obligatorio nuevo.
-- Cuando el Director vuelve obligatorio un documento, por defecto solo se exige a quienes aún no tienen su expediente
-- aprobado. Las prácticas que ya van más adelante quedan registradas aquí como exentas de ese requisito concreto.
CREATE TABLE requisitos_exentos (
  requisito_id          uuid NOT NULL REFERENCES requisitos_documentales (id) ON DELETE CASCADE,
  asignacion_practica_id uuid NOT NULL REFERENCES asignaciones_practica (id) ON DELETE CASCADE,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requisito_id, asignacion_practica_id)
);
CREATE INDEX ix_requisitos_exentos_asignacion ON requisitos_exentos (asignacion_practica_id);

-- Down Migration

DROP TABLE IF EXISTS requisitos_exentos;

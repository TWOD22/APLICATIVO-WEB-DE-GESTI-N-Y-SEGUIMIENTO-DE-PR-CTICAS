-- Up Migration

-- MIGRACIÓN 11 · Nuevos estados de la práctica para el flujo de solicitud (v2).
-- El estudiante solicita la práctica: BORRADOR -> ENVIADA -> (DEVUELTA <-> ENVIADA) -> DOCUMENTOS_APROBADOS
-- -> PLAZA_SELECCIONADA -> ACTIVA. El Director puede cerrar la solicitud como RECHAZADA.
-- Los valores existentes (PENDIENTE_DOCUMENTOS, ACTIVA, PENDIENTE_EVALUACION, FINALIZADA, CANCELADA) se conservan:
-- PENDIENTE_DOCUMENTOS queda para las asignaciones manuales (excepción del Director).
-- IMPORTANTE: PostgreSQL no permite USAR un valor de enum en la misma transacción que lo agrega;
-- por eso esta migración solo agrega los valores y la migración 12 los utiliza.
ALTER TYPE estado_asignacion ADD VALUE IF NOT EXISTS 'BORRADOR';
ALTER TYPE estado_asignacion ADD VALUE IF NOT EXISTS 'ENVIADA';
ALTER TYPE estado_asignacion ADD VALUE IF NOT EXISTS 'DEVUELTA';
ALTER TYPE estado_asignacion ADD VALUE IF NOT EXISTS 'DOCUMENTOS_APROBADOS';
ALTER TYPE estado_asignacion ADD VALUE IF NOT EXISTS 'PLAZA_SELECCIONADA';
ALTER TYPE estado_asignacion ADD VALUE IF NOT EXISTS 'RECHAZADA';

-- Reversión: PostgreSQL no permite quitar valores de un enum. Es un cambio compatible hacia atrás
-- (los valores sobrantes no estorban), por lo que la reversión no hace nada a propósito.
-- Down Migration

SELECT 1;

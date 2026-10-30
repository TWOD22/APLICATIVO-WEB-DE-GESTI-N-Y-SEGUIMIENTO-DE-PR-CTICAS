-- Up Migration

-- MIGRACIÓN 13 · Un solo rol por usuario.
-- Decisión de producto: cada persona tiene un único rol (Director, Estudiante, Docente Supervisor o Asesor de Sitio).
-- Si ya existen usuarios con más de un rol vigente, la migración se detiene para que se corrija a mano
-- (decide con qué rol se queda cada uno y marca el otro como eliminado) en lugar de borrar datos por su cuenta.
DO $$
DECLARE
  repetidos text;
BEGIN
  SELECT string_agg(u.correo_institucional, ', ') INTO repetidos
    FROM usuarios u
   WHERE (SELECT count(*) FROM usuarios_roles ur WHERE ur.usuario_id = u.id AND ur.eliminado_en IS NULL) > 1;
  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay usuarios con más de un rol: %. Deja un solo rol por usuario antes de migrar.', repetidos;
  END IF;
END $$;

CREATE UNIQUE INDEX uq_usuarios_roles_un_rol ON usuarios_roles (usuario_id) WHERE eliminado_en IS NULL;

-- Down Migration

DROP INDEX IF EXISTS uq_usuarios_roles_un_rol;

-- Up Migration

-- MIGRACIÓN 15 · Limpieza del modelo: quita rutas dobles que repetían un mismo dato.
--
-- 1) usuarios_programas: decía a qué programa pertenece una persona, pero el programa de un estudiante ya consta en su matrícula
--    (matriculas_estudiantes.programa_academico_id) y el personal (Director, docentes, asesores) tiene un único programa posible.
--    Se elimina la tabla: desaparece el triángulo usuarios - programas_academicos - matriculas_estudiantes.
DROP TABLE IF EXISTS usuarios_programas;

-- 2) evaluaciones: apuntaba a la asignación y también a la bitácora (que ya pertenece a una asignación) sin garantizar que
--    coincidieran. Ahora la llave foránea es compuesta (bitácora + asignación): una evaluación solo puede ligarse a una bitácora
--    de su propia asignación. Si bitacora_id es NULL no se comprueba nada (MATCH SIMPLE).
ALTER TABLE bitacoras
  ADD CONSTRAINT uq_bitacoras_id_asignacion UNIQUE (id, asignacion_practica_id);

ALTER TABLE evaluaciones DROP CONSTRAINT IF EXISTS evaluaciones_bitacora_id_fkey;
ALTER TABLE evaluaciones
  ADD CONSTRAINT fk_evaluaciones_bitacora_asignacion
  FOREIGN KEY (bitacora_id, asignacion_practica_id) REFERENCES bitacoras (id, asignacion_practica_id) ON DELETE RESTRICT;

-- Down Migration

ALTER TABLE evaluaciones DROP CONSTRAINT IF EXISTS fk_evaluaciones_bitacora_asignacion;
ALTER TABLE evaluaciones
  ADD CONSTRAINT evaluaciones_bitacora_id_fkey FOREIGN KEY (bitacora_id) REFERENCES bitacoras (id) ON DELETE RESTRICT;
ALTER TABLE bitacoras DROP CONSTRAINT IF EXISTS uq_bitacoras_id_asignacion;

CREATE TABLE usuarios_programas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id            uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  programa_academico_id uuid NOT NULL REFERENCES programas_academicos (id) ON DELETE RESTRICT,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  eliminado_en          timestamptz
);
CREATE UNIQUE INDEX uq_usuarios_programas ON usuarios_programas (usuario_id, programa_academico_id) WHERE eliminado_en IS NULL;
CREATE TRIGGER tg_usuarios_programas_marca_tiempo BEFORE UPDATE ON usuarios_programas
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_marca_tiempo();
-- Se vuelve a vincular a cada persona con su programa: estudiantes por su matrícula; el resto con el programa 'LEI'.
INSERT INTO usuarios_programas (usuario_id, programa_academico_id)
  SELECT DISTINCT estudiante_id, programa_academico_id FROM matriculas_estudiantes WHERE eliminado_en IS NULL;
INSERT INTO usuarios_programas (usuario_id, programa_academico_id)
  SELECT u.id, p.id FROM usuarios u CROSS JOIN programas_academicos p
   WHERE p.codigo = 'LEI' AND u.eliminado_en IS NULL
     AND NOT EXISTS (SELECT 1 FROM usuarios_programas up WHERE up.usuario_id = u.id AND up.eliminado_en IS NULL);

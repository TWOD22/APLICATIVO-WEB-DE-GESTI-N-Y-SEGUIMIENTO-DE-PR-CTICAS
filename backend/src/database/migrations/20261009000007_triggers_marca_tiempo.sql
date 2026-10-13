-- Up Migration

-- MIGRACIÓN 7 · Enlaza el trigger `fn_actualizar_marca_tiempo` a todas las tablas que tengan la columna `actualizado_en`.
-- Se hace con un bloque DO que recorre las tablas existentes; por eso debe ejecutarse después de crearlas todas.
-- Aplica el trigger de actualizado_en a todas las tablas del modelo
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = current_schema()
       AND c.column_name = 'actualizado_en'
       AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER tg_%1$s_marca_tiempo BEFORE UPDATE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION fn_actualizar_marca_tiempo()',
      t.table_name
    );
  END LOOP;
END;
$$;

-- Reversión: elimina esos triggers.
-- Down Migration

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = current_schema()
       AND c.column_name = 'actualizado_en'
       AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tg_%1$s_marca_tiempo ON %1$I', t.table_name);
  END LOOP;
END;
$$;

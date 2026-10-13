-- Pruebas de reglas de integridad del modelo (se ejecutan dentro de una transacción que se revierte).
-- Uso:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/integration/reglas_integridad.sql
-- Requiere migraciones y seed base aplicados. Termina con error si alguna regla no se cumple.
BEGIN;

CREATE FUNCTION pg_temp.debe_fallar(descripcion text, sentencia text, estado_esperado text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sentencia;
  EXCEPTION WHEN OTHERS THEN
    IF estado_esperado IS NOT NULL AND SQLSTATE <> estado_esperado THEN
      RAISE EXCEPTION 'FALLÓ [%]: se esperaba SQLSTATE % y llegó % (%)', descripcion, estado_esperado, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'ok  - %', descripcion;
    RETURN;
  END;
  RAISE EXCEPTION 'FALLÓ [%]: la sentencia debía ser rechazada', descripcion;
END;
$$;

CREATE FUNCTION pg_temp.debe_ser(descripcion text, condicion boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condicion IS NOT TRUE THEN RAISE EXCEPTION 'FALLÓ [%]', descripcion; END IF;
  RAISE NOTICE 'ok  - %', descripcion;
END;
$$;

-- Datos de apoyo
CREATE TEMP TABLE ctx (clave text PRIMARY KEY, valor uuid);

INSERT INTO usuarios (firebase_uid, numero_documento, nombres, apellidos, correo_institucional) VALUES
  ('uid-dir',  '1000000001', 'Dora',  'Directora', 'dir@udi.test'),
  ('uid-doc',  '1000000002', 'Juan',  'Docente',   'doc@udi.test'),
  ('uid-ase',  '1000000003', 'Ana',   'Asesora',   'ase@udi.test'),
  ('uid-ase2', '1000000004', 'Ada',   'Asesora2',  'ase2@udi.test'),
  ('uid-est',  '1000000005', 'Luis',  'Estudiante','est@udi.test'),
  ('uid-est2', '1000000006', 'Lía',   'Estudiante2','est2@udi.test');

INSERT INTO usuarios_roles (usuario_id, rol_id)
SELECT u.id, r.id FROM usuarios u JOIN roles r ON
  (u.firebase_uid = 'uid-dir'  AND r.codigo = 'DIRECTOR_PROGRAMA') OR
  (u.firebase_uid = 'uid-doc'  AND r.codigo = 'DOCENTE_SUPERVISOR') OR
  (u.firebase_uid IN ('uid-ase','uid-ase2') AND r.codigo = 'ASESOR_SITIO') OR
  (u.firebase_uid IN ('uid-est','uid-est2') AND r.codigo = 'ESTUDIANTE');

INSERT INTO instituciones (nombre, nit, ciudad, correo, estado_convenio) VALUES
  ('Jardín Uno', '900000001-1', 'Bucaramanga', 'uno@jardin.test', 'VIGENTE'),
  ('Jardín Dos', '900000002-2', 'Floridablanca', 'dos@jardin.test', 'VIGENTE');

INSERT INTO vinculaciones_asesores (asesor_id, institucion_id, periodo_academico_id)
SELECT a.id, i.id, p.id FROM usuarios a, instituciones i, periodos_academicos p
 WHERE a.firebase_uid = 'uid-ase' AND i.nit = '900000001-1' AND p.estado = 'ACTIVO';
INSERT INTO vinculaciones_asesores (asesor_id, institucion_id, periodo_academico_id)
SELECT a.id, i.id, p.id FROM usuarios a, instituciones i, periodos_academicos p
 WHERE a.firebase_uid = 'uid-ase2' AND i.nit = '900000002-2' AND p.estado = 'ACTIVO';

INSERT INTO matriculas_estudiantes (estudiante_id, programa_academico_id, periodo_academico_id, numero_semestre)
SELECT u.id, pr.id, pe.id, 6 FROM usuarios u, programas_academicos pr, periodos_academicos pe
 WHERE u.firebase_uid IN ('uid-est','uid-est2') AND pr.codigo = 'LEI' AND pe.estado = 'ACTIVO';

INSERT INTO ctx
SELECT 'est_mat', m.id FROM matriculas_estudiantes m JOIN usuarios u ON u.id = m.estudiante_id WHERE u.firebase_uid = 'uid-est'
UNION ALL SELECT 'est2_mat', m.id FROM matriculas_estudiantes m JOIN usuarios u ON u.id = m.estudiante_id WHERE u.firebase_uid = 'uid-est2'
UNION ALL SELECT 'nivel', id FROM niveles_practica WHERE codigo = 'PP1'
UNION ALL SELECT 'nivel2', id FROM niveles_practica WHERE codigo = 'PP2'
UNION ALL SELECT 'inst1', id FROM instituciones WHERE nit = '900000001-1'
UNION ALL SELECT 'inst2', id FROM instituciones WHERE nit = '900000002-2'
UNION ALL SELECT 'doc', id FROM usuarios WHERE firebase_uid = 'uid-doc'
UNION ALL SELECT 'ase', id FROM usuarios WHERE firebase_uid = 'uid-ase'
UNION ALL SELECT 'ase2', id FROM usuarios WHERE firebase_uid = 'uid-ase2'
UNION ALL SELECT 'est', id FROM usuarios WHERE firebase_uid = 'uid-est'
UNION ALL SELECT 'dir', id FROM usuarios WHERE firebase_uid = 'uid-dir';

CREATE FUNCTION pg_temp.v(clave text) RETURNS uuid LANGUAGE sql AS $$ SELECT valor FROM ctx WHERE clave = $1 $$;

-- ===== Usuarios =====
SELECT pg_temp.debe_fallar('documento duplicado', $q$INSERT INTO usuarios (firebase_uid, numero_documento, nombres, apellidos, correo_institucional) VALUES ('x1','1000000001','A','B','otro@udi.test')$q$, '23505');
SELECT pg_temp.debe_fallar('correo duplicado (sin importar mayúsculas)', $q$INSERT INTO usuarios (firebase_uid, numero_documento, nombres, apellidos, correo_institucional) VALUES ('x2','2000000001','A','B','DIR@UDI.TEST')$q$, '23505');
SELECT pg_temp.debe_fallar('correo con formato inválido', $q$INSERT INTO usuarios (firebase_uid, numero_documento, nombres, apellidos, correo_institucional) VALUES ('x3','2000000002','A','B','no-es-correo')$q$, '23514');
SELECT pg_temp.debe_fallar('semestre fuera de 1..8', format($q$INSERT INTO matriculas_estudiantes (estudiante_id, programa_academico_id, periodo_academico_id, numero_semestre) SELECT %L, programa_academico_id, periodo_academico_id, 9 FROM matriculas_estudiantes LIMIT 1$q$, pg_temp.v('dir')), '23514');

-- ===== Vinculaciones y asignaciones =====
SELECT pg_temp.debe_fallar('vincular como asesor a quien no tiene el rol',
  format($q$INSERT INTO vinculaciones_asesores (asesor_id, institucion_id, periodo_academico_id) SELECT %L, %L, id FROM periodos_academicos WHERE estado='ACTIVO'$q$, pg_temp.v('est'), pg_temp.v('inst1')), '23514');

SELECT pg_temp.debe_fallar('asignar asesor de OTRA institución',
  format($q$INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asignada_por_id, asesor_sitio_id) VALUES (%L,%L,%L,%L,%L,%L)$q$,
    pg_temp.v('est_mat'), pg_temp.v('nivel'), pg_temp.v('inst1'), pg_temp.v('doc'), pg_temp.v('dir'), pg_temp.v('ase2')), '23514');
SELECT pg_temp.debe_fallar('asignar como docente a quien no tiene el rol',
  format($q$INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asignada_por_id) VALUES (%L,%L,%L,%L,%L)$q$,
    pg_temp.v('est_mat'), pg_temp.v('nivel'), pg_temp.v('inst1'), pg_temp.v('est'), pg_temp.v('dir')), '23514');

UPDATE instituciones SET activa = false WHERE nit = '900000002-2';
SELECT pg_temp.debe_fallar('asignar a institución inactiva',
  format($q$INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asignada_por_id) VALUES (%L,%L,%L,%L,%L)$q$,
    pg_temp.v('est_mat'), pg_temp.v('nivel'), pg_temp.v('inst2'), pg_temp.v('doc'), pg_temp.v('dir')), '23514');
UPDATE instituciones SET activa = true WHERE nit = '900000002-2';

INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asignada_por_id, asesor_sitio_id)
VALUES (pg_temp.v('est_mat'), pg_temp.v('nivel'), pg_temp.v('inst1'), pg_temp.v('doc'), pg_temp.v('dir'), pg_temp.v('ase'));
SELECT pg_temp.debe_ser('asignación válida creada en PENDIENTE_DOCUMENTOS',
  (SELECT estado = 'PENDIENTE_DOCUMENTOS' FROM asignaciones_practica WHERE matricula_estudiante_id = pg_temp.v('est_mat')));
SELECT pg_temp.debe_fallar('segunda práctica activa en el mismo periodo',
  format($q$INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asignada_por_id) VALUES (%L,%L,%L,%L,%L)$q$,
    pg_temp.v('est_mat'), pg_temp.v('nivel2'), pg_temp.v('inst1'), pg_temp.v('doc'), pg_temp.v('dir')), '23505');
SELECT pg_temp.debe_fallar('reasignar a asesor de otra institución',
  format($q$UPDATE asignaciones_practica SET asesor_sitio_id = %L WHERE matricula_estudiante_id = %L$q$, pg_temp.v('ase2'), pg_temp.v('est_mat')), '23514');
SELECT pg_temp.debe_fallar('fechas de asignación invertidas',
  format($q$UPDATE asignaciones_practica SET fecha_inicio='2026-09-01', fecha_fin='2026-08-01' WHERE matricula_estudiante_id = %L$q$, pg_temp.v('est_mat')), '23514');

-- Una asignación cancelada libera al estudiante para una nueva
SELECT pg_temp.debe_fallar('cancelar sin motivo',
  format($q$UPDATE asignaciones_practica SET estado = 'CANCELADA' WHERE matricula_estudiante_id = %L$q$, pg_temp.v('est_mat')), '23514');
UPDATE asignaciones_practica SET estado = 'CANCELADA', motivo_cancelacion = 'Prueba de integridad' WHERE matricula_estudiante_id = pg_temp.v('est_mat');
INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asignada_por_id)
VALUES (pg_temp.v('est_mat'), pg_temp.v('nivel'), pg_temp.v('inst1'), pg_temp.v('doc'), pg_temp.v('dir'));
SELECT pg_temp.debe_ser('tras cancelar se puede crear otra asignación', (SELECT count(*) = 2 FROM asignaciones_practica WHERE matricula_estudiante_id = pg_temp.v('est_mat')));

CREATE TEMP TABLE asig AS SELECT id FROM asignaciones_practica WHERE matricula_estudiante_id = pg_temp.v('est_mat') AND estado <> 'CANCELADA';
CREATE FUNCTION pg_temp.asig() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM asig $$;

-- ===== Documentos legales =====
INSERT INTO archivos (bucket, ruta_almacenamiento, nombre_original, tipo_mime, tamano_bytes, subido_por_id)
VALUES ('bucket-test', 'documentos_legales/p/e/t/a1.pdf', 'cedula.pdf', 'application/pdf', 1000, pg_temp.v('est')),
       ('bucket-test', 'documentos_legales/p/e/t/a2.pdf', 'cedula2.pdf', 'application/pdf', 1000, pg_temp.v('est'));
SELECT pg_temp.debe_fallar('archivo con URL pública como ruta',
  format($q$INSERT INTO archivos (bucket, ruta_almacenamiento, nombre_original, tipo_mime, tamano_bytes, subido_por_id) VALUES ('bucket-test','https://storage.example/x.pdf','x.pdf','application/pdf',1,%L)$q$, pg_temp.v('est')), '23514');
SELECT pg_temp.debe_fallar('ruta de archivo duplicada',
  format($q$INSERT INTO archivos (bucket, ruta_almacenamiento, nombre_original, tipo_mime, tamano_bytes, subido_por_id) VALUES ('bucket-test','documentos_legales/p/e/t/a1.pdf','x.pdf','application/pdf',1,%L)$q$, pg_temp.v('est')), '23505');

INSERT INTO documentos_legales_estudiantes (asignacion_practica_id, tipo_documento_legal_id, archivo_id)
SELECT pg_temp.asig(), t.id, a.id FROM tipos_documento_legal t, archivos a WHERE t.codigo = 'CEDULA' AND a.nombre_original = 'cedula.pdf';
SELECT pg_temp.debe_fallar('dos versiones actuales del mismo documento',
  format($q$INSERT INTO documentos_legales_estudiantes (asignacion_practica_id, tipo_documento_legal_id, archivo_id, numero_version) SELECT %L, t.id, a.id, 2 FROM tipos_documento_legal t, archivos a WHERE t.codigo='CEDULA' AND a.nombre_original='cedula2.pdf'$q$, pg_temp.asig()), '23505');
SELECT pg_temp.debe_fallar('rechazar documento sin observación',
  $q$UPDATE documentos_legales_estudiantes SET estado = 'POR_CORREGIR'$q$, '23514');
UPDATE documentos_legales_estudiantes SET estado = 'POR_CORREGIR', observacion_revision = 'Ilegible';
SELECT pg_temp.debe_ser('rechazo con observación aceptado', (SELECT estado = 'POR_CORREGIR' FROM documentos_legales_estudiantes));

-- ===== Cuestionarios =====
INSERT INTO cuestionarios (nivel_practica_id, creado_por_id, numero_version, titulo) VALUES (pg_temp.v('nivel'), pg_temp.v('dir'), 1, 'PP1 v1');
SELECT pg_temp.debe_fallar('habilitar un cuestionario sin publicar',
  $q$UPDATE cuestionarios SET habilitado = true$q$, '23514');
INSERT INTO preguntas (cuestionario_id, tipo, enunciado, orden_visual)
SELECT id, 'CERRADA_UNICA', '¿Nivel de participación?', 1 FROM cuestionarios;
INSERT INTO opciones_pregunta (pregunta_id, etiqueta, valor, orden_visual)
SELECT id, 'Alto', 'alto', 1 FROM preguntas;
UPDATE cuestionarios SET publicado = true, publicado_en = now(), habilitado = true;
SELECT pg_temp.debe_fallar('agregar pregunta a cuestionario publicado',
  $q$INSERT INTO preguntas (cuestionario_id, tipo, enunciado, orden_visual) SELECT id, 'ABIERTA', 'Otra', 2 FROM cuestionarios$q$, '23514');
SELECT pg_temp.debe_fallar('editar opción de cuestionario publicado',
  $q$UPDATE opciones_pregunta SET etiqueta = 'Muy alto'$q$, '23514');
SELECT pg_temp.debe_fallar('borrar lógicamente pregunta de cuestionario publicado',
  $q$UPDATE preguntas SET eliminado_en = now()$q$, '23514');
INSERT INTO cuestionarios (nivel_practica_id, creado_por_id, numero_version, titulo, publicado, publicado_en, habilitado)
VALUES (pg_temp.v('nivel'), pg_temp.v('dir'), 2, 'PP1 v2', true, now(), false);
SELECT pg_temp.debe_fallar('dos cuestionarios habilitados en el mismo nivel',
  $q$UPDATE cuestionarios SET habilitado = true WHERE numero_version = 2$q$, '23505');

-- ===== Bitácora y respuestas =====
INSERT INTO bitacoras (asignacion_practica_id, cuestionario_id, estado)
SELECT pg_temp.asig(), id, 'BORRADOR' FROM cuestionarios WHERE numero_version = 1;
SELECT pg_temp.debe_fallar('segunda bitácora para la misma asignación',
  format($q$INSERT INTO bitacoras (asignacion_practica_id) VALUES (%L)$q$, pg_temp.asig()), '23505');
SELECT pg_temp.debe_fallar('bitácora enviada sin fecha de envío',
  $q$UPDATE bitacoras SET estado = 'ENVIADA'$q$, '23514');

INSERT INTO respuestas_bitacora (bitacora_id, pregunta_id)
SELECT b.id, p.id FROM bitacoras b, preguntas p;
INSERT INTO respuestas_opciones (respuesta_bitacora_id, opcion_pregunta_id)
SELECT r.id, o.id FROM respuestas_bitacora r, opciones_pregunta o;
SELECT pg_temp.debe_ser('respuesta de opción válida aceptada', (SELECT count(*) = 1 FROM respuestas_opciones));

-- pregunta de otro cuestionario (v2) respondida en la bitácora que usa v1
CREATE TEMP TABLE pregunta_ajena AS
  SELECT p.id FROM preguntas p JOIN cuestionarios c ON c.id = p.cuestionario_id WHERE c.numero_version = 1 LIMIT 1;
UPDATE cuestionarios SET publicado = false, habilitado = false WHERE numero_version = 2;
INSERT INTO preguntas (cuestionario_id, tipo, enunciado, orden_visual)
SELECT id, 'ABIERTA', 'Pregunta de la v2', 1 FROM cuestionarios WHERE numero_version = 2;
UPDATE cuestionarios SET publicado = true WHERE numero_version = 2;
SELECT pg_temp.debe_fallar('responder una pregunta ajena al cuestionario de la bitácora',
  $q$INSERT INTO respuestas_bitacora (bitacora_id, pregunta_id)
     SELECT b.id, p.id FROM bitacoras b, preguntas p JOIN cuestionarios c ON c.id = p.cuestionario_id
      WHERE c.numero_version = 2$q$, '23514');

-- ===== Evaluaciones =====
CREATE TEMP TABLE bit AS SELECT id FROM bitacoras;
CREATE FUNCTION pg_temp.bit() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM bit $$;

INSERT INTO evaluaciones (asignacion_practica_id, bitacora_id, evaluador_id, tipo_evaluador)
VALUES (pg_temp.asig(), pg_temp.bit(), pg_temp.v('doc'), 'DOCENTE_SUPERVISOR'),
       (pg_temp.asig(), pg_temp.bit(), pg_temp.v('ase'), 'ASESOR_SITIO');
SELECT pg_temp.debe_fallar('segunda evaluación del mismo tipo para la asignación',
  format($q$INSERT INTO evaluaciones (asignacion_practica_id, bitacora_id, evaluador_id, tipo_evaluador) VALUES (%L,%L,%L,'DOCENTE_SUPERVISOR')$q$, pg_temp.asig(), pg_temp.bit(), pg_temp.v('doc')), '23505');
SELECT pg_temp.debe_fallar('nota mayor a 5', $q$UPDATE evaluaciones SET nota = 5.5 WHERE tipo_evaluador = 'ASESOR_SITIO'$q$, '23514');
SELECT pg_temp.debe_fallar('nota negativa', $q$UPDATE evaluaciones SET nota = -0.1 WHERE tipo_evaluador = 'ASESOR_SITIO'$q$, '23514');
SELECT pg_temp.debe_fallar('publicar sin nota', $q$UPDATE evaluaciones SET estado = 'PUBLICADA', publicada_en = now() WHERE tipo_evaluador = 'ASESOR_SITIO'$q$, '23514');

UPDATE evaluaciones SET nota = 4.5, estado = 'PUBLICADA', publicada_en = now() WHERE tipo_evaluador = 'DOCENTE_SUPERVISOR';
UPDATE evaluaciones SET nota = 3.8, estado = 'PUBLICADA', publicada_en = now() WHERE tipo_evaluador = 'ASESOR_SITIO';
SELECT pg_temp.debe_ser('las dos notas son independientes (sin promedio)',
  (SELECT count(DISTINCT nota) = 2 FROM evaluaciones));
SELECT pg_temp.debe_fallar('modificar nota publicada', $q$UPDATE evaluaciones SET nota = 5 WHERE tipo_evaluador = 'DOCENTE_SUPERVISOR'$q$, '23514');
UPDATE evaluaciones SET estado = 'BORRADOR' WHERE tipo_evaluador = 'DOCENTE_SUPERVISOR';
UPDATE evaluaciones SET nota = 4.7 WHERE tipo_evaluador = 'DOCENTE_SUPERVISOR';
SELECT pg_temp.debe_ser('tras reabrir sí se puede editar', (SELECT nota = 4.70 FROM evaluaciones WHERE tipo_evaluador = 'DOCENTE_SUPERVISOR'));

-- ===== Borrado físico restringido y marca de tiempo =====
SELECT pg_temp.debe_fallar('borrado físico de un usuario con asignaciones', format($q$DELETE FROM usuarios WHERE id = %L$q$, pg_temp.v('doc')), '23503');
UPDATE usuarios SET actualizado_en = '2000-01-01' WHERE firebase_uid = 'uid-dir';
UPDATE usuarios SET telefono = '3001234567' WHERE firebase_uid = 'uid-dir';
SELECT pg_temp.debe_ser('trigger de marca de tiempo recalcula actualizado_en',
  (SELECT actualizado_en > now() - interval '1 minute' FROM usuarios WHERE firebase_uid = 'uid-dir'));

ROLLBACK;
\echo 'TODAS LAS REGLAS DE INTEGRIDAD SE CUMPLEN'

-- Pruebas de reglas de integridad del flujo de solicitud v2 (se ejecutan dentro de una transacción que se revierte).
-- Uso:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/integration/reglas_flujo_solicitud.sql
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

-- ===== Docente por nivel y periodo =====
INSERT INTO ctx SELECT 'periodo', id FROM periodos_academicos WHERE estado = 'ACTIVO';
INSERT INTO ctx SELECT 'doc2', id FROM usuarios WHERE firebase_uid = 'uid-ase';

INSERT INTO docentes_niveles (docente_id, nivel_practica_id, periodo_academico_id, asignado_por_id)
VALUES (pg_temp.v('doc'), pg_temp.v('nivel'), pg_temp.v('periodo'), pg_temp.v('dir'));
INSERT INTO docentes_niveles (docente_id, nivel_practica_id, periodo_academico_id, asignado_por_id)
VALUES (pg_temp.v('doc'), pg_temp.v('nivel2'), pg_temp.v('periodo'), pg_temp.v('dir'));
SELECT pg_temp.debe_ser('un docente puede tener varios niveles', (SELECT count(*) = 2 FROM docentes_niveles WHERE docente_id = pg_temp.v('doc')));
SELECT pg_temp.debe_fallar('dos docentes en el mismo nivel y periodo',
  format($q$INSERT INTO docentes_niveles (docente_id, nivel_practica_id, periodo_academico_id, asignado_por_id) VALUES (%L,%L,%L,%L)$q$,
    pg_temp.v('doc'), pg_temp.v('nivel'), pg_temp.v('periodo'), pg_temp.v('dir')), '23505');
SELECT pg_temp.debe_fallar('asignar a un nivel a quien no es docente',
  format($q$INSERT INTO docentes_niveles (docente_id, nivel_practica_id, periodo_academico_id, asignado_por_id) SELECT %L, id, %L, %L FROM niveles_practica WHERE codigo = 'PP3'$q$,
    pg_temp.v('est'), pg_temp.v('periodo'), pg_temp.v('dir')), '23514');
UPDATE docentes_niveles SET eliminado_en = now() WHERE nivel_practica_id = pg_temp.v('nivel2');
SELECT pg_temp.debe_ser('al quitar el docente del nivel queda libre para otro',
  (SELECT count(*) = 1 FROM docentes_niveles WHERE eliminado_en IS NULL));

-- ===== Solicitud de práctica (sin plaza ni docente) =====
INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, solicitada_por_id, estado)
VALUES (pg_temp.v('est_mat'), pg_temp.v('nivel'), pg_temp.v('est'), 'BORRADOR');
SELECT pg_temp.debe_ser('una solicitud puede existir sin plaza, docente ni quien asigna',
  (SELECT institucion_id IS NULL AND docente_supervisor_id IS NULL AND asignada_por_id IS NULL
     FROM asignaciones_practica WHERE matricula_estudiante_id = pg_temp.v('est_mat')));
SELECT pg_temp.debe_fallar('segunda solicitud abierta del mismo estudiante',
  format($q$INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, estado) VALUES (%L,%L,'BORRADOR')$q$,
    pg_temp.v('est_mat'), pg_temp.v('nivel2')), '23505');

UPDATE instituciones SET activa = false WHERE nit = '900000002-2';
SELECT pg_temp.debe_fallar('plaza elegida en una institución inactiva (solicitada)',
  format($q$UPDATE asignaciones_practica SET institucion_solicitada_id = %L, estado = 'PLAZA_SELECCIONADA' WHERE matricula_estudiante_id = %L$q$,
    pg_temp.v('inst2'), pg_temp.v('est_mat')), '23514');
UPDATE instituciones SET activa = true WHERE nit = '900000002-2';

SELECT pg_temp.debe_fallar('PLAZA_SELECCIONADA sin plaza elegida',
  format($q$UPDATE asignaciones_practica SET estado = 'PLAZA_SELECCIONADA' WHERE matricula_estudiante_id = %L$q$, pg_temp.v('est_mat')), '23514');
UPDATE asignaciones_practica SET institucion_solicitada_id = pg_temp.v('inst1'), estado = 'PLAZA_SELECCIONADA'
 WHERE matricula_estudiante_id = pg_temp.v('est_mat');
SELECT pg_temp.debe_fallar('ACTIVA sin plaza definida por el Director',
  format($q$UPDATE asignaciones_practica SET estado = 'ACTIVA' WHERE matricula_estudiante_id = %L$q$, pg_temp.v('est_mat')), '23514');
SELECT pg_temp.debe_fallar('asesor sin plaza definida',
  format($q$UPDATE asignaciones_practica SET asesor_sitio_id = %L WHERE matricula_estudiante_id = %L$q$, pg_temp.v('ase'), pg_temp.v('est_mat')), '23514');
SELECT pg_temp.debe_fallar('Director cambia la plaza sin dejar motivo',
  format($q$UPDATE asignaciones_practica SET institucion_id = %L WHERE matricula_estudiante_id = %L$q$, pg_temp.v('inst2'), pg_temp.v('est_mat')), '23514');
UPDATE asignaciones_practica SET institucion_id = pg_temp.v('inst2'), motivo_cambio_plaza = 'Mejor cercanía al estudiante',
  plaza_validada_por_id = pg_temp.v('dir'), plaza_validada_en = now() WHERE matricula_estudiante_id = pg_temp.v('est_mat');
SELECT pg_temp.debe_fallar('asesor de otra institución distinta a la plaza definida',
  format($q$UPDATE asignaciones_practica SET asesor_sitio_id = %L WHERE matricula_estudiante_id = %L$q$, pg_temp.v('ase'), pg_temp.v('est_mat')), '23514');
UPDATE asignaciones_practica SET asesor_sitio_id = pg_temp.v('ase2'), docente_supervisor_id = pg_temp.v('doc'),
  asignada_por_id = pg_temp.v('dir'), estado = 'ACTIVA' WHERE matricula_estudiante_id = pg_temp.v('est_mat');
SELECT pg_temp.debe_ser('confirmar y asignar deja la práctica ACTIVA',
  (SELECT estado = 'ACTIVA' FROM asignaciones_practica WHERE matricula_estudiante_id = pg_temp.v('est_mat')));

-- ===== Rechazo =====
INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, solicitada_por_id, estado)
VALUES (pg_temp.v('est2_mat'), pg_temp.v('nivel'), pg_temp.v('est'), 'ENVIADA');
SELECT pg_temp.debe_fallar('rechazar sin motivo',
  format($q$UPDATE asignaciones_practica SET estado = 'RECHAZADA' WHERE matricula_estudiante_id = %L$q$, pg_temp.v('est2_mat')), '23514');
UPDATE asignaciones_practica SET estado = 'RECHAZADA', motivo_rechazo = 'No cumple requisitos' WHERE matricula_estudiante_id = pg_temp.v('est2_mat');
INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, solicitada_por_id, estado)
VALUES (pg_temp.v('est2_mat'), pg_temp.v('nivel'), pg_temp.v('est'), 'BORRADOR');
SELECT pg_temp.debe_ser('tras un rechazo el estudiante puede volver a solicitar',
  (SELECT count(*) = 2 FROM asignaciones_practica WHERE matricula_estudiante_id = pg_temp.v('est2_mat')));

-- ===== Historial de correcciones =====
INSERT INTO evaluaciones (asignacion_practica_id, evaluador_id, tipo_evaluador, nota, estado, publicada_en)
SELECT id, pg_temp.v('doc'), 'DOCENTE_SUPERVISOR', 4.0, 'PUBLICADA', now() FROM asignaciones_practica WHERE matricula_estudiante_id = pg_temp.v('est_mat');
INSERT INTO evaluaciones_historial (evaluacion_id, version, nota, motivo, corregida_por_id)
SELECT id, 1, 4.0, 'Nota original', pg_temp.v('doc') FROM evaluaciones;
SELECT pg_temp.debe_fallar('repetir la versión del historial',
  format($q$INSERT INTO evaluaciones_historial (evaluacion_id, version, nota, corregida_por_id) SELECT id, 1, 4.2, %L FROM evaluaciones$q$, pg_temp.v('doc')), '23505');
SELECT pg_temp.debe_fallar('nota del historial fuera de 0..5',
  format($q$INSERT INTO evaluaciones_historial (evaluacion_id, version, nota, corregida_por_id) SELECT id, 2, 5.5, %L FROM evaluaciones$q$, pg_temp.v('doc')), '23514');
SELECT pg_temp.debe_fallar('modificar el historial', $q$UPDATE evaluaciones_historial SET nota = 5$q$, '23514');
SELECT pg_temp.debe_fallar('borrar el historial', $q$DELETE FROM evaluaciones_historial$q$, '23514');

-- ===== Guía de criterios =====
INSERT INTO archivos (bucket, ruta_almacenamiento, nombre_original, tipo_mime, tamano_bytes, subido_por_id) VALUES
  ('b', 'guias/g1.pdf', 'g1.pdf', 'application/pdf', 10, pg_temp.v('doc')),
  ('b', 'guias/g2.pdf', 'g2.pdf', 'application/pdf', 10, pg_temp.v('doc'));
INSERT INTO guias_criterios (nivel_practica_id, periodo_academico_id, docente_id, archivo_id, version)
SELECT pg_temp.v('nivel'), pg_temp.v('periodo'), pg_temp.v('doc'), id, 1 FROM archivos WHERE ruta_almacenamiento = 'guias/g1.pdf';
SELECT pg_temp.debe_fallar('dos guías vigentes en el mismo nivel y periodo',
  format($q$INSERT INTO guias_criterios (nivel_practica_id, periodo_academico_id, docente_id, archivo_id, version) SELECT %L, %L, %L, id, 2 FROM archivos WHERE ruta_almacenamiento = 'guias/g2.pdf'$q$,
    pg_temp.v('nivel'), pg_temp.v('periodo'), pg_temp.v('doc')), '23505');
UPDATE guias_criterios SET vigente = false;
INSERT INTO guias_criterios (nivel_practica_id, periodo_academico_id, docente_id, archivo_id, version)
SELECT pg_temp.v('nivel'), pg_temp.v('periodo'), pg_temp.v('doc'), id, 2 FROM archivos WHERE ruta_almacenamiento = 'guias/g2.pdf';
SELECT pg_temp.debe_ser('al versionar la guía queda una sola vigente',
  (SELECT count(*) FILTER (WHERE vigente) = 1 AND count(*) = 2 FROM guias_criterios));

-- ===== Outbox =====
INSERT INTO eventos_salientes (tipo, actor_id, entidad_tipo, entidad_id, destinatarios, carga)
VALUES ('practice.assigned', pg_temp.v('dir'), 'asignacion', gen_random_uuid(), '["u1"]', '{"nivel":"PP1"}');
SELECT pg_temp.debe_ser('el evento nace PENDIENTE y sin publicar',
  (SELECT estado = 'PENDIENTE' AND intentos = 0 AND publicado_en IS NULL FROM eventos_salientes));
SELECT pg_temp.debe_fallar('estado de evento inválido', $q$UPDATE eventos_salientes SET estado = 'RARO'$q$, '23514');
SELECT pg_temp.debe_fallar('destinatarios que no son una lista',
  format($q$INSERT INTO eventos_salientes (tipo, entidad_tipo, entidad_id, destinatarios) VALUES ('x','y',gen_random_uuid(),'{}')$q$), '23514');

ROLLBACK;
\echo 'TODAS LAS REGLAS DEL FLUJO DE SOLICITUD SE CUMPLEN'

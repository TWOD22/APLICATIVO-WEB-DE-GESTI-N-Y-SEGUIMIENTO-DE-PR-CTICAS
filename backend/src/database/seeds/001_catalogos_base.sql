-- Datos base idempotentes (seguros de ejecutar varias veces, también en producción).
-- Se ejecuta con `pnpm seed`. Puede correrse varias veces sin duplicar datos (ON CONFLICT).

-- Roles del sistema.
INSERT INTO roles (codigo, nombre, descripcion) VALUES
  ('DIRECTOR_PROGRAMA',  'Director de Programa',  'Administra usuarios, instituciones, asignaciones, cuestionarios y expedientes documentales'),
  ('ESTUDIANTE',         'Estudiante',            'Carga documentos legales, diligencia la bitácora y adjunta evidencias'),
  ('DOCENTE_SUPERVISOR', 'Docente Supervisor',    'Revisa las bitácoras de sus estudiantes y registra la nota académica'),
  ('ASESOR_SITIO',       'Asesor de Sitio',       'Evalúa a los estudiantes asignados a su institución y registra la nota de sitio')
ON CONFLICT (codigo) WHERE eliminado_en IS NULL
  DO UPDATE SET nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion;

-- Programa académico inicial.
INSERT INTO programas_academicos (codigo, nombre, cantidad_semestres) VALUES
  ('LEI', 'Licenciatura en Educación Infantil', 8)
ON CONFLICT (codigo) WHERE eliminado_en IS NULL DO NOTHING;

-- Práctica Pedagógica N se cursa en el semestre N (I = 1.º, II = 2.º, ... VIII = 8.º).
INSERT INTO niveles_practica (programa_academico_id, codigo, nombre, numero_semestre, orden_visual)
SELECT p.id, 'PP' || v.n, 'Práctica Pedagógica ' || v.romano, v.n, v.n
  FROM programas_academicos p
 CROSS JOIN (VALUES
   (1, 'I'), (2, 'II'), (3, 'III'), (4, 'IV'), (5, 'V'), (6, 'VI'), (7, 'VII'), (8, 'VIII')
 ) AS v (n, romano)
WHERE p.codigo = 'LEI' AND p.eliminado_en IS NULL
ON CONFLICT (programa_academico_id, codigo) WHERE eliminado_en IS NULL
  DO UPDATE SET nombre = EXCLUDED.nombre, numero_semestre = EXCLUDED.numero_semestre,
                orden_visual = EXCLUDED.orden_visual;

INSERT INTO tipos_documento_legal (codigo, nombre, tipos_mime_permitidos, tamano_maximo_bytes) VALUES
  ('CEDULA',           'Cédula de ciudadanía', ARRAY['application/pdf'], 10485760),
  ('ARL',              'Afiliación a ARL',     ARRAY['application/pdf'], 10485760),
  ('HOJA_VIDA',        'Hoja de vida',         ARRAY['application/pdf'], 10485760),
  ('CARTA_ACEPTACION', 'Carta de aceptación',  ARRAY['application/pdf'], 10485760)
ON CONFLICT (codigo) WHERE eliminado_en IS NULL DO NOTHING;

-- Los cuatro requisitos documentales aplican a todos los niveles de práctica.
-- Los cuatro requisitos son obligatorios en todos los niveles
INSERT INTO requisitos_documentales (nivel_practica_id, tipo_documento_legal_id, obligatorio, orden_visual)
SELECT n.id, t.id, true,
       CASE t.codigo WHEN 'CEDULA' THEN 1 WHEN 'ARL' THEN 2 WHEN 'HOJA_VIDA' THEN 3 ELSE 4 END
  FROM niveles_practica n
 CROSS JOIN tipos_documento_legal t
 WHERE n.eliminado_en IS NULL AND t.eliminado_en IS NULL
ON CONFLICT (nivel_practica_id, tipo_documento_legal_id) WHERE eliminado_en IS NULL DO NOTHING;

-- Periodo activo inicial (solo si todavía no existe uno activo)
INSERT INTO periodos_academicos (codigo, nombre, fecha_inicio, fecha_fin, estado)
SELECT '2026-2', 'Periodo académico 2026-2', DATE '2026-07-20', DATE '2026-12-05', 'ACTIVO'
 WHERE NOT EXISTS (SELECT 1 FROM periodos_academicos WHERE estado = 'ACTIVO' AND eliminado_en IS NULL)
ON CONFLICT (codigo) WHERE eliminado_en IS NULL DO NOTHING;

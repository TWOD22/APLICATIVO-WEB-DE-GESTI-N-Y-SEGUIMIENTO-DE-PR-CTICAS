// Pruebas CRUD de las tablas básicas. Todo se ejecuta en UNA transacción que termina en ROLLBACK:
// no deja datos de prueba en la base. "Borrar" = eliminación lógica (eliminado_en).
// Uso (desde la carpeta backend):  node scripts/pruebas-crud.mjs
import { cerrarPool, pool } from "../src/config/database.js";

const cliente = await pool.connect();
let aprobadas = 0;
let fallidas = 0;

const titulo = (t) => console.log(`\n==================== ${t} ====================`);
async function paso(operacion, sql, params = []) {
  const { rows } = await cliente.query(sql, params);
  console.log(`\n--- ${operacion}`);
  console.table(rows);
  return rows;
}
// Prueba que la base RECHACE el dato (usa SAVEPOINT para no abortar la transacción)
async function debeRechazar(descripcion, sql, params = []) {
  await cliente.query("SAVEPOINT intento");
  try {
    await cliente.query(sql, params);
    await cliente.query("ROLLBACK TO SAVEPOINT intento");
    console.log(`\n✖ FALLO: la base aceptó datos inválidos → ${descripcion}`);
    fallidas += 1;
  } catch (error) {
    await cliente.query("ROLLBACK TO SAVEPOINT intento");
    console.log(`\n✔ OK: la base rechazó → ${descripcion}`);
    console.log(`   Motivo: ${error.message}`);
    aprobadas += 1;
  }
}

try {
  await cliente.query("BEGIN");

  titulo("P1 · programas_academicos");
  await paso("CREAR", `INSERT INTO programas_academicos (codigo, nombre, cantidad_semestres)
    VALUES ('PRUEBA01', 'Programa de prueba', 8) RETURNING codigo, nombre, cantidad_semestres, activo`);
  await paso("LEER", `SELECT codigo, nombre, cantidad_semestres FROM programas_academicos WHERE codigo = 'PRUEBA01'`);
  await paso("ACTUALIZAR", `UPDATE programas_academicos SET nombre = 'Programa de prueba (editado)', cantidad_semestres = 10
    WHERE codigo = 'PRUEBA01' RETURNING codigo, nombre, cantidad_semestres`);
  await paso("BORRAR (lógico)", `UPDATE programas_academicos SET eliminado_en = now() WHERE codigo = 'PRUEBA01'
    RETURNING codigo, eliminado_en IS NOT NULL AS eliminado`);
  await paso("LEER tras borrar (debe dar 0 filas visibles)", `SELECT count(*)::int AS filas_visibles FROM programas_academicos
    WHERE codigo = 'PRUEBA01' AND eliminado_en IS NULL`);

  titulo("P2 · periodos_academicos");
  await paso("CREAR", `INSERT INTO periodos_academicos (codigo, nombre, fecha_inicio, fecha_fin)
    VALUES ('2099-1', 'Periodo de prueba', '2099-01-15', '2099-06-15') RETURNING codigo, nombre, estado`);
  await paso("LEER", `SELECT codigo, nombre, estado FROM periodos_academicos WHERE codigo = '2099-1'`);
  await paso("ACTUALIZAR", `UPDATE periodos_academicos SET estado = 'CERRADO' WHERE codigo = '2099-1' RETURNING codigo, estado`);
  await paso("BORRAR (lógico)", `UPDATE periodos_academicos SET eliminado_en = now() WHERE codigo = '2099-1'
    RETURNING codigo, eliminado_en IS NOT NULL AS eliminado`);
  await debeRechazar("periodo con fecha final anterior a la inicial", `INSERT INTO periodos_academicos
    (codigo, nombre, fecha_inicio, fecha_fin) VALUES ('2099-2', 'Fechas invertidas', '2099-06-15', '2099-01-15')`);

  titulo("P3 · roles");
  await paso("CREAR", `INSERT INTO roles (codigo, nombre, descripcion) VALUES ('ROL_PRUEBA', 'Rol de prueba', 'Solo para pruebas')
    RETURNING codigo, nombre`);
  await paso("LEER", `SELECT codigo, nombre FROM roles WHERE codigo = 'ROL_PRUEBA'`);
  await paso("ACTUALIZAR", `UPDATE roles SET descripcion = 'Descripción editada' WHERE codigo = 'ROL_PRUEBA' RETURNING codigo, descripcion`);
  await paso("BORRAR (lógico)", `UPDATE roles SET eliminado_en = now() WHERE codigo = 'ROL_PRUEBA'
    RETURNING codigo, eliminado_en IS NOT NULL AS eliminado`);
  await debeRechazar("código de rol repetido (ESTUDIANTE)", `INSERT INTO roles (codigo, nombre) VALUES ('ESTUDIANTE', 'Duplicado')`);

  titulo("P4 · instituciones");
  await paso("CREAR", `INSERT INTO instituciones (nombre, nit, ciudad, direccion, correo, telefono)
    VALUES ('Colegio de Prueba', '900000001-1', 'Bucaramanga', 'Calle 1 # 2-3', 'colegio.prueba@example.com', '6070000000')
    RETURNING nombre, nit, estado_convenio, activa`);
  await paso("LEER", `SELECT nombre, nit, ciudad, estado_convenio FROM instituciones WHERE nit = '900000001-1'`);
  await paso("ACTUALIZAR", `UPDATE instituciones SET estado_convenio = 'VIGENTE', fecha_inicio_convenio = '2026-07-01',
    fecha_fin_convenio = '2027-06-30' WHERE nit = '900000001-1'
    RETURNING nombre, estado_convenio, fecha_inicio_convenio, fecha_fin_convenio`);
  await paso("BORRAR (lógico)", `UPDATE instituciones SET activa = false, eliminado_en = now() WHERE nit = '900000001-1'
    RETURNING nombre, activa, eliminado_en IS NOT NULL AS eliminado`);
  await debeRechazar("correo sin formato válido", `INSERT INTO instituciones (nombre, nit, ciudad, correo)
    VALUES ('Colegio malo', '900000002-2', 'Bucaramanga', 'correo-sin-arroba')`);

  titulo("P5 · usuarios y usuarios_roles");
  await paso("CREAR usuario", `INSERT INTO usuarios (firebase_uid, tipo_documento, numero_documento, nombres, apellidos, correo_institucional, telefono)
    VALUES ('uid-prueba-001', 'CC', '1000000001', 'Usuario', 'De Prueba', 'usuario.prueba@udi.edu.co', '3000000000')
    RETURNING nombres, apellidos, correo_institucional, estado`);
  await paso("LEER usuario", `SELECT nombres, apellidos, correo_institucional, estado FROM usuarios WHERE numero_documento = '1000000001'`);
  await paso("ACTUALIZAR usuario", `UPDATE usuarios SET telefono = '3111111111', estado = 'SUSPENDIDO'
    WHERE numero_documento = '1000000001' RETURNING nombres, telefono, estado`);
  await paso("CREAR rol del usuario", `INSERT INTO usuarios_roles (usuario_id, rol_id)
    SELECT u.id, r.id FROM usuarios u, roles r WHERE u.numero_documento = '1000000001' AND r.codigo = 'ESTUDIANTE'
    RETURNING vigente_desde`);
  await paso("LEER usuario con su rol", `SELECT u.nombres, r.codigo AS rol FROM usuarios_roles ur
    JOIN usuarios u ON u.id = ur.usuario_id JOIN roles r ON r.id = ur.rol_id WHERE u.numero_documento = '1000000001'`);
  await paso("BORRAR (lógico)", `UPDATE usuarios SET eliminado_en = now() WHERE numero_documento = '1000000001'
    RETURNING nombres, eliminado_en IS NOT NULL AS eliminado`);
  await cliente.query(`INSERT INTO usuarios (firebase_uid, tipo_documento, numero_documento, nombres, apellidos, correo_institucional)
    VALUES ('uid-prueba-002', 'CC', '1000000002', 'A', 'B', 'a.b@udi.edu.co')`);
  await debeRechazar("documento de identidad repetido", `INSERT INTO usuarios (firebase_uid, tipo_documento, numero_documento, nombres, apellidos, correo_institucional)
    VALUES ('uid-prueba-003', 'CC', '1000000002', 'C', 'D', 'c.d@udi.edu.co')`);

  titulo("P6 · niveles_practica");
  await paso("LEER (datos del seed)", `SELECT n.codigo, n.nombre, n.numero_semestre FROM niveles_practica n
    JOIN programas_academicos p ON p.id = n.programa_academico_id
    WHERE p.codigo = 'LEI' AND n.eliminado_en IS NULL ORDER BY n.orden_visual LIMIT 3`);
  await paso("CREAR", `INSERT INTO niveles_practica (programa_academico_id, codigo, nombre, numero_semestre, orden_visual)
    SELECT id, 'PP_TEST', 'Práctica de prueba', 4, 99 FROM programas_academicos WHERE codigo = 'LEI' AND eliminado_en IS NULL
    RETURNING codigo, nombre, numero_semestre`);
  await paso("ACTUALIZAR", `UPDATE niveles_practica SET nombre = 'Práctica de prueba (editada)' WHERE codigo = 'PP_TEST' RETURNING codigo, nombre`);
  await paso("BORRAR (lógico)", `UPDATE niveles_practica SET eliminado_en = now() WHERE codigo = 'PP_TEST'
    RETURNING codigo, eliminado_en IS NOT NULL AS eliminado`);
  await debeRechazar("número de semestre fuera del rango 1 a 8", `INSERT INTO niveles_practica
    (programa_academico_id, codigo, nombre, numero_semestre, orden_visual)
    SELECT id, 'PP_MALO', 'Semestre 9', 9, 98 FROM programas_academicos WHERE codigo = 'LEI' AND eliminado_en IS NULL`);

  titulo("P7 · tipos_documento_legal");
  await paso("CREAR", `INSERT INTO tipos_documento_legal (codigo, nombre, descripcion) VALUES ('DOC_PRUEBA', 'Documento de prueba', 'Solo pruebas')
    RETURNING codigo, nombre, tipos_mime_permitidos, tamano_maximo_bytes`);
  await paso("LEER", `SELECT codigo, nombre FROM tipos_documento_legal WHERE codigo = 'DOC_PRUEBA'`);
  await paso("ACTUALIZAR", `UPDATE tipos_documento_legal SET tamano_maximo_bytes = 5242880 WHERE codigo = 'DOC_PRUEBA'
    RETURNING codigo, tamano_maximo_bytes`);
  await paso("BORRAR (lógico)", `UPDATE tipos_documento_legal SET eliminado_en = now() WHERE codigo = 'DOC_PRUEBA'
    RETURNING codigo, eliminado_en IS NOT NULL AS eliminado`);

  console.log(`\n==================== RESUMEN ====================`);
  console.log(`Reglas de integridad verificadas: ${aprobadas} aprobadas, ${fallidas} fallidas.`);
} catch (error) {
  console.error("\n✖ La prueba se detuvo por un error:", error.message);
  fallidas += 1;
} finally {
  await cliente.query("ROLLBACK");
  console.log("Se revirtieron todos los cambios (ROLLBACK): la base queda como estaba.");
  cliente.release();
  await cerrarPool();
}
process.exit(fallidas ? 1 : 0);

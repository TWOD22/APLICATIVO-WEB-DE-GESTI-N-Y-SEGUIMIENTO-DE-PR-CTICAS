/**
 * Escenario compartido por las pruebas de integración: Director, instituciones, estudiantes, docentes y asesores,
 * con PostgreSQL real y Firebase/almacenamiento falsos en memoria.
 */
import assert from "node:assert/strict";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "./db.js";
import { crearFirebaseFalso } from "./firebaseFalso.js";

export { hayBaseDePruebas };

// Datos del Director de prueba.
export const DIRECTOR = {
  firebase_uid: "uid-director", documento: "10203040", nombres: "Dora", apellidos: "Directora", correo: "director@udi.test",
};

// Archivos binarios mínimos (PDF, JPG, PNG) para probar cargas sin usar archivos reales.
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
export const pdfDistinto = (n) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${n}\n`, "latin1"), PDF.subarray(9)]);
/** Imágenes mínimas con firma real (inicio y fin válidos). El relleno hace que cada una pese distinto si se pide. */
export const JPG = (relleno = 16) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(relleno, 7), Buffer.from([0xff, 0xd9])]);
export const PNG = (relleno = 16) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(relleno, 3)]);

// Texto de reflexión con suficientes palabras para cumplir el mínimo de la bitácora.
export const REFLEXION_PRUEBA =
  "Hoy acompañé al grupo de transición en una actividad de juego simbólico donde los niños construyeron una tienda con cajas y descubrieron cómo cooperar para repartir los roles del juego.";

// Verifica que una promesa sea rechazada con el estado HTTP y el código de error esperados.
export const rechaza = async (promesa, { estado, codigo }) => {
  await assert.rejects(promesa, (error) => {
    assert.equal(error.estado_http ?? 500, estado, `estado ${error.estado_http}: ${error.message}`);
    if (codigo) assert.equal(error.codigo, codigo);
    return true;
  });
};

/**
 * Escenario completo con PostgreSQL real, Firebase en memoria y almacenamiento en memoria:
 * Director, dos instituciones, estudiantes, docentes y asesores, y utilidades para dejar
 * una práctica con el expediente aprobado (bitácora habilitada).
 */
export async function prepararEscenario() {
  const { pool, cerrarPool } = await import("../../src/config/database.js");
  const { ejecutarSeedBase } = await import("../../src/database/seeds/base.js");
  const { sustituirFirebaseParaPruebas } = await import("../../src/config/firebase.js");
  const { sustituirAlmacenamientoParaPruebas } = await import("../../src/adapters/storageAdapter.js");
  const auth = await import("../../src/services/authService.js");
  const users = await import("../../src/services/userService.js");
  const insts = await import("../../src/services/institutionService.js");
  const asignaciones = await import("../../src/services/assignmentService.js");
  const documentos = await import("../../src/services/documentService.js");

  const firebase = crearFirebaseFalso();
  sustituirFirebaseParaPruebas(firebase.implementacion);
  const almacen = new Map();
  const eliminados = [];
  sustituirAlmacenamientoParaPruebas({
    subirArchivo: async ({ ruta, contenido }) => {
      almacen.set(ruta, contenido);
      return { bucket: "bucket-test", ruta };
    },
    crearUrlFirmada: async (ruta, { segundos }) => ({ url: `https://storage.test/${ruta}?token=abc`, expira_en_segundos: segundos }),
    eliminarArchivo: async (ruta) => {
      almacen.delete(ruta);
      eliminados.push(ruta);
    },
    descargarArchivo: async (ruta) => almacen.get(ruta),
    almacenamientoDisponible: async () => true,
  });
  await reconstruirEsquema(pool);
  await limpiarYSembrar(pool, ejecutarSeedBase, { director: DIRECTOR });

  const sesion = await auth.resolverSesion(DIRECTOR.firebase_uid, null);
  const dir = sesion.usuario;
  const ctx = {
    actor: { usuario_id: dir.id, firebase_uid: DIRECTOR.firebase_uid, rol_activo: "DIRECTOR_PROGRAMA" },
    direccion_ip: "127.0.0.1", agente_usuario: "pruebas", request_id: "req-fase5",
  };
  const inst = await insts.crear({ nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" }, ctx);
  const inst2 = await insts.crear({ nombre: "Jardín Dos", nit: "900765432-1", ciudad: "Floridablanca", correo: "dos@jardin.test", estado_convenio: "VIGENTE" }, ctx);
  const nuevo = (extra) => users.crear({ telefono: null, ...extra }, ctx);
  const niveles = Object.fromEntries(
    (await pool.query("SELECT id, numero_semestre FROM niveles_practica WHERE numero_semestre IN (1, 2)")).rows.map((n) => [n.numero_semestre, n.id])
  );
  const tipos = Object.fromEntries((await pool.query("SELECT codigo, id FROM tipos_documento_legal")).rows.map((r) => [r.codigo, r.id]));

  const como = (rolActivo, usuario) => ({
    rolActivo,
    usuario: { id: usuario.id, firebase_uid: usuario.firebase_uid },
  });
  const ctxDe = (usuario, rol) => ({ ...ctx, actor: { usuario_id: usuario.id, firebase_uid: usuario.firebase_uid, rol_activo: rol } });
  const firebaseUid = async (usuario) => (await pool.query("SELECT firebase_uid FROM usuarios WHERE id = $1", [usuario.id])).rows[0].firebase_uid;
  /** Crea un usuario y devuelve su identidad con firebase_uid ya resuelto (lo exigen auth y notificaciones). */
  const persona = async (datos) => {
    const creado = await nuevo(datos);
    return { ...creado, firebase_uid: await firebaseUid(creado) };
  };

  const crearAsignacion = (estudiante, extra = {}) =>
    asignaciones.crear(
      {
        estudiante_id: estudiante.id,
        nivel_practica_id: niveles[1],
        institucion_id: inst.id,
        ...extra,
      },
      ctx
    );

  /** Sube los 4 documentos legales y los aprueba: la práctica pasa a ACTIVA y se habilita la bitácora. */
  const habilitarBitacora = async (asignacion, estudiante) => {
    for (const [i, codigo] of ["CEDULA", "ARL", "HOJA_VIDA", "CARTA_ACEPTACION"].entries()) {
      await documentos.subir(
        { asignacionId: asignacion.id, tipoId: tipos[codigo], contenido: pdfDistinto(`${estudiante.id}-${i}`), tipoMime: "application/pdf", nombreArchivo: `${codigo}.pdf` },
        como("ESTUDIANTE", estudiante),
        ctxDe(estudiante, "ESTUDIANTE")
      );
    }
    return documentos.aprobarExpediente(asignacion.id, ctx);
  };

  let contadorEvidencias = 0;
  /**
   * Deja la bitácora ENVIADA: habilita la práctica (si hace falta), sube una evidencia, guarda el borrador y envía.
   * Devuelve el resultado del envío (incluye `bitacora_id` y las dos evaluaciones pendientes).
   */
  const entregarBitacora = async (asignacion, estudiante, { llave = `llave-${estudiante.id}`.slice(0, 40), habilitar = true } = {}) => {
    const bitacoras = await import("../../src/services/logbookService.js");
    const evidencias = await import("../../src/services/evidenceService.js");
    if (habilitar) await habilitarBitacora(asignacion, estudiante);
    const sesion = como("ESTUDIANTE", estudiante);
    const vista = await bitacoras.obtenerDeAsignacion(asignacion.id, sesion);
    await evidencias.subir(
      { bitacoraId: vista.id, contenido: JPG(16 + ++contadorEvidencias), tipoMime: "image/jpeg", nombreArchivo: "foto.jpg" },
      sesion, ctxDe(estudiante, "ESTUDIANTE")
    );
    const guardado = await bitacoras.guardarBorrador(
      vista.id, { revision_base: vista.contenido.revision, reflexion: REFLEXION_PRUEBA, respuestas: [] }, sesion
    );
    return bitacoras.enviar(vista.id, { revision_base: guardado.revision }, llave, sesion, ctxDe(estudiante, "ESTUDIANTE"));
  };

  const eventos = (filtro) => firebase.estado.eventos.filter(filtro);
  const auditoria = (accion) => eventos((e) => e.ruta === "auditoria" && e.accion === accion);
  const avisos = (tipo, uid) =>
    eventos((e) => e.ruta.startsWith("notificaciones_usuario/") && e.tipo === tipo && (!uid || e.ruta.includes(`/${uid}/`)));

  return {
    pool, cerrarPool, firebase, almacen, eliminados, ctx, dir, inst, inst2, niveles, tipos,
    como, ctxDe, persona, crearAsignacion, habilitarBitacora, entregarBitacora, eventos, auditoria, avisos,
    director: () => como("DIRECTOR_PROGRAMA", { id: dir.id, firebase_uid: DIRECTOR.firebase_uid }),
  };
}

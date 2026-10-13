/**
 * Pruebas de los servicios de sesión, instituciones y usuarios contra PostgreSQL real.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hayBaseDePruebas, limpiarYSembrar, reconstruirEsquema } from "../helpers/db.js";
import { crearFirebaseFalso } from "../helpers/firebaseFalso.js";

const DIRECTOR = {
  firebase_uid: "uid-director", documento: "10203040", nombres: "Dora", apellidos: "Directora", correo: "director@udi.test",
};

const rechaza = async (promesa, { estado, codigo }) => {
  await assert.rejects(promesa, (error) => {
    assert.equal(error.estado_http, estado, `estado ${error.estado_http}: ${error.message}`);
    if (codigo) assert.equal(error.codigo, codigo);
    return true;
  });
};

describe("servicios + PostgreSQL real", { skip: !hayBaseDePruebas() && "defina TEST_DATABASE_URL (base cuyo nombre contenga 'test')" }, () => {
  let pool, cerrarPool, auth, users, insts, ctx, firebase, sesionDir, inst1, inst2, est, doc, ase;

  before(async () => {
    ({ pool, cerrarPool } = await import("../../src/config/database.js"));
    const { ejecutarSeedBase } = await import("../../src/database/seeds/base.js");
    const { sustituirFirebaseParaPruebas } = await import("../../src/config/firebase.js");
    auth = await import("../../src/services/authService.js");
    users = await import("../../src/services/userService.js");
    insts = await import("../../src/services/institutionService.js");

    firebase = crearFirebaseFalso();
    sustituirFirebaseParaPruebas(firebase.implementacion);
    await reconstruirEsquema(pool);
    await limpiarYSembrar(pool, ejecutarSeedBase, { director: DIRECTOR });

    sesionDir = await auth.resolverSesion(DIRECTOR.firebase_uid, null);
    ctx = {
      actor: { usuario_id: sesionDir.usuario.id, firebase_uid: DIRECTOR.firebase_uid, rol_activo: "DIRECTOR_PROGRAMA" },
      direccion_ip: "127.0.0.1", agente_usuario: "pruebas", request_id: "req-1",
    };
  });

  after(async () => {
    if (cerrarPool) await cerrarPool();
  });

  describe("sesión y roles", () => {
    it("el rol único se activa solo", () => {
      assert.equal(sesionDir.rolActivo, "DIRECTOR_PROGRAMA");
      const d = auth.describirSesion(sesionDir);
      assert.equal(d.requiere_seleccion_rol, false);
      assert.equal(d.usuario.nombre_completo, "Dora Directora");
    });
    it("rechaza usuarios no registrados y roles no asignados", async () => {
      await rechaza(auth.resolverSesion("uid-fantasma"), { estado: 403, codigo: "USER_NOT_REGISTERED" });
      await rechaza(auth.resolverSesion(DIRECTOR.firebase_uid, "ESTUDIANTE"), { estado: 403, codigo: "ROLE_NOT_ASSIGNED" });
    });
  });

  describe("instituciones", () => {
    it("crea, valida NIT único y fechas de convenio", async () => {
      inst1 = await insts.crear({ nombre: "Jardín Uno", nit: "900123456-7", ciudad: "Bucaramanga", correo: "uno@jardin.test", estado_convenio: "VIGENTE" }, ctx);
      assert.equal(inst1.activa, true);
      assert.equal(inst1.practicas_activas, 0);
      await rechaza(insts.crear({ nombre: "Otro", nit: "900123456-7", ciudad: "X", correo: "x@jardin.test", estado_convenio: "EN_TRAMITE" }, ctx), { estado: 409, codigo: "DUPLICATE_INSTITUTION" });
      await rechaza(
        insts.crear({ nombre: "Otro", nit: "800111222-3", ciudad: "X", correo: "x@jardin.test", estado_convenio: "VIGENTE", convenio_inicio: "2026-05-01", convenio_fin: "2026-01-01" }, ctx),
        { estado: 422, codigo: "INVALID_AGREEMENT_DATES" }
      );
      inst2 = await insts.crear({ nombre: "Jardín Dos", nit: "900999888-1", ciudad: "Floridablanca", correo: "dos@jardin.test", estado_convenio: "EN_TRAMITE" }, ctx);
    });
  });

  describe("usuarios", () => {
    it("crea un estudiante con rol, programa, matrícula, claims, enlace y auditoría", async () => {
      est = await users.crear({ rol: "ESTUDIANTE", documento: "1098000001", nombres: "Luis", apellidos: "Pérez", correo: "luis@udi.test", semestre: 6 }, ctx);
      assert.equal(est.roles[0].codigo, "ESTUDIANTE");
      assert.equal(est.matricula_actual.semestre, 6);
      assert.equal(est.programas[0].codigo, "LEI");
      assert.match(est.enlace_definir_contrasena, /luis%40udi\.test/);
      assert.equal(est.firebase_uid, undefined, "no se expone el UID de Firebase");
      assert.deepEqual([...firebase.estado.claims.values()].at(-1), { roles: ["ESTUDIANTE"] });
      const evento = firebase.estado.eventos.find((e) => e.accion === "USUARIO_CREADO");
      assert.equal(evento.actor_usuario_id, ctx.actor.usuario_id);
      assert.equal(evento.id_solicitud, "req-1");
    });

    it("rechaza documento o correo duplicados (sin importar mayúsculas)", async () => {
      await rechaza(users.crear({ rol: "DOCENTE_SUPERVISOR", documento: "1098000099", nombres: "A", apellidos: "B", correo: "LUIS@udi.test" }, ctx), { estado: 409, codigo: "DUPLICATE_USER" });
      await rechaza(users.crear({ rol: "DOCENTE_SUPERVISOR", documento: "1098000001", nombres: "A", apellidos: "B", correo: "nuevo@udi.test" }, ctx), { estado: 409, codigo: "DUPLICATE_USER" });
    });

    it("crea docente y asesor vinculado a una institución activa", async () => {
      doc = await users.crear({ rol: "DOCENTE_SUPERVISOR", documento: "1098000002", nombres: "Juan", apellidos: "Suárez", correo: "juan@udi.test" }, ctx);
      assert.equal(doc.matricula_actual, null);
      ase = await users.crear({ rol: "ASESOR_SITIO", documento: "1098000003", nombres: "Ana", apellidos: "Gómez", correo: "ana@jardin.test", institucion_id: inst1.id }, ctx);
      assert.equal(ase.vinculaciones_institucionales[0].institucion_nombre, "Jardín Uno");
      await rechaza(
        users.crear({ rol: "ASESOR_SITIO", documento: "1098000004", nombres: "A", apellidos: "B", correo: "x@jardin.test", institucion_id: "11111111-1111-4111-8111-111111111111" }, ctx),
        { estado: 422, codigo: "INSTITUTION_NOT_FOUND" }
      );
    });

    it("si Firebase falla no queda nada en PostgreSQL", async () => {
      firebase.estado.fallar.createUser = true;
      const antes = (await pool.query("SELECT count(*)::int AS n FROM usuarios")).rows[0].n;
      await rechaza(users.crear({ rol: "DOCENTE_SUPERVISOR", documento: "1098000005", nombres: "A", apellidos: "B", correo: "caido@udi.test" }, ctx), { estado: 502, codigo: "FIREBASE_AUTH_ERROR" });
      firebase.estado.fallar.createUser = false;
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM usuarios")).rows[0].n, antes);
    });

    it("si falla la transacción se hace rollback y se elimina la identidad creada", async () => {
      await pool.query("ALTER TABLE matriculas_estudiantes ADD CONSTRAINT zz_fuerza_error CHECK (numero_semestre > 100) NOT VALID");
      const antes = firebase.estado.usuarios.size;
      try {
        await assert.rejects(
          users.crear({ rol: "ESTUDIANTE", documento: "1098000006", nombres: "A", apellidos: "B", correo: "falla@udi.test", semestre: 3 }, ctx),
          (error) => error.code === "23514"
        );
      } finally {
        await pool.query("ALTER TABLE matriculas_estudiantes DROP CONSTRAINT zz_fuerza_error");
      }
      assert.equal(firebase.estado.usuarios.size, antes);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM usuarios WHERE numero_documento = '1098000006'")).rows[0].n, 0);
    });

    it("un fallo al actualizar claims no revierte la creación (queda como advertencia)", async () => {
      firebase.estado.fallar.claims = true;
      const creado = await users.crear({ rol: "DOCENTE_SUPERVISOR", documento: "1098000007", nombres: "Clara", apellidos: "Martínez", correo: "clara@udi.test" }, ctx);
      firebase.estado.fallar.claims = false;
      assert.equal(creado.advertencias.length, 1);
    });

    it("lista con búsqueda, filtros y paginación", async () => {
      assert.equal((await users.listar({ limit: 20, offset: 0 })).total, 5);
      const estudiantes = await users.listar({ rol: "ESTUDIANTE", limit: 20, offset: 0 });
      assert.equal(estudiantes.total, 1);
      assert.equal(estudiantes.filas[0].semestre, 6);
      assert.deepEqual(estudiantes.filas[0].roles, ["ESTUDIANTE"]);
      assert.equal((await users.listar({ q: "suárez", limit: 20, offset: 0 })).total, 1);
      assert.equal((await users.listar({ q: "1098000003", limit: 20, offset: 0 })).filas[0].nombre_completo, "Ana Gómez");
      assert.equal((await users.listar({ q: "%", limit: 20, offset: 0 })).total, 0, "el comodín % es literal");
      assert.equal((await users.listar({ semestre: 6, limit: 20, offset: 0 })).total, 1);
      assert.equal((await users.listar({ estado: "INACTIVO", limit: 20, offset: 0 })).total, 0);
      const pagina = await users.listar({ limit: 2, offset: 2 });
      assert.equal(pagina.filas.length, 2);
      assert.equal(pagina.total, 5);
    });

    it("actualiza sincronizando correo y nombre con Firebase, y compensa si Firebase falla", async () => {
      const upd = await users.actualizar(est.id, { nombres: "Luis Alberto", correo: "luisa@udi.test" }, ctx);
      assert.equal(upd.nombres, "Luis Alberto");
      const fb = [...firebase.estado.usuarios.values()].find((u) => u.email === "luisa@udi.test");
      assert.equal(fb.displayName, "Luis Alberto Pérez");
      await rechaza(users.actualizar(est.id, { correo: "juan@udi.test" }, ctx), { estado: 409 });
      firebase.estado.fallar.updateUser = true;
      await rechaza(users.actualizar(est.id, { correo: "otro@udi.test" }, ctx), { estado: 502 });
      firebase.estado.fallar.updateUser = false;
      assert.equal((await users.obtenerDetalle(est.id)).correo, "luisa@udi.test");
      await rechaza(users.actualizar("22222222-2222-4222-8222-222222222222", { nombres: "X" }, ctx), { estado: 404, codigo: "USER_NOT_FOUND" });
    });

    it("deshabilitar con práctica en curso exige confirmación y bloquea el acceso", async () => {
      const nivel = (await pool.query("SELECT id FROM niveles_practica WHERE codigo = 'PP1'")).rows[0].id;
      const matricula = (await pool.query("SELECT id FROM matriculas_estudiantes WHERE estudiante_id = $1", [est.id])).rows[0].id;
      await pool.query(
        "INSERT INTO asignaciones_practica (matricula_estudiante_id, nivel_practica_id, institucion_id, docente_supervisor_id, asesor_sitio_id, asignada_por_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [matricula, nivel, inst1.id, doc.id, ase.id, ctx.actor.usuario_id]
      );
      await rechaza(users.cambiarEstado(est.id, { estado: "INACTIVO" }, ctx), { estado: 409, codigo: "CONFIRMATION_REQUIRED" });
      await rechaza(users.cambiarEstado(ctx.actor.usuario_id, { estado: "INACTIVO" }, ctx), { estado: 422, codigo: "CANNOT_CHANGE_OWN_STATUS" });

      assert.equal((await users.cambiarEstado(est.id, { estado: "INACTIVO", confirmar: true }, ctx)).estado, "INACTIVO");
      const uid = (await pool.query("SELECT firebase_uid FROM usuarios WHERE id = $1", [est.id])).rows[0].firebase_uid;
      assert.equal(firebase.estado.usuarios.get(uid).disabled, true);
      assert.ok(firebase.estado.revocados.includes(uid));
      await rechaza(auth.resolverSesion(uid), { estado: 403, codigo: "USER_INACTIVE" });

      assert.equal((await users.cambiarEstado(est.id, { estado: "ACTIVO" }, ctx)).estado, "ACTIVO");
      assert.equal(firebase.estado.usuarios.get(uid).disabled, false);
    });

    it("entrega el historial de prácticas del estudiante", async () => {
      const historial = await users.listarPracticas(est.id);
      assert.equal(historial.length, 1);
      assert.equal(historial[0].institucion_nombre, "Jardín Uno");
      assert.equal(historial[0].docente_nombre, "Juan Suárez");
      assert.equal(historial[0].nota_docente, null);
      assert.equal(historial[0].evaluacion_docente_estado, "PENDIENTE");
    });

    it("con varios roles exige elegir contexto y no suma permisos", async () => {
      const rolDocente = (await pool.query("SELECT id FROM roles WHERE codigo = 'DOCENTE_SUPERVISOR'")).rows[0].id;
      await pool.query("INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES ($1, $2)", [sesionDir.usuario.id, rolDocente]);
      const multi = await auth.resolverSesion(DIRECTOR.firebase_uid, null);
      assert.equal(multi.rolActivo, null);
      assert.equal(auth.describirSesion(multi).requiere_seleccion_rol, true);
      assert.equal((await auth.resolverSesion(DIRECTOR.firebase_uid, "DOCENTE_SUPERVISOR")).rolActivo, "DOCENTE_SUPERVISOR");
      await pool.query("UPDATE usuarios_roles SET vigente_desde = current_date - 10, vigente_hasta = current_date - 1 WHERE usuario_id = $1 AND rol_id = $2", [sesionDir.usuario.id, rolDocente]);
      await rechaza(auth.resolverSesion(DIRECTOR.firebase_uid, "DOCENTE_SUPERVISOR"), { estado: 403, codigo: "ROLE_NOT_ASSIGNED" });
    });

    it("el perfil propio solo cambia nombre y teléfono", async () => {
      const perfil = await users.actualizarPerfilPropio(sesionDir.usuario, { telefono: "3001112233" }, ctx);
      assert.equal(perfil.telefono, "3001112233");
    });
  });

  describe("instituciones (listados y estado)", () => {
    it("lista con filtros, incluida la búsqueda por nombre de asesor", async () => {
      let r = await insts.listar({ limit: 20, offset: 0 });
      assert.equal(r.total, 2);
      const uno = r.filas.find((f) => f.nit === "900123456-7");
      assert.equal(uno.asesores_vinculados, 1);
      assert.equal(uno.practicas_activas, 1);
      r = await insts.listar({ q: "Gómez", limit: 20, offset: 0 });
      assert.deepEqual(r.filas.map((f) => f.nombre), ["Jardín Uno"]);
      assert.equal((await insts.listar({ estado_convenio: "EN_TRAMITE", limit: 20, offset: 0 })).total, 1);
      assert.equal((await insts.listar({ activa: false, limit: 20, offset: 0 })).total, 0);
    });

    it("deshabilitar exige confirmación si hay prácticas en curso y bloquea nuevas asignaciones", async () => {
      await rechaza(insts.cambiarEstado(inst1.id, { activa: false }, ctx), { estado: 409, codigo: "CONFIRMATION_REQUIRED" });
      assert.equal((await insts.cambiarEstado(inst2.id, { activa: false }, ctx)).activa, false);
      await rechaza(
        users.crear({ rol: "ASESOR_SITIO", documento: "1098000010", nombres: "A", apellidos: "B", correo: "b@x.test", institucion_id: inst2.id }, ctx),
        { estado: 422, codigo: "INSTITUTION_INACTIVE" }
      );
    });

    it("actualiza y lista estudiantes y asesores vinculados", async () => {
      assert.equal((await insts.actualizar(inst1.id, { ciudad: "Piedecuesta", telefono: null }, ctx)).ciudad, "Piedecuesta");
      const estudiantes = await insts.listarEstudiantes(inst1.id);
      assert.equal(estudiantes.length, 1);
      assert.equal(estudiantes[0].apellidos, "Pérez");
      const asesores = await insts.listarAsesores(inst1.id);
      assert.equal(asesores[0].estudiantes_asignados, 1);
      await rechaza(insts.obtener("33333333-3333-4333-8333-333333333333"), { estado: 404 });
    });
  });
});

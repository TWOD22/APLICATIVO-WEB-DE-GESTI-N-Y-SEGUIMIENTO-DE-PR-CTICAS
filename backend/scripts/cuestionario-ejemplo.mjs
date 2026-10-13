// Crea un cuestionario de EJEMPLO (mezcla de preguntas abiertas, de selección única y de selección múltiple)
// para un nivel de práctica, lo publica y lo deja habilitado. Sirve para probar la bitácora del estudiante.
// Uso:  pnpm cuestionario:ejemplo            -> Práctica Pedagógica I (primer nivel)
//       pnpm cuestionario:ejemplo PP2        -> nivel con ese código (PP1 … PP8 = Práctica Pedagógica I … VIII)
// Si el nivel ya tiene un borrador en edición, no hace nada (termínalo o elimínalo desde la pantalla Cuestionarios).
// Si ya tenía versiones publicadas, crea una versión nueva SIN copiar las anteriores; la anterior queda guardada.
import { cerrarPool, pool } from "../src/config/database.js";
import * as questionnaireService from "../src/services/questionnaireService.js";

const PREGUNTAS = [
  { tipo: "ABIERTA", enunciado: "Describe una experiencia significativa que viviste con los niños esta semana.", obligatoria: true },
  { tipo: "CERRADA_UNICA", enunciado: "¿Cómo calificas tu proceso de adaptación a la institución?", obligatoria: true,
    opciones: ["Excelente", "Buena", "Regular", "Difícil"] },
  { tipo: "CERRADA_MULTIPLE", enunciado: "¿Qué estrategias pedagógicas aplicaste durante la semana?", obligatoria: true,
    opciones: ["Juego dirigido", "Narración de cuentos", "Expresión artística", "Música y movimiento", "Trabajo en grupo"] },
  { tipo: "CERRADA_UNICA", enunciado: "¿Recibiste acompañamiento de tu asesor de sitio esta semana?", obligatoria: true,
    opciones: ["Sí, de forma constante", "Sí, ocasionalmente", "No"] },
  { tipo: "ABIERTA", enunciado: "¿Qué aspecto mejorarías para la próxima semana? (opcional)", obligatoria: false },
];

try {
  const codigo = process.argv[2];
  const { rows: niveles } = await pool.query(
    `SELECT id, codigo, nombre FROM niveles_practica WHERE eliminado_en IS NULL AND ($1::text IS NULL OR codigo = $1) ORDER BY orden_visual LIMIT 1`,
    [codigo ?? null]
  );
  if (!niveles.length) throw new Error(codigo ? `No existe el nivel con código ${codigo}.` : "No hay niveles de práctica sembrados.");
  const nivel = niveles[0];

  const { rows: directores } = await pool.query(
    `SELECT u.id, u.firebase_uid FROM usuarios u
       JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.eliminado_en IS NULL
       JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'DIRECTOR_PROGRAMA'
      WHERE u.eliminado_en IS NULL AND u.estado = 'ACTIVO' ORDER BY u.creado_en LIMIT 1`
  );
  if (!directores.length) throw new Error("No hay un Director activo en la base de datos.");
  const contexto = { actor: { usuario_id: directores[0].id, firebase_uid: directores[0].firebase_uid }, request_id: "script-cuestionario-ejemplo" };

  const creado = await questionnaireService.crear(
    { nivel_practica_id: nivel.id, titulo: `Cuestionario de ejemplo · ${nivel.nombre}`, sin_copia: true },
    contexto
  );
  for (const p of PREGUNTAS) {
    await questionnaireService.agregarPregunta(creado.id, {
      tipo: p.tipo, enunciado: p.enunciado, obligatoria: p.obligatoria,
      opciones: p.opciones?.map((etiqueta) => ({ etiqueta })),
    });
  }
  const publicado = await questionnaireService.publicar(creado.id, contexto);
  console.log(`✔ ${nivel.nombre}: versión ${publicado.numero_version} publicada y habilitada con ${publicado.preguntas.length} preguntas (abiertas, selección única y múltiple).`);
} catch (error) {
  console.error(`✖ ${error.message}`);
  if (error.code === "DRAFT_ALREADY_EXISTS") console.error("  Ese nivel tiene un borrador en edición: publícalo o elimínalo desde la pantalla Cuestionarios.");
  process.exitCode = 1;
} finally {
  await cerrarPool();
}

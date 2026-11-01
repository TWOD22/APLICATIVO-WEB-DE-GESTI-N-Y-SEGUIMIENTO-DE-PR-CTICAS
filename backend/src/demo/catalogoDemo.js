/**
 * Datos de demostración: instituciones, personal, nombres, textos y el reparto de estados de los 30 estudiantes.
 * Todo lo de las PERSONAS es inventado. De las instituciones solo son reales los nombres (NIT, teléfonos, direcciones
 * y correos son inventados). Lo que se crea queda marcado con el dominio DOMINIO_DEMO para poder borrarlo después.
 */

export const DOMINIO_DEMO = "demo.udi.test";
export const CONTRASENA_DEMO = "123456789";
export const MARCA_CUESTIONARIO = "(demostración)";
export const MARCA_PERIODO = "(demostración)";

/** Generador pseudoaleatorio con semilla: la misma semilla produce siempre los mismos datos. */
export function crearAzar(semilla = 20261115) {
  let s = semilla >>> 0;
  const siguiente = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    siguiente,
    entero: (min, max) => min + Math.floor(siguiente() * (max - min + 1)),
    elegir: (lista) => lista[Math.floor(siguiente() * lista.length)],
    mezclar(lista) {
      const copia = [...lista];
      for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(siguiente() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
      }
      return copia;
    },
  };
}

/** Instituciones reales del área de Bucaramanga; NIT, teléfono, dirección y correo son inventados. */
export const INSTITUCIONES = [
  { clave: "pedro_claver", nombre: "Colegio San Pedro Claver", nit: "900412375-1", ciudad: "Bucaramanga", direccion: "Carrera 27 # 38-52", telefono: "607 6341100", estado_convenio: "VIGENTE" },
  { clave: "normal", nombre: "Escuela Normal Superior de Bucaramanga", nit: "900588214-3", ciudad: "Bucaramanga", direccion: "Calle 41 # 27-14", telefono: "607 6451200", estado_convenio: "VIGENTE" },
  { clave: "salesiano", nombre: "Colegio Salesiano Eloy Valenzuela", nit: "900233670-5", ciudad: "Bucaramanga", direccion: "Carrera 15 # 12-30", telefono: "607 6301450", estado_convenio: "VIGENTE" },
  { clave: "bethlemitas", nombre: "Colegio Bethlemitas Bucaramanga", nit: "900671920-8", ciudad: "Bucaramanga", direccion: "Calle 36 # 19-47", telefono: "607 6352218", estado_convenio: "VIGENTE" },
  { clave: "americano", nombre: "Colegio Americano de Bucaramanga", nit: "900345581-2", ciudad: "Bucaramanga", direccion: "Carrera 33 # 52-70", telefono: "607 6470930", estado_convenio: "VIGENTE" },
  { clave: "damaso", nombre: "Instituto Técnico Superior Dámaso Zapata", nit: "900127846-6", ciudad: "Bucaramanga", direccion: "Carrera 21 # 11-25", telefono: "607 6330275", estado_convenio: "VIGENTE" }, // sin asesor a propósito
  { clave: "presentacion", nombre: "Colegio de la Presentación Bucaramanga", nit: "900894407-4", ciudad: "Bucaramanga", direccion: "Calle 34 # 21-30", telefono: "607 6350812", estado_convenio: "EN_TRAMITE" }, // convenio en trámite
];

/** Asesores de sitio (cada persona tiene un solo rol). En `normal` hay dos; la primera (Olga) es la que más practicantes recibe. */
export const ASESORES = [
  { institucion: "pedro_claver", nombres: "Marta Lucía", apellidos: "Quintero Barrera", cargo: "Coordinadora de preescolar" },
  { institucion: "normal", nombres: "Olga Patricia", apellidos: "Serrano Villamizar", cargo: "Coordinadora de práctica pedagógica" },
  { institucion: "salesiano", nombres: "Jorge Eliécer", apellidos: "Navas Cáceres", cargo: "Docente de transición" },
  { institucion: "bethlemitas", nombres: "Sandra Milena", apellidos: "Ortiz Pabón", cargo: "Docente de preescolar" },
  { institucion: "americano", nombres: "Diana Carolina", apellidos: "Lizarazo Mejía", cargo: "Coordinadora académica" },
  { institucion: "normal", nombres: "Luz Marina", apellidos: "Becerra Gómez", cargo: "Docente de preescolar" }, // segunda asesora en la misma institución
];

/** Docentes supervisores de Práctica II y III (el de Práctica I es tu docente existente, si lo hay). */
export const DOCENTES = [
  { nivel: "PP2", nombres: "Carolina", apellidos: "Mendoza Ruiz" },
  { nivel: "PP3", nombres: "Andrés Felipe", apellidos: "Rojas Pinto" },
];
export const DOCENTE_PP1_SI_NO_EXISTE = { nivel: "PP1", nombres: "Juan Camilo", apellidos: "Suárez Prada" };

const NOMBRES = ["Laura", "Valentina", "Daniela", "Camila", "Sofía", "Mariana", "Juliana", "Paula", "Natalia", "Andrea", "Karen", "Luisa", "Isabella", "Gabriela", "Alejandra", "Mónica", "Diana", "Yuliana", "Michelle", "Tatiana", "Sara", "Manuela", "Ángela", "Catalina", "Lorena", "Brenda", "Estefanía", "Johana", "Nicole", "Viviana", "Santiago", "Sebastián", "Juan David", "Felipe", "Camilo", "Daniel", "Carlos", "Andrés"];
const APELLIDOS = ["Gómez", "Rodríguez", "Martínez", "Hernández", "López", "González", "Pérez", "Sánchez", "Ramírez", "Torres", "Flórez", "Díaz", "Rojas", "Vargas", "Castillo", "Jiménez", "Moreno", "Ortiz", "Silva", "Cárdenas", "Pinzón", "Mantilla", "Rincón", "Barrera", "Cáceres", "Arenas", "Solano", "Villamizar", "Acevedo", "Duarte", "Ariza", "Pabón", "Gelvez", "Ardila", "Suárez", "Mejía", "Camargo", "Quintero", "Navas", "Prada"];

/** Convierte un texto en un fragmento de correo: sin tildes, en minúsculas y con puntos entre palabras. */
const sinTildes = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
/** Correo de demostración «nombre.apellido@dominio»; si ya existe agrega un número para que sea único. */
export const correoDemo = (nombres, apellidos, usados) => {
  const base = `${sinTildes(nombres.split(" ")[0])}.${sinTildes(apellidos.split(" ")[0])}`;
  let correo = `${base}@${DOMINIO_DEMO}`;
  for (let n = 2; usados.has(correo); n++) correo = `${base}${n}@${DOMINIO_DEMO}`;
  usados.add(correo);
  return correo;
};

/** Nombres únicos para `cantidad` personas, sin repetir combinaciones. */
export function generarPersonas(cantidad, azar, usados = new Set()) {
  const personas = [];
  const vistos = new Set();
  while (personas.length < cantidad) {
    const nombres = azar.elegir(NOMBRES);
    const apellidos = `${azar.elegir(APELLIDOS)} ${azar.elegir(APELLIDOS)}`;
    const clave = `${nombres} ${apellidos}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    personas.push({ nombres, apellidos, correo: correoDemo(nombres, apellidos, usados), telefono: `3${azar.entero(0, 2)}${azar.entero(10000000, 99999999)}` });
  }
  return personas;
}

/**
 * Los 30 estados que se reparten al azar entre los estudiantes de Práctica I, II y III (10 de cada una).
 * `atraso` indica los días que tiene la situación cuando se corre el script (rango [mín, máx]).
 */
export const ESTADOS = [
  ["SIN_SOLICITUD", 3], ["BORRADOR", 3], ["POR_REVISAR", 4], ["LISTA_PARA_ASIGNAR", 3], ["DEVUELTA", 3],
  ["PIDE_PLAZA_SIN_ASESOR", 2], ["ACTIVA_SIN_AVANCE", 2], ["ACTIVA_EN_BORRADOR", 2], ["BITACORA_ENVIADA", 1],
  ["EVALUACION_PARCIAL", 1], ["EVALUACION_EN_BORRADOR", 1], ["LISTA_PARA_CERRAR", 2], ["FINALIZADA", 2], ["RECHAZADA", 1],
].flatMap(([estado, n]) => Array.from({ length: n }, () => estado));

/** Estados en los que la práctica queda en curso con asesor de sitio (cuentan para la carga del asesor). */
export const ESTADOS_EN_CURSO = new Set(["ACTIVA_SIN_AVANCE", "ACTIVA_EN_BORRADOR", "BITACORA_ENVIADA", "EVALUACION_PARCIAL", "EVALUACION_EN_BORRADOR", "LISTA_PARA_CERRAR"]);

export const PREGUNTAS_CUESTIONARIO = [
  { tipo: "ABIERTA", enunciado: "Describe una experiencia significativa que viviste con los niños esta semana.", obligatoria: true },
  { tipo: "CERRADA_UNICA", enunciado: "¿Cómo calificas tu proceso de adaptación a la institución?", obligatoria: true, opciones: ["Excelente", "Buena", "Regular", "Difícil"] },
  { tipo: "CERRADA_MULTIPLE", enunciado: "¿Qué estrategias pedagógicas aplicaste durante la semana?", obligatoria: true, opciones: ["Juego dirigido", "Narración de cuentos", "Expresión artística", "Música y movimiento", "Trabajo en grupo"] },
  { tipo: "CERRADA_UNICA", enunciado: "¿Recibiste acompañamiento de tu asesor de sitio esta semana?", obligatoria: true, opciones: ["Sí, de forma constante", "Sí, ocasionalmente", "No"] },
  { tipo: "ABIERTA", enunciado: "¿Qué aspecto mejorarías para la próxima semana?", obligatoria: false },
];
/** Una pregunta extra por nivel para que cada cuestionario sea distinto. */
export const PREGUNTA_EXTRA_POR_NIVEL = {
  PP1: { tipo: "ABIERTA", enunciado: "¿Cómo fue la rutina de la jornada y cuál fue tu papel en ella?", obligatoria: false },
  PP2: { tipo: "CERRADA_MULTIPLE", enunciado: "¿Qué dimensiones del desarrollo trabajaste con el grupo?", obligatoria: true, opciones: ["Cognitiva", "Comunicativa", "Corporal", "Socioafectiva", "Estética"] },
  PP3: { tipo: "ABIERTA", enunciado: "Describe la planeación de la actividad que lideraste y sus resultados.", obligatoria: true },
};

export const REFLEXIONES = [
  "Esta semana acompañé al grupo de transición durante la jornada completa. Trabajamos la lectura de un cuento corto y luego los niños dibujaron su parte favorita. Noté que varios todavía les cuesta esperar su turno para hablar, así que usamos un muñeco como objeto para pedir la palabra y funcionó bastante bien con todo el salón.",
  "Planeé y lideré una actividad de motricidad gruesa en el patio con circuitos de obstáculos hechos con aros y cuerdas. Los niños participaron con mucho entusiasmo, aunque tuve que ajustar las reglas porque algunos se frustraban cuando perdían el equilibrio. Mi asesora me sugirió reforzar siempre el esfuerzo antes que el resultado final.",
  "Durante estos días observé cómo la docente titular organiza los rincones de aprendizaje y cómo los niños eligen libremente entre ellos. Yo me encargué del rincón de arte, donde trabajamos con pintura de dedos y texturas naturales. Aprendí que dar pocas instrucciones y mucho espacio a la exploración genera mejores conversaciones con los niños.",
  "La semana estuvo marcada por la adaptación de dos niños nuevos al grupo. Con ayuda de la docente diseñé juegos de presentación con canciones y movimiento para que se sintieran parte del salón. Me di cuenta de que mi voz y mi tono influyen mucho en la tranquilidad de los niños, y estoy practicando hablar más despacio.",
  "Realicé una actividad de exploración del entorno con lupas y hojas recogidas en el jardín de la institución. Los niños formularon preguntas muy interesantes sobre los insectos y las plantas, y registramos sus ideas en un cartel colectivo. Esto me mostró la importancia de partir de la curiosidad de ellos para construir los aprendizajes.",
  "Participé en la reunión con padres de familia para presentar los avances del periodo y conversar sobre las rutinas del hogar. Me ayudó a comprender mejor el contexto de los niños y a replantear una de mis actividades de lenguaje para incluir palabras y juegos que ellos usan en casa. Sigo trabajando en comunicarme con claridad con las familias.",
];
export const RESPUESTAS_ABIERTAS = [
  "El jueves leímos juntos un cuento sobre la amistad y los niños dramatizaron los personajes. Una niña muy tímida se animó a participar por primera vez y todo el grupo la aplaudió.",
  "Organicé una ronda de canciones con instrumentos hechos con material reciclado. Los niños inventaron sus propios ritmos y se mostraron muy creativos y atentos entre ellos.",
  "Trabajamos con plastilina la forma de los animales de la granja; mientras modelaban, conversamos sobre lo que cada animal nos da y cómo cuidarlo. Fue una buena actividad para el lenguaje oral.",
  "Mejoraría la gestión del tiempo en las transiciones entre actividades, porque a veces los niños se dispersan mientras guardamos los materiales. Voy a probar una canción corta para cada cambio.",
  "Quiero preparar con más anticipación los materiales para no interrumpir el ritmo de la actividad y poder dedicar más tiempo a observar cómo juega cada niño.",
];
export const RETROALIMENTACIONES_DOCENTE = [
  "Muy buen proceso reflexivo. Se evidencia coherencia entre lo que planeas y lo que ocurre en el aula. Te recomiendo profundizar en la fundamentación pedagógica de tus actividades y citar los referentes que trabajamos en clase.",
  "Tu bitácora muestra compromiso y capacidad de observación. Falta mayor análisis de las dificultades: no solo cuentas qué pasó sino por qué crees que pasó. Sigue por este camino y fortalece la autoevaluación.",
  "Excelente apropiación del rol docente y buena comunicación con los niños. Cuida la redacción y la ortografía en los textos formales. Las evidencias fotográficas respaldan muy bien tus reflexiones.",
  "Se nota crecimiento frente a la práctica anterior. Tus propuestas de actividades son creativas y pertinentes para la edad. Recuerda justificar siempre los objetivos de aprendizaje que persigues.",
];
export const RETROALIMENTACIONES_ASESOR = [
  "Practicante puntual, respetuosa y muy bien recibida por los niños y las familias. Participa con iniciativa en las actividades del grupo y acepta las sugerencias con apertura.",
  "Buena disposición para el trabajo en equipo y para aprender. Manejo adecuado del grupo en actividades dirigidas; puede fortalecer la gestión del tiempo en las transiciones.",
  "Se integró muy bien a la institución. Sus actividades son creativas y los niños las disfrutan. Se recomienda continuar con la planeación anticipada de los materiales.",
  "Demuestra compromiso con su proceso y buena relación con la docente titular. Fortalecer la comunicación con las familias en los momentos de entrega de los niños.",
];
export const MOTIVOS_DEVOLUCION_DOCUMENTO = [
  "El archivo no es legible, por favor súbelo de nuevo con mejor calidad.",
  "La afiliación a la ARL está vencida; carga el certificado vigente.",
  "La hoja de vida no tiene firma. Cárgala firmada.",
  "La carta de aceptación no corresponde a la institución elegida.",
];

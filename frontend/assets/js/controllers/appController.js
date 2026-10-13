/**
 * Controlador principal de la aplicación (todas las páginas internas).
 * Cada página HTML solo trae un <div id="app"> y define data-role / data-view en el <body>; este archivo exige la sesión,
 * dibuja el marco (menú lateral + cabecera) y delega cada vista en el módulo que corresponde (usuariosAdmin, bitacoraEstudiante, etc.).
 * Nota: las constantes con datos de ejemplo (students, userDirectory, auditRecords…) son restos del prototipo visual;
 * las pantallas ya conectadas obtienen los datos reales desde la API.
 */
// Utilidades de interfaz y cliente de la API.
import { initials, openModal, showToast } from "../utils/ui.js";
import { api } from "../services/api.js";
// Módulos que implementan cada pantalla (reciben las utilidades que necesitan como parámetro).
import { montarUsuarios } from "./usuariosAdmin.js";
import { montarInstituciones } from "./institucionesAdmin.js";
import { montarAsignaciones } from "./asignacionesAdmin.js";
import { montarDocumentosEstudiante } from "./documentosEstudiante.js";
import { montarBitacoraEstudiante } from "./bitacoraEstudiante.js";
import { montarDashboardEvaluador, montarEvaluacion } from "./evaluadorAdmin.js";
import { montarAuditoria } from "./auditoriaAdmin.js";
import { montarNotificaciones } from "./notificaciones.js";
import { montarCuenta } from "./cuenta.js";
import { montarPerfilInstitucion } from "./institucionPerfil.js";
import { montarCuestionarios } from "./cuestionariosAdmin.js";
import { montarPerfilUsuario, montarPracticaDirector } from "./perfilesAdmin.js";
// Manejo de sesión y roles.
import { cerrarSesion, elegirRol, NOMBRE_DE_ROL, PAGINA_DE_ROL, requerirSesion, ROL_DE_PAGINA } from "../services/session.js";

// Rol y vista de la página actual (vienen de los atributos data- del <body>).
const role = document.body.dataset.role;
const view = document.body.dataset.view;

// Guardia de sesión: sin sesión válida (o sin el rol de esta página) redirige y detiene la carga de la página.
const session = await requerirSesion(role);
if (!session) await new Promise(() => {});

// Configuración por rol: nombre, subtítulo y opciones del menú lateral [archivo, texto].
const config = {
  director: {
    name: "Mariana Vargas", initials: "MV", subtitle: "Directora de Programa",
    menu: [
      ["dashboard", "Vista general"],
      ["usuarios", "Gestión de Usuarios y Instituciones"],
      ["plantillas", "Cuestionarios"],
      ["asignaciones", "Asignaciones"],
      ["auditoria", "Auditoría documental"],
      ["cuenta", "Mi cuenta"],
    ],
  },
  estudiante: {
    name: "Laura Gómez", initials: "LG", subtitle: "Lic. Educación Infantil · 3°",
    menu: [["dashboard", "Mi práctica"], ["documentos", "Documentos legales"], ["bitacora", "Bitácora"], ["cuenta", "Mi cuenta"]],
  },
  asesor: {
    name: "María Ríos", initials: "MR", subtitle: "Asesora · I.E. San José",
    menu: [["dashboard", "Mis practicantes"], ["evaluacion", "Evaluación"], ["cuenta", "Mi cuenta"]],
  },
  docente: {
    name: "Juan Suárez", initials: "JS", subtitle: "Docente · Matemáticas",
    menu: [["dashboard", "Mis tutorías"], ["evaluacion", "Evaluación académica"], ["cuenta", "Mi cuenta"]],
  },
};

// Datos reales de la persona que inició sesión (los nombres de ejemplo del prototipo ya no se usan).
Object.assign(config[role], {
  name: session.usuario.nombre_completo,
  initials: initials(session.usuario.nombre_completo).toUpperCase(),
  subtitle: NOMBRE_DE_ROL[role],
});

// Textos de rol y carpeta de páginas de cada rol (se usan para el selector de rol y las rutas).
const labels = { director: "Director de programa", estudiante: "Estudiante", asesor: "Asesor de sitio", docente: "Docente supervisor" };
const folders = { director: "director", estudiante: "estudiante", asesor: "asesor", docente: "docente" };

/** Devuelve el SVG del ícono pedido por nombre. */
function icon(name) {
  const paths = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    building: '<path d="M3 21h18M6 21V3h12v18M9 7h2M13 7h2M9 11h2M13 11h2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    clipboard: '<path d="M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3"/><rect x="9" y="2" width="6" height="5" rx="2"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    alert: '<path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    paperclip: '<path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
}

/** Ruta de la página "vista" del rol indicado. */
function pathFor(targetRole, targetView) {
  return `/frontend/pages/${folders[targetRole]}/${targetView}.html`;
}

/** Dibuja el marco común (menú lateral, cabecera, selector de rol) y mete el contenido de la vista. */
function shell(content, title) {
  const profile = config[role];
  const iconNames = role === "estudiante" ? ["grid", "file", "edit", "settings"] : ["grid", "users", "clipboard", "edit", "shield", "settings"];
  document.querySelector("#app").innerHTML = `
    <div class="app-shell">
      <button class="sidebar-backdrop" hidden aria-label="Cerrar menú"></button>
      <aside class="sidebar">
        <a class="brand" href="${pathFor(role, "dashboard")}"><span class="brand-mark">U</span><span><strong>UDI</strong><small>Prácticas Pedagógicas</small></span><button class="sidebar-close" type="button" aria-label="Cerrar">×</button></a>
        ${session.roles.length > 1 ? `<div class="role-preview"><label for="role-switch">Perfil activo</label><select id="role-switch">${session.roles.map(({ codigo }) => `<option value="${PAGINA_DE_ROL[codigo]}" ${PAGINA_DE_ROL[codigo] === role ? "selected" : ""}>${NOMBRE_DE_ROL[PAGINA_DE_ROL[codigo]]}</option>`).join("")}</select></div>` : ""}
        <nav class="main-nav"><span class="nav-eyebrow">Panel de ${role}</span>${profile.menu.map(([id, text], index) => `<a class="${view === id ? "active" : ""}" href="${pathFor(role, id)}">${icon(iconNames[index] || "grid")}<span>${text}</span></a>`).join("")}</nav>
        <footer class="sidebar-profile"><div class="profile-line"><span class="avatar">${profile.initials}</span><span><strong>${profile.name}</strong><small>${profile.subtitle}</small></span></div><button class="logout" type="button">Cerrar sesión</button></footer>
      </aside>
      <div class="main-shell">
        <header class="topbar"><button class="mobile-menu" type="button" aria-label="Abrir menú">${icon("menu")}</button><div><h1>${title}</h1><p>${labels[role]}${role === "director" && view === "dashboard" ? " · Vista ejecutiva" : " · Periodo académico 2026-II"}</p></div><div class="top-actions"><div data-bell></div>${role === "director" && view === "dashboard" ? '<label class="top-period-field"><span>Periodo académico</span><select id="dashboard-period" disabled><option>Cargando…</option></select></label>' : '<span class="period-chip">2026-II</span>'}</div></header>
        <main class="page" id="main-content">${content}</main>
      </div>
    </div>`;

  montarNotificaciones({ escapar, icon, pathFor, role, showToast });
}

/** Tarjeta de indicador (ícono, valor, etiqueta). */
function stat(iconName, value, label, detail, tone) {
  return `<article class="stat-card"><span class="stat-icon ${tone}">${icon(iconName)}</span><div><span>${label}</span><strong>${value}</strong><small>${detail}</small></div></article>`;
}

/** Etiqueta de estado con color según el tono (info, success, warning…). */
function badge(text, tone = "info") {
  return `<span class="badge badge-${tone}">${text}</span>`;
}

// ---- Datos de ejemplo del prototipo (no vienen de la base de datos) ----
const students = [
  ["Laura Gómez Martínez", "Lic. Educación Infantil", "Práctica III", "I.E. San José", "En desarrollo", "4.50"],
  ["Carlos Ruiz Peña", "Lic. Educación Infantil", "Práctica III", "Colegio La Salle", "Por calificar", "—"],
  ["Ana Torres Vega", "Lic. Educación Infantil", "Práctica II", "I.E. Ciudad Jardín", "Borrador", "—"],
  ["Diego Mejía León", "Lic. Educación Infantil", "Práctica I", "Colegio Integrado", "Finalizada", "4.72"],
];

const advisorStudents = [
  { id: "laura", name: "Laura Gómez Martínez", program: "Lic. Educación Infantil", practice: "Práctica III", institution: "I.E. San José", supervisor: "Juan Suárez López", practiceStatus: "En desarrollo", evaluationStatus: "En borrador" },
  { id: "carlos", name: "Carlos Ruiz Peña", program: "Lic. Educación Infantil", practice: "Práctica III", institution: "I.E. San José", supervisor: "Claudia Martínez", practiceStatus: "Por calificar", evaluationStatus: "Pendiente" },
  { id: "ana", name: "Ana Torres Vega", program: "Lic. Educación Infantil", practice: "Práctica II", institution: "I.E. San José", supervisor: "Juan Suárez López", practiceStatus: "En desarrollo", evaluationStatus: "En borrador" },
  { id: "diego", name: "Diego Mejía León", program: "Lic. Educación Infantil", practice: "Práctica I", institution: "I.E. San José", supervisor: "Carlos Mendoza Ruiz", practiceStatus: "Finalizada", evaluationStatus: "Calificado" },
];

const teacherStudents = [
  { id: "laura", name: "Laura Gómez Martínez", program: "Lic. Educación Infantil", practice: "Práctica III", institution: "I.E. San José", advisor: "María Ríos Castro", practiceStatus: "En desarrollo", evaluationStatus: "En borrador" },
  { id: "ana", name: "Ana Torres Vega", program: "Lic. Educación Infantil", practice: "Práctica II", institution: "I.E. San José", advisor: "María Ríos Castro", practiceStatus: "Por calificar", evaluationStatus: "Pendiente" },
  { id: "valentina", name: "Valentina Herrera Díaz", program: "Lic. Educación Infantil", practice: "Práctica III", institution: "Colegio La Salle", advisor: "Carolina Méndez", practiceStatus: "En desarrollo", evaluationStatus: "En borrador" },
  { id: "mateo", name: "Mateo Rojas Silva", program: "Lic. Educación Infantil", practice: "Práctica I", institution: "Colegio Integrado", advisor: "Jorge Ramírez", practiceStatus: "Finalizada", evaluationStatus: "Calificado" },
];

const userDirectory = [
  { id: "laura", document: "1019234567", name: "Laura Gómez Martínez", role: "Estudiante", program: "Lic. Educación Infantil", semester: "3° semestre", email: "laura.gomez@udi.edu.co", phone: "310 555 0184", status: "Activo", practice: "Práctica III", institution: "I.E. San José" },
  { id: "carlos", document: "1023456789", name: "Carlos Ruiz Peña", role: "Estudiante", program: "Lic. Educación Infantil", semester: "3° semestre", email: "carlos.ruiz@udi.edu.co", phone: "315 555 0127", status: "Activo", practice: "Práctica III", institution: "Colegio La Salle" },
  { id: "juan", document: "5201234567", name: "Juan Suárez López", role: "Docente tutor", program: "Matemáticas", semester: "No aplica", email: "juan.suarez@udi.edu.co", phone: "300 555 0142", status: "Activo", practice: "12 estudiantes asignados", institution: "Universidad UDI" },
  { id: "maria", document: "5209876543", name: "María Ríos Castro", role: "Asesor de sitio", program: "I.E. San José", semester: "No aplica", email: "maria.rios@sanjose.edu.co", phone: "316 555 0198", status: "Activo", practice: "6 estudiantes asignados", institution: "I.E. San José" },
  { id: "ana", document: "9801234567", name: "Ana Torres Vega", role: "Estudiante", program: "Lic. Educación Infantil", semester: "2° semestre", email: "ana.torres@udi.edu.co", phone: "312 555 0176", status: "Activo", practice: "Práctica II", institution: "I.E. Ciudad Jardín" },
];

const institutionDirectory = [
  { id: "san-jose", name: "Institución Educativa San José", nit: "890.201.458-7", city: "Bucaramanga", address: "Carrera 27 # 45-18", contact: "Rectoría San José", email: "rectoria@iesanjose.edu.co", phone: "607 635 2140", agreement: "Vigente", status: "Activa", students: 18, advisors: ["María Ríos Castro", "Andrés Rojas", "Diana López"] },
  { id: "la-salle", name: "Colegio La Salle", nit: "890.201.772-1", city: "Floridablanca", address: "Calle 30 # 14-25", contact: "Coordinación Académica", email: "coordinacion@lasalle.edu.co", phone: "607 638 4210", agreement: "Vigente", status: "Activa", students: 12, advisors: ["Carolina Méndez", "Luis Herrera"] },
  { id: "ciudad-jardin", name: "I.E. Ciudad Jardín", nit: "900.145.822-3", city: "Girón", address: "Avenida 6 # 21-40", contact: "Coordinación Académica", email: "contacto@ciudadjardin.edu.co", phone: "607 646 1055", agreement: "En trámite", status: "Activa", students: 8, advisors: ["Natalia Peña"] },
  { id: "integrado", name: "Colegio Integrado", nit: "890.270.115-9", city: "Piedecuesta", address: "Calle 9 # 8-32", contact: "Coordinación de Convenios", email: "convenios@integrado.edu.co", phone: "607 655 0870", agreement: "Vigente", status: "Inactiva", students: 6, advisors: ["Miguel Torres", "Sandra León"] },
];

const advisorDirectory = [
  { id: "andres-rojas", name: "Andrés Rojas", document: "1098745210", email: "andres.rojas@sanjose.edu.co", phone: "310 456 7821", institutionId: "san-jose", status: "Activo", studentIds: ["laura", "ana"] },
  { id: "diana-lopez", name: "Diana López", document: "1098654321", email: "diana.lopez@sanjose.edu.co", phone: "315 682 1045", institutionId: "san-jose", status: "Activo", studentIds: ["carlos", "diego"] },
  { id: "carolina-mendez", name: "Carolina Méndez", document: "63452189", email: "carolina.mendez@lasalle.edu.co", phone: "300 541 2798", institutionId: "la-salle", status: "Activo", studentIds: ["carlos"] },
  { id: "luis-herrera", name: "Luis Herrera", document: "91234567", email: "luis.herrera@lasalle.edu.co", phone: "301 456 2098", institutionId: "la-salle", status: "Activo", studentIds: ["laura", "diego"] },
  { id: "maria-rios", name: "María Ríos Castro", document: "5209876543", email: "maria.rios@sanjose.edu.co", phone: "316 555 0198", institutionId: "san-jose", status: "Activo", studentIds: ["laura"] },
  { id: "natalia-pena", name: "Natalia Peña", document: "1098456712", email: "natalia.pena@ciudadjardin.edu.co", phone: "317 450 2189", institutionId: "ciudad-jardin", status: "Activo", studentIds: ["ana"] },
  { id: "miguel-torres", name: "Miguel Torres", document: "1098123456", email: "miguel.torres@integrado.edu.co", phone: "320 871 4502", institutionId: "integrado", status: "Activo", studentIds: ["diego"] },
  { id: "sandra-leon", name: "Sandra León", document: "63321456", email: "sandra.leon@integrado.edu.co", phone: "318 750 1264", institutionId: "integrado", status: "Activo", studentIds: ["laura"] },
];

const studentPracticeHistory = {
  laura: [
    { level: "I", period: "2025-II", institution: "Colegio Integrado", status: "Finalizada", documentStatus: "Aprobados", teacher: "Claudia Martínez", advisor: "Miguel Torres", teacherGrade: "4.50", advisorGrade: "4.60", journal: "Realicé un proceso de observación y reconocimiento del contexto educativo, identificando las dinámicas del aula y las necesidades de acompañamiento de los niños.", questions: [["¿Qué características identificó en el contexto educativo?", "Reconocí diferentes ritmos de aprendizaje, participación activa y una relación cercana entre las familias y la institución."]], documents: [["Cédula de ciudadanía", "Aprobado", "cedula_laura_2025-II.pdf"], ["Certificado ARL", "Aprobado", "arl_laura_2025-II.pdf"], ["Carta de aceptación", "Aprobado", "carta_colegio_integrado_2025-II.pdf"], ["Hoja de vida", "Aprobado", "hoja_vida_laura_2025-II.pdf"]] },
    { level: "II", period: "2026-I", institution: "I.E. Ciudad Jardín", status: "Finalizada", documentStatus: "Aprobados", teacher: "Juan Suárez López", advisor: "María Ríos Castro", teacherGrade: "4.70", advisorGrade: "4.50", journal: "Diseñé experiencias pedagógicas centradas en el juego y la exploración, adaptando los recursos a las características del grupo.", questions: [["¿Cómo respondió el grupo a la propuesta?", "Los niños participaron activamente y demostraron interés sostenido durante las actividades."], ["¿Qué ajustaría en una próxima intervención?", "Incluiría más momentos de trabajo en grupos pequeños."]], documents: [["Cédula de ciudadanía", "Aprobado", "cedula_laura_2026-I.pdf"], ["Certificado ARL", "Aprobado", "arl_laura_2026-I.pdf"], ["Carta de aceptación", "Aprobado", "carta_ciudad_jardin_2026-I.pdf"], ["Hoja de vida", "Aprobado", "hoja_vida_laura_2026-I.pdf"]] },
    { level: "III", period: "2026-II", institution: "I.E. San José", status: "En desarrollo", documentStatus: "Aprobados", teacher: "Juan Suárez López", advisor: "María Ríos Castro", teacherGrade: "4.60", advisorGrade: null, journal: "Durante esta práctica diseñé y desarrollé una secuencia didáctica enfocada en el aprendizaje colaborativo. La actividad permitió identificar distintos ritmos de aprendizaje y ajustar las estrategias de acompañamiento.", questions: [["¿Cómo relaciona la planeación con las necesidades del contexto?", "Partí del diagnóstico inicial y adapté los recursos a las necesidades observadas."], ["¿Qué estrategia promovió mayor participación?", "El trabajo colaborativo por estaciones permitió que todos los niños asumieran un rol activo."]], documents: [["Cédula de ciudadanía", "Aprobado", "cedula_laura_2026-II.pdf"], ["Certificado ARL", "Aprobado", "arl_laura_2026-II.pdf"], ["Carta de aceptación", "Aprobado", "carta_san_jose_2026-II.pdf"], ["Hoja de vida", "Aprobado", "hoja_vida_laura_2026-II.pdf"]] },
  ],
  carlos: [
    { level: "I", period: "2025-II", institution: "Colegio Integrado", status: "Finalizada", teacher: "Claudia Martínez", advisor: "Sandra León", teacherGrade: "4.20", advisorGrade: "4.30", journal: "Observé y documenté las dinámicas de aprendizaje del grupo asignado.", questions: [["¿Cuál fue el principal hallazgo?", "La diversidad de formas de comunicación dentro del aula."]] },
    { level: "II", period: "2026-I", institution: "I.E. Ciudad Jardín", status: "Finalizada", teacher: "Juan Suárez López", advisor: "María Ríos Castro", teacherGrade: "4.40", advisorGrade: "4.35", journal: "Implementé actividades de exploración sensorial y expresión artística.", questions: [["¿Qué resultado obtuvo?", "Mayor participación y expresión espontánea de los niños."]] },
    { level: "III", period: "2026-II", institution: "Colegio La Salle", status: "Documentos en auditoría", documentStatus: "En auditoría", teacher: "Claudia Martínez", advisor: "Carolina Méndez", teacherGrade: null, advisorGrade: null, journal: "Presenté una propuesta de intervención orientada al desarrollo del lenguaje mediante narraciones.", questions: [["¿Qué estrategia utilizó?", "Lectura compartida y creación colectiva de historias."]] },
  ],
  ana: [
    { level: "I", period: "2026-I", institution: "Colegio Integrado", status: "Finalizada", teacher: "Claudia Martínez", advisor: "Miguel Torres", teacherGrade: "4.30", advisorGrade: "4.40", journal: "Realicé la caracterización inicial del contexto y del grupo.", questions: [["¿Qué aprendió del proceso?", "A reconocer las particularidades de cada niño."]] },
    { level: "II", period: "2026-II", institution: "I.E. Ciudad Jardín", status: "Documentación pendiente", documentStatus: "Pendiente", teacher: "Juan Suárez López", advisor: "María Ríos Castro", teacherGrade: null, advisorGrade: null, journal: "Estoy desarrollando una propuesta basada en ambientes de aprendizaje.", questions: [] },
  ],
  diego: [
    { level: "I", period: "2026-II", institution: "Colegio Integrado", status: "Finalizada", teacher: "Claudia Martínez", advisor: "Miguel Torres", teacherGrade: "4.70", advisorGrade: "4.80", journal: "Finalicé el proceso de observación e intervención inicial con resultados satisfactorios.", questions: [["¿Cuál fue su mayor logro?", "Construir una relación pedagógica respetuosa con el grupo."]] },
  ],
};

const assignmentRecords = [
  { id: "asg-laura", studentId: "laura", student: "Laura Gómez Martínez", document: "1019234567", program: "Lic. Educación Infantil", level: "III", period: "2026-II", institutionId: "san-jose", teacher: "Juan Suárez López", advisor: "María Ríos Castro" },
  { id: "asg-carlos", studentId: "carlos", student: "Carlos Ruiz Peña", document: "1023456789", program: "Lic. Educación Infantil", level: "III", period: "2026-II", institutionId: "la-salle", teacher: null, advisor: "Carolina Méndez" },
  { id: "asg-ana", studentId: "ana", student: "Ana Torres Vega", document: "9801234567", program: "Lic. Educación Infantil", level: "II", period: "2026-II", institutionId: "ciudad-jardin", teacher: "Juan Suárez López", advisor: null },
  { id: "asg-diego", studentId: "diego", student: "Diego Mejía León", document: "1098123401", program: "Lic. Educación Infantil", level: "I", period: "2026-II", institutionId: "integrado", teacher: "Claudia Martínez", advisor: "Miguel Torres" },
];

const studentsWithoutAssignment = [
  { id: "valentina", name: "Valentina Pérez Gómez", document: "1098765402", program: "Lic. Educación Infantil" },
  { id: "sebastian", name: "Sebastián León Díaz", document: "1005487213", program: "Lic. Educación Infantil" },
];

// Paginación y estado de pantalla de las vistas del director.
const usersPerPage = 10;
let currentUsersPage = 1;
const institutionsPerPage = 10;
let currentInstitutionsPage = 1;


// Bancos de preguntas de ejemplo por nivel de práctica (la pantalla real usa cuestionariosAdmin.js).
const practiceQuestionBanks = {
  I: {
    enabled: true,
    questions: [
      { id: 101, type: "Abierta", text: "¿Qué características identificó en el contexto educativo?", options: [] },
      { id: 102, type: "Cerrada", text: "¿Cuál fue el nivel de participación observado en el grupo?", answerMode: "multiple", required: true, options: ["Muy alto", "Alto", "Medio", "Bajo"] },
    ],
  },
  II: {
    enabled: false,
    questions: [
      { id: 201, type: "Abierta", text: "¿Cómo respondió el grupo a la propuesta pedagógica?", options: [] },
      { id: 202, type: "Cerrada", text: "¿Qué estrategia generó mayor participación?", options: ["Juego dirigido", "Exploración libre", "Trabajo colaborativo", "Lectura compartida"] },
    ],
  },
  III: {
    enabled: true,
    questions: [
      { id: 301, type: "Abierta", text: "¿Cómo relaciona la planeación pedagógica con las necesidades del contexto?", options: [] },
      { id: 302, type: "Cerrada", text: "La estrategia didáctica promovió la participación activa.", options: ["Totalmente de acuerdo", "De acuerdo", "En desacuerdo", "Totalmente en desacuerdo"] },
      { id: 303, type: "Abierta", text: "Describa el principal aprendizaje obtenido durante esta práctica.", options: [] },
    ],
  },
};

let selectedQuestionLevel = "I";
const dirtyQuestionLevels = new Set();
let draggedQuestion = null;

const auditRecords = [
  {
    id: "laura",
    name: "Laura Gómez Martínez",
    program: "Lic. Educación Infantil · Práctica III",
    practice: "Práctica III",
    period: "2026-II",
    institution: "I.E. San José",
    status: "Aprobado",
    documents: [
      ["Certificado ARL", "Aprobado", "PDF · 1.2 MB · 12 mar 2026"],
      ["Cédula de ciudadanía", "Aprobado", "PDF · 1.6 MB · 12 mar 2026"],
      ["Hoja de vida", "Aprobado", "PDF · 2.0 MB · 14 mar 2026"],
      ["Carta de aceptación", "Aprobado", "PDF · 2.4 MB · 14 mar 2026"],
    ],
  },
  {
    id: "carlos",
    name: "Carlos Ruiz Peña",
    program: "Lic. Educación Infantil · Práctica III",
    practice: "Práctica III",
    period: "2026-II",
    institution: "Colegio La Salle",
    status: "En revisión",
    documents: [
      ["Certificado ARL", "Aprobado", "PDF · 1.1 MB · 10 mar 2026"],
      ["Cédula de ciudadanía", "Aprobado", "PDF · 1.4 MB · 10 mar 2026"],
      ["Hoja de vida", "Aprobado", "PDF · 1.8 MB · 11 mar 2026"],
      ["Carta de aceptación", "Rechazado", "Sin convenio vigente con la institución"],
    ],
  },
  {
    id: "ana",
    name: "Ana Torres Vega",
    program: "Lic. Educación Infantil · Práctica II",
    practice: "Práctica II",
    period: "2026-I",
    institution: "I.E. Ciudad Jardín",
    status: "Aprobado",
    documents: [
      ["Certificado ARL", "Aprobado", "PDF · 1.3 MB · 05 mar 2026"],
      ["Cédula de ciudadanía", "Aprobado", "PDF · 1.5 MB · 05 mar 2026"],
      ["Hoja de vida", "Aprobado", "PDF · 2.1 MB · 06 mar 2026"],
      ["Carta de aceptación", "Aprobado", "PDF · 2.2 MB · 06 mar 2026"],
    ],
  },
  {
    id: "diego",
    name: "Diego Mejía León",
    program: "Lic. Educación Infantil · Práctica I",
    practice: "Práctica I",
    period: "2025-II",
    institution: "Colegio Integrado",
    status: "Aprobado",
    documents: [
      ["Certificado ARL", "Aprobado", "PDF · 1.0 MB · 02 mar 2026"],
      ["Cédula de ciudadanía", "Aprobado", "PDF · 1.7 MB · 02 mar 2026"],
      ["Hoja de vida", "Aprobado", "PDF · 1.9 MB · 03 mar 2026"],
      ["Carta de aceptación", "Aprobado", "PDF · 2.1 MB · 03 mar 2026"],
    ],
  },
];

function studentTable(evaluator = false) {
  if (evaluator && role === "asesor") {
    const practiceTone = (status) => status === "Finalizada" ? "success" : status === "Por calificar" ? "warning" : "info";
    const evaluationTone = (status) => status === "Calificado" ? "success" : status === "En borrador" ? "info" : "warning";
    return `<div class="table-wrap"><table class="advisor-student-table"><thead><tr><th>Estudiante</th><th>Práctica / Supervisor UDI</th><th>Estado de práctica</th><th>Evaluación asesor</th><th>Acción</th></tr></thead><tbody>${advisorStudents.map((student) => {
      const needsEvaluation = student.practiceStatus === "Por calificar";
      return `<tr><td><div class="person"><span class="avatar">${initials(student.name)}</span><span><strong>${student.name}</strong><small>${student.program}</small></span></div></td><td><strong>${student.practice}</strong><small>Supervisor UDI: ${student.supervisor}</small></td><td>${badge(student.practiceStatus, practiceTone(student.practiceStatus))}</td><td>${badge(student.evaluationStatus, evaluationTone(student.evaluationStatus))}</td><td><a class="btn ${needsEvaluation ? "btn-primary" : "btn-secondary"}" href="${pathFor("asesor", "evaluacion")}?student=${student.id}${needsEvaluation ? "" : "&mode=view"}">${needsEvaluation ? "Evaluar" : "Ver bitácora"}</a></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
  if (evaluator) {
    return `<div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>Práctica / institución</th><th>Estado de práctica</th><th>Evaluación docente</th><th>Acción</th></tr></thead><tbody>${teacherStudents.map((student) => {
      const needsEvaluation = student.practiceStatus === "Por calificar";
      return `<tr><td><div class="person"><span class="avatar">${initials(student.name)}</span><span><strong>${student.name}</strong><small>${student.program}</small></span></div></td><td><strong>${student.practice}</strong><small>${student.institution} · Asesor: ${student.advisor}</small></td><td>${badge(student.practiceStatus, student.practiceStatus === "Finalizada" ? "success" : needsEvaluation ? "warning" : "info")}</td><td>${badge(student.evaluationStatus, student.evaluationStatus === "Calificado" ? "success" : student.evaluationStatus === "En borrador" ? "info" : "warning")}</td><td><a class="btn ${needsEvaluation ? "btn-primary" : "btn-secondary"}" href="${pathFor("docente", "evaluacion")}?student=${student.id}${needsEvaluation ? "" : "&mode=view"}">${needsEvaluation ? "Evaluar" : "Ver bitácora"}</a></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
  return `<div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>Práctica / institución</th><th>Estado</th><th>Nota</th><th>Acción</th></tr></thead><tbody>${students.map((student) => `<tr><td><div class="person"><span class="avatar">${initials(student[0])}</span><span><strong>${student[0]}</strong><small>${student[1]}</small></span></div></td><td><strong>${student[2]}</strong><small>${student[3]}</small></td><td>${badge(student[4], student[4] === "Finalizada" ? "success" : student[4] === "Por calificar" ? "warning" : "info")}</td><td><strong>${student[5]}</strong></td><td><a class="btn btn-ghost" href="#">Ver</a></td></tr>`).join("")}</tbody></table></div>`;
}

/** Escapa texto para insertarlo de forma segura en HTML (evita inyección XSS). */
const escapar = (valor) => String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// ---- Dashboard del director (datos reales de la API) ----
const TAMANO_PAGINA_DASHBOARD = 10;
const dashEstado = { periodos: [], periodoId: null, pagina: 1, filas: new Map(), peticion: 0 };

// Texto y color con que se muestra el estado de la bitácora y de la evaluación.
const ETIQUETA_BITACORA = {
  BORRADOR: ["En desarrollo / Borrador", "info"], ENVIADA: ["Enviada", "warning"], EN_EVALUACION: ["En evaluación", "warning"], EVALUADA: ["Evaluada", "success"],
};
const ETIQUETA_EVALUACION = {
  SIN_ENTREGA: ["Sin entrega", "neutral"], PENDIENTE: ["Pendiente", "neutral"], PARCIAL: ["Parcial", "warning"], COMPLETA: ["Evaluado", "success"],
};
const etiquetaBitacora = (fila) => {
  if (fila.estado === "FINALIZADA") return ["Finalizada", "success"];
  if (!fila.bitacora) return ["Sin iniciar", "neutral"];
  return ETIQUETA_BITACORA[fila.bitacora.estado] || [fila.bitacora.estado, "info"];
};
const etiquetaEvaluacion = (fila) => ETIQUETA_EVALUACION[fila.evaluacion_global] || [fila.evaluacion_global, "neutral"];
/** Muestra la nota con dos decimales o "Pendiente" si aún no existe. */
const notaTexto = (evaluacion) => (evaluacion?.nota == null ? "Pendiente" : Number(evaluacion.nota).toFixed(2));
/** Saludo según la hora del día. */
const saludo = () => { const h = new Date().getHours(); return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"; };

/** Vista general del director: indicadores y tabla de prácticas por periodo. */
function directorDashboard() {
  const nombre = escapar(session.usuario.nombres || session.usuario.nombre_completo || "").split(" ")[0];
  shell(`<section class="welcome"><div><span class="eyebrow">Resumen ejecutivo</span><h2>${saludo()}${nombre ? `, ${nombre}` : ""}</h2><p>Este es el estado de las prácticas pedagógicas para el periodo seleccionado.</p></div></section>
  <section class="stats-grid dashboard-stats">
    <article class="stat-card"><span class="stat-icon blue">${icon("users")}</span><div><span>Prácticas activas</span><strong data-dashboard-metric="active">…</strong><small data-dashboard-detail="active"> </small></div></article>
    <article class="stat-card"><span class="stat-icon green">${icon("file")}</span><div><span>Expedientes completos</span><strong data-dashboard-metric="files">…</strong><small data-dashboard-detail="files"> </small></div></article>
    <article class="stat-card"><span class="stat-icon orange">${icon("clipboard")}</span><div><span>Evaluaciones por publicar</span><strong data-dashboard-metric="pending">…</strong><small data-dashboard-detail="pending"> </small></div></article>
    <article class="stat-card"><span class="stat-icon purple">${icon("building")}</span><div><span>Instituciones activas</span><strong data-dashboard-metric="institutions">…</strong><small data-dashboard-detail="institutions"> </small></div></article>
  </section>
  <section class="dashboard-grid"><article class="panel"><header class="panel-heading dashboard-table-heading"><div><h3>Seguimiento de prácticas</h3><p>Actividad del periodo <strong data-selected-period>…</strong></p></div><a class="dashboard-directory-link" href="${pathFor("director","usuarios")}">¿Buscas un estudiante? Ir a Gestión de Usuarios →</a></header><div id="dashboard-table">${estadoCarga("Cargando prácticas…")}</div><footer class="pagination dashboard-pagination"><span id="dashboard-pagination-summary"></span><nav aria-label="Paginación de prácticas" data-dashboard-pagination></nav></footer></article>
  <aside class="panel action-alerts"><header class="panel-heading"><div><h3>Alertas de acción rápida</h3><p>Situaciones que requieren atención</p></div></header><div class="alert-list" id="dashboard-alerts">${estadoCarga("Cargando alertas…")}</div><div class="alert-footer"><span id="dashboard-updated"></span></div></aside></section>`, "Vista general");
  iniciarDashboardDirector();
}

function estadoCarga(texto) {
  return `<p class="muted" style="padding:24px 20px;text-align:center">${texto}</p>`;
}

function estadoError(mensaje, accion) {
  return `<div style="padding:24px 20px;text-align:center"><p class="form-error" role="alert">${escapar(mensaje)}</p><button class="btn btn-secondary" type="button" data-${accion}>Reintentar</button></div>`;
}

/** Carga los periodos y arranca el dashboard del director. */
async function iniciarDashboardDirector() {
  const selector = document.querySelector("#dashboard-period");
  try {
    dashEstado.periodos = (await api.get("/periods")).data;
  } catch (error) {
    dashEstado.periodos = [];
    showToast(error.message);
  }
  const activo = dashEstado.periodos.find((p) => p.es_activo) || dashEstado.periodos[0];
  dashEstado.periodoId = activo?.id ?? null;
  dashEstado.pagina = 1;
  if (selector) {
    selector.innerHTML = dashEstado.periodos.length
      ? dashEstado.periodos.map((p) => `<option value="${escapar(p.id)}" ${p.id === dashEstado.periodoId ? "selected" : ""}>${escapar(p.codigo)}${p.es_activo ? " (activo)" : ""}</option>`).join("")
      : "<option>Sin periodos</option>";
    selector.disabled = dashEstado.periodos.length === 0;
  }
  cargarDashboardDirector();
}

/** Consulta el resumen del periodo seleccionado y repinta indicadores y tabla. */
async function cargarDashboardDirector() {
  const turno = ++dashEstado.peticion;
  const query = dashEstado.periodoId ? { periodo_id: dashEstado.periodoId } : {};
  const [resumen, practicas] = await Promise.allSettled([
    api.get("/dashboard", query),
    api.get("/dashboard/practices", { ...query, page: dashEstado.pagina, page_size: TAMANO_PAGINA_DASHBOARD }),
  ]);
  if (turno !== dashEstado.peticion) return; // llegó una respuesta de un periodo/página anterior
  pintarIndicadores(resumen);
  pintarTablaPracticas(practicas);
}

/** Dibuja las tarjetas de indicadores. */
function pintarIndicadores(resultado) {
  const alertas = document.querySelector("#dashboard-alerts");
  if (resultado.status === "rejected") {
    ["active", "files", "pending", "institutions"].forEach((k) => {
      document.querySelector(`[data-dashboard-metric="${k}"]`).textContent = "—";
      document.querySelector(`[data-dashboard-detail="${k}"]`).textContent = "No se pudieron cargar las métricas";
    });
    alertas.innerHTML = estadoError(resultado.reason?.message || "No se pudieron cargar las alertas.", "dashboard-retry");
    return;
  }
  const { indicadores: i, alertas: a, periodo } = resultado.value.data;
  const fijar = (k, valor, detalle) => {
    document.querySelector(`[data-dashboard-metric="${k}"]`).textContent = valor;
    document.querySelector(`[data-dashboard-detail="${k}"]`).textContent = detalle;
  };
  fijar("active", i.practicas_activas, `${i.practicas_finalizadas} finalizadas en el periodo`);
  fijar("files", i.expedientes_completos, "Documentos legales aprobados");
  fijar("pending", i.evaluaciones_pendientes, `${i.evaluaciones_publicadas} evaluaciones publicadas`);
  fijar("institutions", i.instituciones_activas, `${a.convenios_en_tramite} convenios en trámite`);
  document.querySelector("[data-selected-period]").textContent = periodo?.codigo || "todos los periodos";
  const alerta = (ruta, tono, icono, cantidad, titulo, detalle) => `<a href="${pathFor("director", ruta)}"><span class="alert-icon ${tono}">${icon(icono)}</span><span><strong><b>${cantidad}</b> ${titulo}</strong><small>${detalle}</small></span><span>→</span></a>`;
  alertas.innerHTML = [
    alerta("auditoria", "red", "file", a.expedientes_por_auditar, "expedientes por auditar", "Requieren auditoría documental"),
    alerta("auditoria", "orange", "file", a.expedientes_por_corregir, "expedientes por corregir", "Esperan que el estudiante los corrija"),
    alerta("asignaciones", "orange", "users", a.practicas_sin_docente, "prácticas sin docente", "Pendientes de asignación"),
    alerta("asignaciones", "orange", "users", a.practicas_sin_asesor, "prácticas sin asesor", "Pendientes de asignación"),
    alerta("usuarios", "blue", "building", a.convenios_en_tramite, "convenios en trámite", "Validar instituciones vinculadas"),
  ].join("");
  document.querySelector("#dashboard-updated").textContent = `Actualizado a las ${new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Dibuja la tabla paginada de prácticas del dashboard. */
function pintarTablaPracticas(resultado) {
  const tabla = document.querySelector("#dashboard-table");
  const resumen = document.querySelector("#dashboard-pagination-summary");
  const botones = document.querySelector("[data-dashboard-pagination]");
  if (resultado.status === "rejected") {
    tabla.innerHTML = estadoError(resultado.reason?.message || "No se pudo cargar el seguimiento de prácticas.", "dashboard-retry");
    resumen.textContent = "";
    botones.innerHTML = "";
    return;
  }
  const { data, meta } = resultado.value;
  dashEstado.filas = new Map(data.map((fila) => [fila.id, fila]));
  if (!data.length) {
    tabla.innerHTML = estadoCarga("No hay prácticas registradas para este periodo.");
    resumen.textContent = "0 prácticas";
    botones.innerHTML = "";
    return;
  }
  tabla.innerHTML = `<div class="table-wrap"><table class="dashboard-practices"><thead><tr><th>Estudiante</th><th>Práctica / institución</th><th>Estado de bitácora</th><th>Evaluación</th><th>Acción</th></tr></thead><tbody>${data.map((fila) => {
    const [textoB, tonoB] = etiquetaBitacora(fila);
    const [textoE, tonoE] = etiquetaEvaluacion(fila);
    return `<tr><td><a class="person practice-person" href="${pathFor("director","perfil")}?id=${escapar(fila.estudiante.id)}"><span class="avatar">${escapar(initials(fila.estudiante.nombre_completo))}</span><span><strong>${escapar(fila.estudiante.nombre_completo)}</strong><small>${escapar(fila.estudiante.documento)}</small></span></a></td><td><strong>${escapar(fila.nivel.nombre)}</strong><small>${escapar(fila.institucion.nombre)}</small></td><td>${badge(textoB, tonoB)}</td><td>${badge(textoE, tonoE)}</td><td><button class="btn btn-secondary" type="button" data-practice-summary="${escapar(fila.id)}">Ver resumen</button></td></tr>`;
  }).join("")}</tbody></table></div>`;
  const desde = (meta.page - 1) * meta.page_size + 1;
  resumen.textContent = `Mostrando ${desde} - ${desde + data.length - 1} de ${meta.total} prácticas`;
  const total = meta.total_pages;
  const visibles = [...new Set([1, meta.page - 1, meta.page, meta.page + 1, total])].filter((n) => n >= 1 && n <= total).sort((x, y) => x - y);
  let html = `<button type="button" data-dashboard-page="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""}>‹</button>`;
  visibles.forEach((n, idx) => {
    if (idx && n - visibles[idx - 1] > 1) html += "<button type=\"button\" disabled>…</button>";
    html += `<button type="button" data-dashboard-page="${n}" class="${n === meta.page ? "active" : ""}">${n}</button>`;
  });
  html += `<button type="button" data-dashboard-page="${meta.page + 1}" ${meta.page >= total ? "disabled" : ""}>›</button>`;
  botones.innerHTML = html;
}

function abrirResumenPractica(fila) {
  const [textoB, tonoB] = etiquetaBitacora(fila);
  const [textoE, tonoE] = etiquetaEvaluacion(fila);
  const d = fila.documentos;
  openModal(`Resumen de práctica · ${escapar(fila.estudiante.nombre_completo)}`, `<div class="practice-summary-modal"><header><span class="eyebrow">${escapar(fila.nivel.nombre)}</span><p>${escapar(fila.institucion.nombre)}${fila.institucion.ciudad ? ` · ${escapar(fila.institucion.ciudad)}` : ""}</p></header><div class="summary-statuses"><div><span>Estado de bitácora</span>${badge(textoB, tonoB)}</div><div><span>Estado de evaluación</span>${badge(textoE, tonoE)}</div><div><span>Documentos</span><strong>${d ? `${d.aprobados} de ${d.total} aprobados` : "—"}</strong></div></div><div class="summary-people"><div><span>Docente supervisor</span><strong>${escapar(fila.docente?.nombre_completo || "Sin asignar")}</strong></div><div><span>Asesor de sitio</span><strong>${escapar(fila.asesor?.nombre_completo || "Sin asignar")}</strong></div></div><div class="independent-grades"><div><span>Nota docente</span><strong>${notaTexto(fila.evaluaciones?.docente)}</strong></div><div><span>Nota asesor</span><strong>${notaTexto(fila.evaluaciones?.asesor)}</strong></div></div><p class="summary-note">Las calificaciones se presentan por separado y no se promedian en esta vista.</p><div class="form-actions"><a class="btn btn-secondary" href="${pathFor("director","perfil")}?id=${escapar(fila.estudiante.id)}">Abrir perfil completo</a><button class="btn btn-primary" type="button" data-close>Cerrar</button></div></div>`);
}

// ---- Vistas del director (delegan en módulos *Admin) ----
function usersView() {
  shell(`<header class="page-title"><div><span class="eyebrow">Administración</span><h2>Gestión de Usuarios e Instituciones</h2><p>Administra usuarios e instituciones vinculadas a las prácticas.</p></div><button class="btn btn-primary" data-new>+ Nuevo usuario</button></header>
  <div class="tabs"><button class="active" data-tab="users">Usuarios</button><button data-tab="sites">Instituciones</button></div>
  <section class="panel" id="users-catalog"><div class="toolbar"><label class="search"><span class="sr-only">Buscar</span><input data-search placeholder="Buscar por nombre, cédula o correo..." /></label><select id="user-role-filter" aria-label="Filtrar por rol"><option value="all">Todos los roles</option><option value="ESTUDIANTE">Estudiantes</option><option value="DOCENTE_SUPERVISOR">Docentes</option><option value="ASESOR_SITIO">Asesores</option></select><select id="user-semester-filter" aria-label="Filtrar por semestre"><option value="all">Todos los semestres</option>${Array.from({length:8},(_,index)=>`<option value="${index+1}° semestre">${index+1}° semestre</option>`).join("")}</select><select id="user-status-filter" aria-label="Filtrar por estado"><option value="all">Todos los estados</option><option value="ACTIVO">Activos</option><option value="INACTIVO">Inactivos</option><option value="SUSPENDIDO">Suspendidos</option></select></div><div class="table-wrap"><table><thead><tr><th>Cédula</th><th>Nombre completo</th><th>Rol / programa</th><th>Semestre actual</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="users-table-body"></tbody></table></div><footer class="pagination" id="users-pagination"><span data-pagination-summary>0 usuarios</span><nav aria-label="Paginación de usuarios" data-pagination-buttons></nav></footer></section>
  <section class="panel" id="sites-catalog" hidden><div class="toolbar"><label class="search"><span class="sr-only">Buscar institución</span><input data-site-search placeholder="Buscar por institución, NIT, ciudad o asesor..." /></label><select id="institution-agreement-filter" aria-label="Filtrar por convenio"><option value="all">Todos los convenios</option><option value="VIGENTE">Vigentes</option><option value="EN_TRAMITE">En trámite</option><option value="SUSPENDIDO">Suspendidos</option><option value="VENCIDO">Vencidos</option></select><select id="institution-status-filter" aria-label="Filtrar por estado"><option value="all">Todos los estados</option><option value="true">Activas</option><option value="false">Inactivas</option></select></div><div class="table-wrap"><table><thead><tr><th>NIT</th><th>Institución</th><th>Ciudad / asesores vinculados</th><th>Convenio</th><th>Prácticas activas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="institutions-table-body"></tbody></table></div><footer class="pagination" id="institutions-pagination"><span data-institution-pagination-summary>0 instituciones</span><nav aria-label="Paginación de instituciones" data-institution-pagination-buttons></nav></footer></section>`, "Gestión de Usuarios y Instituciones");
  montarUsuarios({ badge, escapar, icon, initials, openModal, pathFor, showToast });
  montarInstituciones({ badge, escapar, icon, openModal, pathFor, showToast });
}

function institutionTableRow(institution) {
  return `<tr data-institution-row="${institution.id}" data-site-row="${`${institution.name} ${institution.nit} ${institution.city} ${institution.advisors.join(" ")}`.toLowerCase()}" data-agreement="${institution.agreement}" data-institution-status="${institution.status}"><td data-institution-list-field="nit">${institution.nit}</td><td><div class="person"><span class="stat-icon blue">${icon("building")}</span><span><a class="profile-link" data-institution-list-field="name" href="${pathFor("director", "institucion")}?id=${institution.id}">${institution.name}</a><small data-institution-list-field="email">${institution.email}</small></span></div></td><td><strong data-institution-list-field="city">${institution.city}</strong><small data-institution-advisors>${institution.advisors.join(" · ")}</small></td><td data-agreement-cell>${badge(institution.agreement, institution.agreement === "Vigente" ? "success" : institution.agreement === "Suspendido" ? "danger" : "warning")}</td><td><strong>${institution.students}</strong></td><td data-institution-status-cell>${badge(institution.status, institution.status === "Activa" ? "success" : "neutral")}</td><td><div class="row-actions"><a class="btn btn-secondary" href="${pathFor("director", "institucion")}?id=${institution.id}">Ver perfil</a><button class="btn btn-secondary" type="button" data-edit-institution="${institution.id}">Editar</button><button class="btn ${institution.status === "Activa" ? "btn-danger" : "btn-secondary"}" type="button" data-toggle-institution="${institution.id}">${institution.status === "Activa" ? "Deshabilitar" : "Habilitar"}</button></div></td></tr>`;
}

function userProfileView() {
  shell('<p class="muted" style="padding:32px;text-align:center">Cargando…</p>', "Perfil de usuario");
  montarPerfilUsuario({ badge, escapar, icon, initials, openModal, pathFor, showToast });
}

function studentPracticeHistoryTable(studentId) {
  const history = studentPracticeHistory[studentId] || [];
  return `<div class="table-wrap"><table><thead><tr><th>Práctica / periodo</th><th>Institución y evaluadores</th><th>Estado de la práctica</th><th>Notas</th><th>Acciones</th></tr></thead><tbody>${history.map((practice) => { const tone = practice.status === "Finalizada" || practice.status === "En desarrollo" ? "success" : practice.status === "Documentación pendiente" ? "warning" : "info"; return `<tr><td><strong>Práctica ${practice.level}</strong><small>${practice.period}</small></td><td><strong>${practice.institution}</strong><small>Docente: ${practice.teacher}</small><small>Asesor: ${practice.advisor}</small></td><td>${badge(practice.status, tone)}<small>Documentos: ${practice.documentStatus || "Aprobados"}</small></td><td>${practice.teacherGrade || practice.advisorGrade ? `<strong>Docente: ${practice.teacherGrade || "Pendiente"}</strong><small>Asesor: ${practice.advisorGrade || "Pendiente"}</small>` : badge("Sin calificar", "neutral")}</td><td><div class="history-actions"><a class="btn btn-secondary" href="${pathFor("director", "practica")}?student=${studentId}&level=${practice.level}">Ver práctica</a>${practice.status === "Finalizada" ? `<button class="btn btn-ghost" type="button" data-download-practice="Práctica ${practice.level} · ${practice.period}">Descargar PDF</button>` : ""}${practice.status === "En desarrollo" ? `<a class="btn btn-ghost" href="${pathFor("director", "asignaciones")}?student=${studentId}">Reasignar sede / tutor</a>` : ""}</div></td></tr>`; }).join("") || '<tr><td colspan="5">Este estudiante aún no tiene prácticas registradas.</td></tr>'}</tbody></table></div>`;
}

function institutionProfileView() {
  shell('<p class="muted" style="padding:32px;text-align:center">Cargando…</p>', "Institución");
  montarPerfilInstitucion({ badge, escapar, icon, initials, openModal, pathFor, showToast });
}

function institutionAdvisorsTable(institution) {
  return `<div class="table-wrap"><table><thead><tr><th>Asesor de sitio</th><th>Institución educativa</th><th>Estudiantes asignados</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${institution.advisors.map((advisorName, index) => { const advisor = advisorDirectory.find((record) => record.name === advisorName); return `<tr><td><div class="person"><span class="avatar">${initials(advisorName)}</span><span><a class="profile-link" href="${pathFor("director", "asesor-perfil")}?id=${advisor?.id || ""}">${advisorName}</a><small>Asesor de sitio</small></span></div></td><td><strong>${institution.name}</strong><small>${institution.city}</small></td><td><strong>${advisor?.studentIds.length || Math.max(1, Math.ceil(institution.students / institution.advisors.length) - index)}</strong><small>Periodo 2026-II</small></td><td>${badge(advisor?.status || "Activo", "success")}</td><td><a class="btn btn-secondary" href="${pathFor("director", "asesor-perfil")}?id=${advisor?.id || ""}">Ver perfil</a></td></tr>`; }).join("")}</tbody></table></div>`;
}

function advisorProfileView() {
  // El perfil del asesor es el mismo perfil de usuario: muestra sus vinculaciones y sus practicantes.
  shell('<p class="muted" style="padding:32px;text-align:center">Cargando…</p>', "Asesor de sitio");
  montarPerfilUsuario({ badge, escapar, icon, initials, openModal, pathFor, showToast });
}

function studentNameToId(name) {
  return { "Laura Gómez Martínez": "laura", "Carlos Ruiz Peña": "carlos", "Ana Torres Vega": "ana", "Diego Mejía León": "diego" }[name];
}

function advisorStudentsTable(assignedStudents) {
  return `<div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>Práctica / institución</th><th>Estado de bitácora</th><th>Evaluación asesor</th><th>Acción</th></tr></thead><tbody>${assignedStudents.map((student) => `<tr><td><div class="person"><span class="avatar">${initials(student[0])}</span><span><a class="profile-link" href="${pathFor("director", "perfil")}?id=${studentNameToId(student[0])}">${student[0]}</a><small>${student[1]}</small></span></div></td><td><strong>${student[2]}</strong><small>${student[3]}</small></td><td>${badge(student[4], student[4] === "Finalizada" ? "success" : student[4] === "Por calificar" ? "warning" : "info")}</td><td>${badge(student[4] === "Finalizada" ? "Evaluado" : "Pendiente", student[4] === "Finalizada" ? "success" : "warning")}</td><td><a class="btn btn-secondary" href="${pathFor("director", "perfil")}?id=${studentNameToId(student[0])}">Ver estudiante</a></td></tr>`).join("")}</tbody></table></div>`;
}

function studentPracticeDetailView() {
  shell('<p class="muted" style="padding:32px;text-align:center">Cargando…</p>', "Detalle de práctica");
  montarPracticaDirector({ badge, escapar, icon, initials, openModal, pathFor, showToast });
}

function templatesView() {
  shell('<p class="muted" style="padding:32px;text-align:center">Cargando…</p>', "Cuestionarios");
  montarCuestionarios({ badge, escapar, icon, openModal, pathFor, showToast });
}

function questionBankMarkup(level) {
  const bank = practiceQuestionBanks[level];
  return `<header class="panel-heading question-bank-heading"><div><span class="eyebrow">Práctica pedagógica ${level}</span><h3>Preguntas configuradas</h3><p>${bank.questions.length} preguntas en el banco de este nivel.</p></div><div class="question-bank-actions"><label class="master-switch"><span><strong>Habilitar preguntas</strong><small>Al activar este switch, los estudiantes de este nivel podrán responderlas en su bitácora.</small></span><input type="checkbox" data-enable-questions="${level}" ${bank.enabled ? "checked" : ""} /><i aria-hidden="true"></i></label><button class="btn btn-primary" type="button" data-add-question="${level}">+ Agregar pregunta</button></div></header>
  <div class="question-bank-list">${bank.questions.length ? bank.questions.map((question, index) => questionBankItem(question, index, level)).join("") : '<div class="empty-state"><strong>Este nivel aún no tiene preguntas</strong><p>Agrega una pregunta abierta o cerrada para comenzar.</p></div>'}</div>`;
}

function questionBankItem(question, index, level) {
  const answerMode = question.answerMode || "single";
  const required = question.required ?? true;
  return `<article class="question-bank-item" draggable="true" data-draggable-question="${question.id}" data-level="${level}"><button class="drag-handle" type="button" title="Arrastra para reordenar" aria-label="Reordenar pregunta">⠿</button><span class="question-number">${index + 1}</span><div class="question-bank-copy"><div><span class="question-type ${question.type === "Cerrada" ? "closed" : "open"}">${question.type}</span>${question.type === "Cerrada" ? `<span class="answer-mode">${answerMode === "multiple" ? "Selección múltiple" : "Selección única"}</span>` : ""}${required ? '<span class="required-label">Obligatoria</span>' : ""}<h4>${question.text}</h4></div>${question.type === "Cerrada" ? `<ol class="question-options ${answerMode}">${question.options.map((option) => `<li><i>${answerMode === "multiple" ? "□" : "○"}</i>${option}</li>`).join("")}</ol>` : '<div class="open-answer-preview"><span>Espacio para respuesta abierta del estudiante</span></div>'}</div><div class="question-item-actions"><button class="btn btn-secondary" type="button" data-edit-question="${question.id}" data-level="${level}">Editar</button><button class="btn btn-danger" type="button" data-delete-question="${question.id}" data-level="${level}">Eliminar</button></div></article>`;
}

function renderQuestionBank(level) {
  selectedQuestionLevel = level;
  const bank = document.querySelector("#question-bank");
  if (bank) bank.innerHTML = questionBankMarkup(level);
  const selector = document.querySelector("[data-question-level]");
  if (selector) selector.value = level;
  document.querySelectorAll("[data-select-question-level]").forEach((button) => {
    button.classList.toggle("active", button.dataset.selectQuestionLevel === level);
    const currentBank = practiceQuestionBanks[button.dataset.selectQuestionLevel];
    button.querySelector("strong").textContent = `${currentBank.questions.length} preguntas`;
    button.querySelector("small").textContent = currentBank.enabled ? "Habilitadas" : "Deshabilitadas";
  });
  updateMasterSaveState();
}

function updateMasterSaveState() {
  const saveButton = document.querySelector("[data-save]");
  if (!saveButton) return;
  const hasPendingChanges = dirtyQuestionLevels.has(selectedQuestionLevel);
  saveButton.disabled = !hasPendingChanges;
  saveButton.className = `btn ${hasPendingChanges ? "btn-primary save-pending" : "btn-secondary"}`;
  saveButton.textContent = hasPendingChanges ? "Guardar cambios del nivel" : "Sin cambios pendientes";
}

function openQuestionCreator(level, questionId = null) {
  const existing = practiceQuestionBanks[level].questions.find((question) => String(question.id) === String(questionId));
  let options = existing?.options?.length ? [...existing.options] : ["", "", "", ""];
  const modal = openModal(`${existing ? "Editar" : "Agregar"} pregunta · Práctica ${level}`, `<form id="question-form"><div class="form-grid question-form-grid"><label class="field"><span>Tipo de pregunta</span><select name="type" data-question-type><option value="Abierta" ${existing?.type === "Abierta" ? "selected" : ""}>Pregunta abierta</option><option value="Cerrada" ${existing?.type === "Cerrada" ? "selected" : ""}>Pregunta cerrada / opción múltiple</option></select></label><label class="field"><span>¿Es obligatoria?</span><select name="required"><option value="true" ${(existing?.required ?? true) ? "selected" : ""}>Sí, es obligatoria</option><option value="false" ${existing?.required === false ? "selected" : ""}>No, es opcional</option></select></label><label class="field question-text-field"><span>Enunciado de la pregunta</span><textarea name="text" required placeholder="Escribe la pregunta que verá el estudiante...">${existing?.text || ""}</textarea></label></div><div data-closed-options><div class="closed-question-settings"><label class="field"><span>Tipo de selección</span><select name="answerMode"><option value="single" ${(existing?.answerMode || "single") === "single" ? "selected" : ""}>Selección única · Radio buttons</option><option value="multiple" ${existing?.answerMode === "multiple" ? "selected" : ""}>Selección múltiple · Checkboxes</option></select></label><button class="btn btn-secondary" type="button" data-add-option>+ Agregar opción</button></div><span class="form-section-title">Opciones de respuesta</span><p class="muted">Agrega al menos dos opciones. Puedes añadir o eliminar alternativas.</p><div class="dynamic-option-list" data-option-list></div></div><div data-open-preview class="notice">El estudiante verá un espacio en blanco para redactar libremente su respuesta.</div><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">${existing ? "Guardar cambios" : "Agregar al banco"}</button></div></form>`);
  const typeSelector = modal.querySelector("[data-question-type]");
  const renderOptions = () => {
    modal.querySelector("[data-option-list]").innerHTML = options.map((option, index) => `<label class="dynamic-option"><span>${index + 1}</span><input name="options" value="${option}" placeholder="Escribe la opción ${index + 1}" /><button type="button" data-remove-dynamic-option="${index}" aria-label="Eliminar opción" ${options.length <= 2 ? "disabled" : ""}>×</button></label>`).join("");
  };
  const syncQuestionType = () => {
    const isClosed = typeSelector.value === "Cerrada";
    modal.querySelector("[data-closed-options]").style.display = isClosed ? "block" : "none";
    modal.querySelector("[data-open-preview]").style.display = isClosed ? "none" : "flex";
    modal.querySelectorAll("[data-closed-options] input, [data-closed-options] select").forEach((input) => {
      input.disabled = !isClosed;
      input.required = isClosed;
    });
  };
  renderOptions();
  syncQuestionType();
  typeSelector.addEventListener("change", syncQuestionType);
  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-add-option]")) {
      options.push("");
      renderOptions();
      syncQuestionType();
    }
    const removeOption = event.target.closest("[data-remove-dynamic-option]");
    if (removeOption && options.length > 2) {
      options = [...modal.querySelectorAll('[name="options"]')].map((input) => input.value);
      options.splice(Number(removeOption.dataset.removeDynamicOption), 1);
      renderOptions();
      syncQuestionType();
    }
  });
  modal.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const type = data.get("type");
    const questionData = {
      id: existing?.id || Date.now(),
      type,
      text: data.get("text").trim(),
      required: data.get("required") === "true",
      answerMode: type === "Cerrada" ? data.get("answerMode") : null,
      options: type === "Cerrada" ? data.getAll("options").map((option) => option.trim()).filter(Boolean) : [],
    };
    if (type === "Cerrada" && questionData.options.length < 2) {
      showToast("La pregunta cerrada necesita al menos dos opciones");
      return;
    }
    if (existing) Object.assign(existing, questionData);
    else practiceQuestionBanks[level].questions.push(questionData);
    dirtyQuestionLevels.add(level);
    modal.remove();
    renderQuestionBank(level);
    showToast(existing ? "Pregunta actualizada correctamente" : "Pregunta agregada al banco correctamente");
  });
}

/** Pantalla de asignaciones (estudiante ↔ docente ↔ asesor ↔ institución). */
function assignmentsView() {
  shell(`<header class="page-title"><div><span class="eyebrow">Vinculación académica</span><h2>Asignaciones de práctica</h2><p>Vincula estudiantes con instituciones, docentes supervisores y asesores de sitio.</p></div><button class="btn btn-primary" data-assign>+ Nueva asignación</button></header><section class="panel"><div class="toolbar assignment-toolbar"><label class="search"><span class="sr-only">Buscar asignación</span><input id="assignment-search" placeholder="Buscar estudiante, cédula o institución..." /></label><select id="assignment-period-filter" aria-label="Filtrar por periodo"><option>Cargando…</option></select><select id="assignment-level-filter" aria-label="Filtrar por nivel"><option value="all">Todos los niveles</option>${["I","II","III","IV","V","VI","VII","VIII"].map((level, index) => `<option value="${index + 1}">Práctica ${level}</option>`).join("")}</select><select id="assignment-status-filter" aria-label="Filtrar por estado"><option value="all">Todas las asignaciones</option><option value="SIN_DOCENTE">Sin Docente</option><option value="SIN_ASESOR">Sin Asesor</option><option value="COMPLETA">Asignación Completa</option></select></div><div id="assignment-table"></div></section>`, "Asignaciones");
  montarAsignaciones({ badge, escapar, initials, openModal, showToast });
}

function assignmentState(record) {
  if (!record.teacher) return { label: "Sin Docente", tone: "warning" };
  if (!record.advisor) return { label: "Sin Asesor", tone: "warning" };
  return { label: "Completa", tone: "success" };
}

function assignmentTableMarkup(records = assignmentRecords) {
  return `<div class="table-wrap"><table class="assignment-table"><thead><tr><th>Estudiante</th><th>Práctica / institución</th><th>Docente supervisor</th><th>Asesor de sitio</th><th>Estado de asignación</th><th>Acción</th></tr></thead><tbody>${records.map((record) => { const institution = institutionDirectory.find((item) => item.id === record.institutionId); const state = assignmentState(record); return `<tr data-assignment-row="${record.id}" data-assignment-search="${`${record.student} ${record.document} ${institution?.name || ""}`.toLowerCase()}" data-period="${record.period}" data-level="${record.level}" data-assignment-state="${state.label}"><td><div class="person"><span class="avatar">${initials(record.student)}</span><span><strong>${record.student}</strong><small>${record.document} · ${record.program}</small></span></div></td><td><strong>Práctica ${record.level}</strong><small>${institution?.name || "Sin institución"}</small></td><td>${record.teacher ? `<strong>${record.teacher}</strong><small>Docente UDI</small>` : badge("Sin asignar", "warning")}</td><td>${record.advisor ? `<strong>${record.advisor}</strong><small>${institution?.name || ""}</small>` : badge("Sin asignar", "warning")}</td><td>${badge(state.label, state.tone)}</td><td><button class="btn btn-secondary" type="button" data-reassign="${record.id}">Reasignar</button></td></tr>`; }).join("") || '<tr><td colspan="6"><div class="empty-state">No hay asignaciones para los filtros seleccionados.</div></td></tr>'}</tbody></table></div><footer class="pagination"><span>Mostrando ${records.length} de ${assignmentRecords.length} asignaciones</span><nav><button disabled>‹</button><button class="active">1</button><button disabled>›</button></nav></footer>`;
}

function filterAssignments() {
  return; // el listado real lo gestiona asignacionesAdmin.js
  const query = document.querySelector("#assignment-search")?.value.toLowerCase() || "";
  const period = document.querySelector("#assignment-period-filter")?.value || "2026-II";
  const level = document.querySelector("#assignment-level-filter")?.value || "all";
  const status = document.querySelector("#assignment-status-filter")?.value || "all";
  const filtered = assignmentRecords.filter((record) => {
    const institution = institutionDirectory.find((item) => item.id === record.institutionId);
    const searchable = `${record.student} ${record.document} ${institution?.name || ""}`.toLowerCase();
    return searchable.includes(query)
      && record.period === period
      && (level === "all" || record.level === level)
      && (status === "all" || assignmentState(record).label === status);
  });
  const table = document.querySelector("#assignment-table");
  if (table) table.innerHTML = assignmentTableMarkup(filtered);
}

function openAssignmentEditor(record = null) {
  const isEditing = Boolean(record);
  const validInstitutions = institutionDirectory.filter((institution) => institution.status === "Activa" && institution.agreement === "Vigente");
  const selectedInstitutionId = record?.institutionId || validInstitutions[0]?.id;
  const studentField = isEditing
    ? `<label class="field"><span>Estudiante</span><input value="${record.student} · ${record.document}" disabled /></label>`
    : `<label class="field assignment-student-field"><span>Estudiante activo sin asignación</span><div class="student-combobox" data-student-combobox><input type="text" data-student-combobox-input placeholder="Seleccionar estudiante por nombre o cédula..." autocomplete="off" required role="combobox" aria-expanded="false" aria-controls="student-combobox-options" /><input type="hidden" name="studentId" data-student-combobox-value /><div class="student-combobox-options" id="student-combobox-options" data-student-combobox-options role="listbox" hidden>${studentsWithoutAssignment.map((student) => `<button type="button" role="option" data-student-combobox-option="${student.id}" data-search="${`${student.name} ${student.document}`.toLowerCase()}"><span class="avatar">${initials(student.name)}</span><span><strong>${student.name}</strong><small>${student.document} · ${student.program}</small></span></button>`).join("")}</div></div><small>Escribe para filtrar y selecciona una coincidencia de la lista.</small></label>`;
  const modal = openModal(isEditing ? `Reasignar práctica · ${record.student}` : "Nueva asignación de práctica", `<form id="assignment-form"><div class="assignment-form-intro"><span>1</span><div><strong>${isEditing ? "Actualiza la vinculación" : "Selecciona al estudiante y nivel"}</strong><small>Periodo académico 2026-II</small></div></div><div class="form-grid">${studentField}<label class="field"><span>Nivel de práctica</span><select name="level" required>${["I","II","III","IV","V","VI","VII","VIII"].map((level) => `<option value="${level}" ${record?.level === level ? "selected" : ""}>Práctica ${level}</option>`).join("")}</select></label></div><div class="assignment-form-intro"><span>2</span><div><strong>Define la sede y los evaluadores</strong><small>Solo se muestran instituciones activas con convenio vigente.</small></div></div><div class="form-grid"><label class="field"><span>Institución / sede</span><select name="institutionId" data-assignment-institution required>${validInstitutions.map((institution) => `<option value="${institution.id}" ${selectedInstitutionId === institution.id ? "selected" : ""}>${institution.name} · ${institution.city}</option>`).join("")}</select></label><label class="field"><span>Docente supervisor UDI</span><select name="teacher"><option value="">Sin asignar por ahora</option><option ${record?.teacher === "Juan Suárez López" ? "selected" : ""}>Juan Suárez López</option><option ${record?.teacher === "Claudia Martínez" ? "selected" : ""}>Claudia Martínez</option></select></label><label class="field"><span>Asesor de sitio</span><select name="advisor" data-assignment-advisor><option value="">Sin asignar por ahora</option></select><small>La lista depende de la institución seleccionada.</small></label></div><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">${isEditing ? "Actualizar vinculación" : "Crear asignación"}</button></div></form>`);
  const institutionSelect = modal.querySelector("[data-assignment-institution]");
  const advisorSelect = modal.querySelector("[data-assignment-advisor]");
  const updateAdvisors = () => {
    const advisors = advisorDirectory.filter((advisor) => advisor.institutionId === institutionSelect.value && advisor.status === "Activo");
    advisorSelect.innerHTML = `<option value="">Sin asignar por ahora</option>${advisors.map((advisor) => `<option value="${advisor.name}" ${record?.advisor === advisor.name ? "selected" : ""}>${advisor.name}</option>`).join("")}`;
  };
  updateAdvisors();
  institutionSelect.addEventListener("change", updateAdvisors);
  const combobox = modal.querySelector("[data-student-combobox]");
  const comboboxInput = modal.querySelector("[data-student-combobox-input]");
  const comboboxValue = modal.querySelector("[data-student-combobox-value]");
  const comboboxOptions = modal.querySelector("[data-student-combobox-options]");
  const showCombobox = () => {
    comboboxOptions.hidden = false;
    comboboxInput.setAttribute("aria-expanded", "true");
  };
  const hideCombobox = () => {
    comboboxOptions.hidden = true;
    comboboxInput.setAttribute("aria-expanded", "false");
  };
  comboboxInput?.addEventListener("focus", showCombobox);
  comboboxInput?.addEventListener("input", () => {
    comboboxValue.value = "";
    const query = comboboxInput.value.toLowerCase();
    comboboxOptions.querySelectorAll("[data-student-combobox-option]").forEach((option) => option.hidden = !option.dataset.search.includes(query));
    showCombobox();
  });
  comboboxOptions?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-student-combobox-option]");
    if (!option) return;
    const student = studentsWithoutAssignment.find((item) => item.id === option.dataset.studentComboboxOption);
    comboboxInput.value = `${student.name} · ${student.document}`;
    comboboxValue.value = student.id;
    hideCombobox();
  });
  modal.addEventListener("click", (event) => {
    if (combobox && !event.target.closest("[data-student-combobox]")) hideCombobox();
  });
  modal.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    if (!isEditing && !data.get("studentId")) {
      showToast("Selecciona un estudiante de la lista de coincidencias");
      comboboxInput.focus();
      showCombobox();
      return;
    }
    if (isEditing) {
      record.level = data.get("level");
      record.institutionId = data.get("institutionId");
      record.teacher = data.get("teacher") || null;
      record.advisor = data.get("advisor") || null;
    } else {
      const student = studentsWithoutAssignment.find((item) => item.id === data.get("studentId"));
      assignmentRecords.push({ id: `asg-${student.id}`, studentId: student.id, student: student.name, document: student.document, program: student.program, level: data.get("level"), period: "2026-II", institutionId: data.get("institutionId"), teacher: data.get("teacher") || null, advisor: data.get("advisor") || null });
      studentsWithoutAssignment.splice(studentsWithoutAssignment.indexOf(student), 1);
    }
    modal.remove();
    filterAssignments();
    showToast(isEditing ? "Vinculación actualizada correctamente" : "Asignación creada correctamente");
  });
}

/** Pantalla de auditoría documental. */
function auditView() {
  shell(`<header class="page-title"><div><span class="eyebrow">Control documental</span><h2>Auditoría de expedientes</h2><p>Revisa, aprueba o rechaza los soportes legales de cada estudiante.</p></div><div class="audit-summary" id="audit-summary"></div></header>
  <div class="audit-toolbar">
    <label class="search"><span class="sr-only">Buscar estudiante</span><input id="audit-search" placeholder="Buscar por nombre o cédula del estudiante..." /></label>
    <label class="field"><span>Práctica</span><select id="audit-practice-filter"><option value="all">Todas las prácticas</option>${["I","II","III","IV","V","VI","VII","VIII"].map((nivel, indice) => `<option value="${indice + 1}">Práctica ${nivel}</option>`).join("")}</select></label>
    <label class="field"><span>Periodo</span><select id="audit-period-filter"><option>Cargando…</option></select></label>
    <label class="field"><span>Estado</span><select id="audit-filter"><option value="all">Todos los estados</option><option value="EN_REVISION">Pendientes</option><option value="POR_CORREGIR">Por corregir</option><option value="INCOMPLETO">Incompletos</option><option value="COMPLETO">Aprobados</option></select></label>
  </div>
  <section class="audit-layout">
    <aside class="panel audit-students">
      <header class="panel-heading"><div><h3>Expedientes de estudiantes</h3><p>Selecciona un estudiante para revisar sus documentos</p></div></header>
      <div id="audit-student-list"></div>
    </aside>
    <article class="panel" id="audit-detail"></article>
  </section>`, "Auditoría documental");
  montarAuditoria({ badge, escapar, icon, initials, openModal, showToast });
}

function auditGlobalStatus(student) {
  if (student.documents.some((document) => document[1] === "Rechazado")) return "Por corregir";
  if (student.documents.length === 4 && student.documents.every((document) => document[1] === "Aprobado")) return "Aprobado";
  return "Pendiente";
}

function auditSummaryMarkup() {
  const counts = auditRecords.reduce((result, student) => {
    result[auditGlobalStatus(student)] += 1;
    return result;
  }, { Pendiente: 0, "Por corregir": 0, Aprobado: 0 });
  return `<button type="button" class="quick-filter warning" data-audit-quick-filter="Pendiente"><span>${counts.Pendiente}</span> pendientes</button><button type="button" class="quick-filter correction" data-audit-quick-filter="Por corregir"><span>${counts["Por corregir"]}</span> por corregir</button><button type="button" class="quick-filter success" data-audit-quick-filter="Aprobado"><span>${counts.Aprobado}</span> aprobados</button>`;
}

function auditStudentItem(student, active = false) {
  const approved = student.documents.filter((document) => document[1] === "Aprobado").length;
  const status = auditGlobalStatus(student);
  const tone = status === "Aprobado" ? "success" : "warning";
  return `<button class="audit-student ${active ? "active" : ""}" type="button" data-audit-student="${student.id}" data-search-value="${`${student.name} ${student.program} ${student.institution}`.toLowerCase()}" data-status="${status}" data-practice="${student.practice}" data-period="${student.period}">
    <span class="avatar">${initials(student.name)}</span>
    <span class="audit-student-copy"><strong>${student.name}</strong><small>${student.program}</small><small>${student.institution}</small><span class="progress"><span style="width:${approved * 25}%"></span></span></span>
    <span class="audit-student-status">${badge(status, tone)}<small>${student.period}</small><small>${approved}/4 válidos</small></span>
  </button>`;
}

function auditDetail(student) {
  const status = auditGlobalStatus(student);
  const allApproved = student.documents.length === 4 && student.documents.every((document) => document[1] === "Aprobado");
  const hasRejected = student.documents.some((document) => document[1] === "Rechazado");
  return `<header class="panel-heading audit-detail-heading"><div class="person"><span class="avatar">${initials(student.name)}</span><span><h3>${student.name}</h3><p>${student.program} · ${student.institution}</p></span></div>${badge(status, status === "Aprobado" ? "success" : "warning")}</header>
    <div class="audit-notice"><span class="doc-icon blue">${icon("shield")}</span><div><strong>Validación documental</strong><p>Verifica vigencia, legibilidad, firmas y convenio activo con la institución antes de aprobar.</p></div></div>
    <div class="audit-documents">${student.documents.map((document, index) => auditDocumentRow(student.id, document, index)).join("")}</div>
    <footer class="audit-footer"><div><strong>Estado del expediente</strong><small>${student.documents.filter((document) => document[1] === "Aprobado").length} de 4 documentos aprobados</small></div><button class="btn ${allApproved ? "btn-secondary" : "btn-primary"}" data-approve-file="${student.id}" ${allApproved || hasRejected ? "disabled" : ""}>${allApproved ? "Expediente totalmente aprobado ✓" : hasRejected ? "Corrige los documentos rechazados" : "Aprobar expediente completo"}</button></footer>`;
}

function auditDocumentRow(studentId, document, index) {
  const [name, status, detail] = document;
  const tone = status === "Aprobado" ? "success" : status === "Rechazado" ? "danger" : "warning";
  const color = status === "Aprobado" ? "green" : status === "Rechazado" ? "red" : "orange";
  const visibleStatus = status === "En revisión" ? "Pendiente" : status;
  return `<section class="audit-document" data-document-index="${index}">
    <span class="doc-icon ${color}">${icon("file")}</span>
    <div class="audit-document-copy"><div><h3>${name}</h3>${badge(visibleStatus, tone)}</div><p>${detail}</p></div>
    <div class="audit-document-actions">
      <button class="btn btn-ghost" type="button" data-preview-document="${studentId}" data-index="${index}">Ver PDF</button>
      ${status === "Aprobado" ? `<div class="document-more"><button class="more-button" type="button" data-document-menu aria-label="Más acciones">⋮</button><div class="document-more-menu" hidden><button type="button" data-reset-document="${studentId}" data-index="${index}">Cambiar a pendiente</button><button type="button" data-reject-document="${studentId}" data-index="${index}">Rechazar con motivo</button></div></div>` : `<button class="btn btn-secondary" type="button" data-approve-document="${studentId}" data-index="${index}">Aprobar</button><button class="btn btn-danger" type="button" data-reject-document="${studentId}" data-index="${index}">Rechazar</button>`}
    </div>
  </section>`;
}

function refreshAuditStudent(studentId) {
  const student = auditRecords.find((record) => record.id === studentId);
  if (!student) return;
  student.status = auditGlobalStatus(student);
  const list = document.querySelector("#audit-student-list");
  const detail = document.querySelector("#audit-detail");
  const summary = document.querySelector("#audit-summary");
  if (list) list.innerHTML = auditRecords.map((record) => auditStudentItem(record, record.id === studentId)).join("");
  if (detail) detail.innerHTML = auditDetail(student);
  if (summary) summary.innerHTML = auditSummaryMarkup();
  applyAuditFilters();
}

function applyAuditFilters() {
  const query = document.querySelector("#audit-search")?.value.toLowerCase() || "";
  const status = document.querySelector("#audit-filter")?.value || "all";
  const practice = document.querySelector("#audit-practice-filter")?.value || "all";
  const period = document.querySelector("#audit-period-filter")?.value || "all";
  document.querySelectorAll("[data-audit-student]").forEach((item) => {
    item.hidden = !item.dataset.searchValue.includes(query)
      || (status !== "all" && item.dataset.status !== status)
      || (practice !== "all" && item.dataset.practice !== practice)
      || (period !== "all" && item.dataset.period !== period);
  });
}

function applyUserFilters() {
  const rows = [...document.querySelectorAll("[data-user-row]")];
  if (!rows.length) return;
  const query = document.querySelector("[data-search]")?.value.toLowerCase() || "";
  const roleFilter = document.querySelector("#user-role-filter")?.value || "all";
  const semesterFilter = document.querySelector("#user-semester-filter")?.value || "all";
  const statusFilter = document.querySelector("#user-status-filter")?.value || "all";
  const matchingRows = rows.filter((row) => row.dataset.row.includes(query)
    && (roleFilter === "all" || row.dataset.role === roleFilter)
    && (semesterFilter === "all" || row.dataset.semester === semesterFilter)
    && (statusFilter === "all" || row.dataset.statusValue === statusFilter));
  const totalPages = Math.max(1, Math.ceil(matchingRows.length / usersPerPage));
  currentUsersPage = Math.min(currentUsersPage, totalPages);
  const start = (currentUsersPage - 1) * usersPerPage;
  const visibleRows = new Set(matchingRows.slice(start, start + usersPerPage));
  rows.forEach((row) => row.hidden = !visibleRows.has(row));
  const summary = document.querySelector("[data-pagination-summary]");
  if (summary) summary.textContent = matchingRows.length
    ? `${start + 1} - ${Math.min(start + usersPerPage, matchingRows.length)} de ${matchingRows.length} usuarios`
    : "0 usuarios encontrados";
  const buttons = document.querySelector("[data-pagination-buttons]");
  if (buttons) buttons.innerHTML = `<button type="button" data-users-page="${currentUsersPage - 1}" ${currentUsersPage === 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>${Array.from({ length: totalPages }, (_, index) => `<button type="button" class="${currentUsersPage === index + 1 ? "active" : ""}" data-users-page="${index + 1}">${index + 1}</button>`).join("")}<button type="button" data-users-page="${currentUsersPage + 1}" ${currentUsersPage === totalPages ? "disabled" : ""} aria-label="Página siguiente">›</button>`;
}

function applyInstitutionFilters() {
  const rows = [...document.querySelectorAll("[data-institution-row]")];
  if (!rows.length) return;
  const query = document.querySelector("[data-site-search]")?.value.toLowerCase() || "";
  const agreement = document.querySelector("#institution-agreement-filter")?.value || "all";
  const status = document.querySelector("#institution-status-filter")?.value || "all";
  const matchingRows = rows.filter((row) => row.dataset.siteRow.includes(query)
    && (agreement === "all" || row.dataset.agreement === agreement)
    && (status === "all" || row.dataset.institutionStatus === status));
  const totalPages = Math.max(1, Math.ceil(matchingRows.length / institutionsPerPage));
  currentInstitutionsPage = Math.min(currentInstitutionsPage, totalPages);
  const start = (currentInstitutionsPage - 1) * institutionsPerPage;
  const visibleRows = new Set(matchingRows.slice(start, start + institutionsPerPage));
  rows.forEach((row) => row.hidden = !visibleRows.has(row));
  const summary = document.querySelector("[data-institution-pagination-summary]");
  if (summary) summary.textContent = matchingRows.length
    ? `${start + 1} - ${Math.min(start + institutionsPerPage, matchingRows.length)} de ${matchingRows.length} instituciones`
    : "0 instituciones encontradas";
  const buttons = document.querySelector("[data-institution-pagination-buttons]");
  if (buttons) buttons.innerHTML = `<button type="button" data-institutions-page="${currentInstitutionsPage - 1}" ${currentInstitutionsPage === 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>${Array.from({ length: totalPages }, (_, index) => `<button type="button" class="${currentInstitutionsPage === index + 1 ? "active" : ""}" data-institutions-page="${index + 1}">${index + 1}</button>`).join("")}<button type="button" data-institutions-page="${currentInstitutionsPage + 1}" ${currentInstitutionsPage === totalPages ? "disabled" : ""} aria-label="Página siguiente">›</button>`;
}

function updateInstitutionInterface(institution) {
  const row = document.querySelector(`[data-institution-row="${institution.id}"]`);
  if (row) {
    ["nit", "name", "email", "city"].forEach((field) => {
      row.querySelector(`[data-institution-list-field="${field}"]`).textContent = institution[field];
    });
    row.querySelector("[data-institution-advisors]").textContent = institution.advisors.join(" · ");
    row.dataset.siteRow = `${institution.name} ${institution.nit} ${institution.city} ${institution.advisors.join(" ")}`.toLowerCase();
    row.dataset.agreement = institution.agreement;
    row.dataset.institutionStatus = institution.status;
    row.querySelector("[data-agreement-cell]").innerHTML = badge(institution.agreement, institution.agreement === "Vigente" ? "success" : institution.agreement === "Suspendido" ? "danger" : "warning");
    row.querySelector("[data-institution-status-cell]").innerHTML = badge(institution.status, institution.status === "Activa" ? "success" : "neutral");
  }
  document.querySelectorAll("[data-institution-profile-field]").forEach((element) => {
    element.textContent = institution[element.dataset.institutionProfileField];
  });
  const agreementBadge = document.querySelector("[data-profile-agreement-badge]");
  if (agreementBadge) agreementBadge.innerHTML = badge(`Convenio ${institution.agreement.toLowerCase()}`, institution.agreement === "Vigente" ? "success" : institution.agreement === "Suspendido" ? "danger" : "warning");
  const statusBadge = document.querySelector("[data-profile-status-badge]");
  if (statusBadge) statusBadge.innerHTML = badge(institution.status, institution.status === "Activa" ? "success" : "neutral");
  document.querySelectorAll(`[data-toggle-institution="${institution.id}"]`).forEach((button) => {
    button.textContent = institution.status === "Activa" ? (view === "institucion" ? "Deshabilitar institución" : "Deshabilitar") : (view === "institucion" ? "Habilitar institución" : "Habilitar");
    button.className = `btn ${institution.status === "Activa" ? "btn-danger" : view === "institucion" ? "btn-primary" : "btn-secondary"}`;
  });
  applyInstitutionFilters();
}

const studentDocumentRecords = [
  { name: "Cédula de ciudadanía", status: "Aprobado", file: "cedula-laura-gomez.pdf", detail: "Aprobado por Dirección · 12 Ago 2026" },
  { name: "Certificado de afiliación ARL", status: "En revisión", file: "certificado-arl.pdf", detail: "Enviado el 14 Ago 2026 · Pendiente de validación por Dirección" },
  { name: "Hoja de vida", status: "Sin cargar", file: "", detail: "Carga un archivo PDF legible · Máx. 5 MB" },
  { name: "Carta de aceptación", status: "Por corregir", file: "carta-aceptacion.pdf", detail: "Observación: La carta no cuenta con el sello institucional visible." },
];

const estEstado = { periodos: [], periodoId: null, peticion: 0, practica: null };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** Fecha en formato corto ("12 oct") para las tarjetas del estudiante. */
const fechaCorta = (valor) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ""));
  return m ? `${m[3]} ${MESES[Number(m[2]) - 1]} ${m[1]}` : "Por definir";
};

function estadoBitacoraEstudiante(practica) {
  const d = practica.documentos;
  const habilitada = Boolean(d && d.total > 0 && d.aprobados >= d.total);
  const b = practica.bitacora;
  if (b) {
    if (b.estado === "BORRADOR") return { texto: "Borrador en progreso", clase: "", detalle: "Continuar diligenciamiento →", enlace: "bitacora" };
    if (b.estado === "EVALUADA") return { texto: "Evaluada", clase: "complete", detalle: "Revisa tus calificaciones", enlace: "bitacora" };
    if (["ENVIADA", "EN_EVALUACION"].includes(b.estado)) return { texto: "Entregada", clase: "complete", detalle: "Entrega definitiva registrada", enlace: "bitacora" };
    return { texto: b.estado, clase: "", detalle: "Ver bitácora →", enlace: "bitacora" };
  }
  if (habilitada) return { texto: "Sin iniciar", clase: "", detalle: "Comenzar diligenciamiento →", enlace: "bitacora" };
  return { texto: "Bloqueada", clase: "locked", detalle: "Requiere expediente aprobado", enlace: "documentos" };
}

function tarjetaNota(titulo, persona, evaluacion, ayuda) {
  const publicada = evaluacion?.nota != null;
  return `<div class="practice-grade"><span>${titulo}</span><strong>${publicada ? Number(evaluacion.nota).toFixed(2) : "—"}</strong><small>${escapar(persona?.nombre_completo || "Sin asignar")}${publicada ? "" : " · Pendiente"}</small>${publicada ? "" : `<p class="grade-help">${ayuda}</p>`}</div>`;
}

/** Contenido del panel del estudiante (práctica, estado de bitácora y notas). */
function studentDashboardContent(practica) {
  const periodo = estEstado.periodos.find((p) => p.id === estEstado.periodoId);
  const control = `<label class="field"><span>Consultar periodo</span><select data-student-period ${estEstado.periodos.length ? "" : "disabled"}>${estEstado.periodos.map((p) => `<option value="${escapar(p.id)}" ${p.id === estEstado.periodoId ? "selected" : ""}>${escapar(p.codigo)}${p.es_activo ? " (activo)" : ""}</option>`).join("") || "<option>Sin periodos</option>"}</select></label>`;
  if (!practica) {
    return `<section class="welcome"><div><span class="eyebrow">Mi práctica</span><h2>Sin práctica asignada</h2><p>No tienes una práctica registrada en el periodo ${escapar(periodo?.codigo || "seleccionado")}. Si crees que es un error, comunícate con la Dirección del Programa.</p></div>${control}</section>`;
  }
  const finalizada = practica.estado === "FINALIZADA";
  const d = practica.documentos || { aprobados: 0, total: 0 };
  const bit = estadoBitacoraEstudiante(practica);
  const hero = `<section class="practice-hero ${finalizada ? "completed" : ""}"><div><span>Institución asignada</span><h3>${escapar(practica.institucion.nombre)}</h3><p>${escapar(practica.institucion.ciudad || "")}</p></div><div class="practice-details"><div><span>Docente supervisor</span><strong>${escapar(practica.docente?.nombre_completo || "Sin asignar")}</strong></div><div><span>Asesor de sitio</span><strong>${escapar(practica.asesor?.nombre_completo || "Sin asignar")}</strong></div><div><span>${finalizada ? "Periodo de práctica" : "Fecha de inicio"}</span><strong>${finalizada ? `${fechaCorta(practica.fecha_inicio)} – ${fechaCorta(practica.fecha_fin)}` : fechaCorta(practica.fecha_inicio)}</strong></div></div></section>`;
  const notas = `<aside class="panel grade-card"><span class="eyebrow">${finalizada ? "Calificaciones finales" : "Calificaciones independientes"}</span>${tarjetaNota("Nota docente", practica.docente, practica.evaluaciones?.docente, "Tu docente aún no ha publicado la evaluación.")}${tarjetaNota("Nota asesor", practica.asesor, practica.evaluaciones?.asesor, "Tu asesor aún no ha registrado la evaluación final de sitio.")}</aside>`;
  const estadoTexto = { PENDIENTE_DOCUMENTOS: "Pendiente de documentos", ACTIVA: "En desarrollo", PENDIENTE_EVALUACION: "Pendiente de evaluación", FINALIZADA: "Finalizada", CANCELADA: "Cancelada" }[practica.estado] || practica.estado;
  const titulo = `<section class="welcome"><div><span class="eyebrow">${finalizada ? "Historial de prácticas" : "Mi práctica activa"}</span><h2>${escapar(practica.nivel.nombre)}</h2><p>Periodo académico ${escapar(practica.periodo.codigo)} · ${estadoTexto}</p></div>${control}</section>`;
  const atajos = `<section class="stats-grid two student-shortcuts ${finalizada ? "readonly" : ""}"><a class="stat-card" href="${pathFor(role, "documentos")}"><span class="stat-icon green">${icon("file")}</span><div><span>Documentos aprobados</span><strong>${d.aprobados}/${d.total}</strong><small>${d.total && d.aprobados >= d.total ? "Expediente completo" : "Ver expediente →"}</small></div></a><a class="stat-card" href="${pathFor(role, bit.enlace)}"><span class="stat-icon blue">${icon("edit")}</span><div><span>Estado de bitácora</span><strong class="journal-state ${bit.clase}">${bit.texto}</strong><small>${bit.detalle}</small></div></a></section>`;
  const porcentaje = d.total ? Math.round((d.aprobados / d.total) * 100) : 0;
  let progreso;
  if (finalizada) {
    progreso = `<article class="panel content-block"><span class="eyebrow">Consulta histórica · Solo lectura</span><h3>Práctica finalizada</h3><p>Completaste ${escapar(practica.nivel.nombre)} y todos sus requisitos académicos y documentales.</p><div class="progress"><span style="width:100%"></span></div><br>${practica.bitacora?.id ? `<button class="btn btn-secondary" type="button" data-export-logbook="${escapar(practica.bitacora.id)}">Descargar bitácora (PDF)</button>` : ""}</article>`;
  } else if (bit.enlace === "documentos") {
    progreso = `<article class="panel content-block"><h3>Tu progreso</h3><p>Tienes ${d.total - d.aprobados} documentos pendientes de aprobación. La bitácora se habilitará cuando Dirección apruebe todo el expediente.</p><div class="progress"><span style="width:${porcentaje}%"></span></div><br><a class="btn btn-primary" href="${pathFor(role, "documentos")}">Ir a mis documentos →</a></article>`;
  } else {
    progreso = `<article class="panel content-block"><h3>Tu progreso</h3><p>Tu expediente fue aprobado. ${practica.bitacora && practica.bitacora.estado !== "BORRADOR" ? "Tu bitácora ya fue entregada." : "Puedes diligenciar tu bitácora."}</p><span class="badge badge-${bit.clase === "complete" ? "success" : "warning"}">${bit.texto}</span><br><br><a class="btn btn-primary" href="${pathFor(role, "bitacora")}">${practica.bitacora && practica.bitacora.estado !== "BORRADOR" ? "Ver bitácora" : "Continuar bitácora"}</a></article>`;
  }
  return `${titulo}${hero}${atajos}<section class="dashboard-grid">${progreso}${notas}</section>`;
}

/** Panel "Mi práctica" del estudiante. */
async function studentDashboard() {
  shell(`<p class="muted" style="padding:32px;text-align:center">Cargando tu práctica…</p>`, "Mi práctica");
  try {
    estEstado.periodos = (await api.get("/periods")).data;
  } catch (error) {
    estEstado.periodos = [];
    document.querySelector(".page").innerHTML = estadoError(error.message || "No se pudo cargar tu información.", "student-retry");
    return;
  }
  const activo = estEstado.periodos.find((p) => p.es_activo) || estEstado.periodos[0];
  estEstado.periodoId = activo?.id ?? null;
  await cargarPracticaEstudiante();
}

async function cargarPracticaEstudiante() {
  const turno = ++estEstado.peticion;
  const pagina = document.querySelector(".page");
  try {
    const { data } = await api.get("/dashboard", estEstado.periodoId ? { periodo_id: estEstado.periodoId } : {});
    if (turno !== estEstado.peticion) return;
    estEstado.practica = data.practica;
    pagina.innerHTML = studentDashboardContent(data.practica);
  } catch (error) {
    if (turno !== estEstado.peticion) return;
    pagina.innerHTML = estadoError(error.message || "No se pudo cargar tu práctica.", "student-retry");
  }
  const codigo = estEstado.periodos.find((p) => p.id === estEstado.periodoId)?.codigo;
  const chip = document.querySelector(".period-chip");
  if (chip && codigo) chip.textContent = codigo;
  const sub = document.querySelector(".topbar p");
  if (sub && codigo) sub.textContent = `Estudiante · Periodo académico ${codigo}`;
}

function studentDocumentsContent() {
  const approved = studentDocumentRecords.filter((document) => document.status === "Aprobado").length;
  const complete = approved === studentDocumentRecords.length;
  const toneFor = (status) => status === "Aprobado" ? "success" : status === "Por corregir" ? "danger" : status === "En revisión" ? "info" : "neutral";
  const iconToneFor = (status) => status === "Aprobado" ? "green" : status === "Por corregir" ? "red" : status === "En revisión" ? "blue" : "orange";
  const actionFor = (document, index) => {
    if (document.status === "Aprobado") return `<button class="btn btn-secondary" type="button" data-view-document>Ver PDF</button>`;
    if (document.status === "Por corregir") return `<button class="btn btn-primary" type="button" data-student-document-upload="${index}">Reemplazar archivo</button>`;
    if (document.status === "En revisión") return `<button class="btn btn-secondary" type="button" data-student-document-upload="${index}">Reemplazar</button>`;
    return "";
  };
  const cards = studentDocumentRecords.map((document, index) => {
    const empty = document.status === "Sin cargar";
    return `<article class="document-card document-${toneFor(document.status)}"><div class="document-main"><span class="doc-icon ${iconToneFor(document.status)}">${icon(document.status === "Aprobado" ? "check" : "file")}</span><div><h3>${document.name}</h3><p>${document.file || "Aún no has cargado este documento"}</p></div>${badge(document.status, toneFor(document.status))}${actionFor(document, index)}</div>${empty ? `<button class="document-upload-zone" type="button" data-student-document-upload="${index}">${icon("upload")}<span><strong>Arrastra tu archivo aquí o selecciónalo</strong><small>Formato PDF · Máx. 5 MB</small></span></button>` : `<div class="document-audit ${document.status === "Por corregir" ? "needs-correction" : ""}">${document.status === "Por corregir" ? icon("alert") : icon(document.status === "Aprobado" ? "check" : "clock")}<span>${document.detail}</span></div>`}</article>`;
  }).join("");
  return `<header class="page-title"><div><span class="eyebrow">Expediente · Práctica III · 2026-II</span><h2>Documentos de práctica</h2><p>Estos soportes pertenecen exclusivamente a tu Práctica III en la I.E. San José.</p></div>${badge(`${approved} de ${studentDocumentRecords.length} aprobados`, complete ? "success" : "warning")}</header>${complete ? `<div class="document-complete-banner">${icon("check")}<div><strong>Tu expediente documental está completo y verificado.</strong><span>Ya puedes continuar con el diligenciamiento de tus bitácoras.</span></div></div>` : `<div class="notice">Tu bitácora se habilitará cuando Dirección apruebe los ${studentDocumentRecords.length} documentos. Atiende primero los archivos marcados como “Por corregir” o “Sin cargar”.</div>`}<section class="document-list">${cards}</section>`;
}

/** Pantalla de documentos legales del estudiante. */
function documentsView() {
  shell('<p class="muted" style="padding:32px;text-align:center">Cargando…</p>', "Documentos legales");
  montarDocumentosEstudiante({ badge, escapar, icon, showToast });
}

function uploadStudentDocument(index, file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast("Selecciona un archivo en formato PDF");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast("El archivo supera el tamaño máximo de 5 MB");
    return;
  }
  const documentRecord = studentDocumentRecords[index];
  if (!documentRecord) return;
  documentRecord.status = "En revisión";
  documentRecord.file = file.name;
  documentRecord.detail = "Archivo enviado hoy · Pendiente de validación por Dirección";
  document.querySelector(".page").innerHTML = studentDocumentsContent();
  showToast("Archivo enviado para revisión");
}

/** Pantalla de la bitácora del estudiante. */
function journalView() {
  shell('<p class="muted" style="padding:32px;text-align:center">Cargando…</p>', "Bitácora");
  montarBitacoraEstudiante({ badge, escapar, icon, openModal, pathFor, showToast });
}

/** Panel del docente supervisor / asesor de sitio. */
function evaluatorDashboard() {
  shell('<p class="muted" style="padding:32px;text-align:center">Cargando…</p>', role === "asesor" ? "Mis practicantes" : "Mis tutorías");
  montarDashboardEvaluador({ badge, escapar, icon, initials, pathFor, role });
}

/** Pantalla de evaluación (nota de la bitácora). */
function evaluationView() {
  shell('<p class="muted" style="padding:32px;text-align:center">Cargando…</p>', role === "asesor" ? "Evaluación" : "Evaluación académica");
  montarEvaluacion({ badge, escapar, icon, openModal, pathFor, role, showToast });
}

/** Pantalla "Mi cuenta" (vista por defecto si no hay otra para la ruta). */
function accountView() {
  const u = session.usuario;
  const rolesTexto = session.roles.map((r) => r.nombre).join(" · ");
  shell(`<header class="page-title"><div><span class="eyebrow">Perfil y seguridad</span><h2>Configuración de cuenta</h2><p>Actualiza tu información personal y protege el acceso a tu cuenta.</p></div>${badge("Cuenta activa","success")}</header>
  <section class="account-grid">
    <article class="panel account-card"><header class="panel-heading"><div><h3>Información personal y de perfil</h3><p>Datos visibles para la comunidad académica.</p></div></header><form class="account-form" id="account-profile-form" novalidate><div class="account-fields"><label class="field"><span>Nombres</span><input name="nombres" value="${escapar(u.nombres)}" maxlength="100" required /></label><label class="field"><span>Apellidos</span><input name="apellidos" value="${escapar(u.apellidos)}" maxlength="100" required /></label><label class="field"><span>Teléfono (opcional)</span><input name="telefono" type="tel" value="${escapar(u.telefono || "")}" placeholder="607 000 0000" /></label><label class="field"><span>Correo institucional</span><input value="${escapar(u.correo)}" type="email" disabled /><small>El correo institucional no puede modificarse.</small></label><label class="field"><span>Documento</span><input value="${escapar(u.documento || "")}" disabled /></label><label class="field"><span>Rol / Cargo</span><input value="${escapar(rolesTexto)}" disabled /></label><p class="form-error" role="alert" data-account-error hidden></p><button class="btn btn-primary" type="submit" style="align-items:center;justify-content:center">Guardar información</button></div></form></article>
    <article class="panel account-card"><header class="panel-heading"><div><h3>Seguridad y accesos</h3><p>Cambia tu contraseña y protege tu cuenta institucional.</p></div></header><form class="account-form password-account-form" id="password-form"><label class="field"><span>Contraseña actual</span><div class="password-control"><input name="currentPassword" type="password" autocomplete="current-password" required /><button type="button" data-toggle-password aria-label="Mostrar contraseña">${icon("eye")}</button></div></label><label class="field"><span>Nueva contraseña</span><div class="password-control"><input name="newPassword" type="password" autocomplete="new-password" minlength="8" required /><button type="button" data-toggle-password aria-label="Mostrar contraseña">${icon("eye")}</button></div></label><div class="password-strength" data-password-strength><div><i></i><i></i><i></i></div><span>Escribe una nueva contraseña</span></div><ul class="password-criteria"><li data-criterion="length">Al menos 8 caracteres</li><li data-criterion="uppercase">Una letra mayúscula</li><li data-criterion="number">Un número</li></ul><label class="field"><span>Confirmar nueva contraseña</span><div class="password-control"><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /><button type="button" data-toggle-password aria-label="Mostrar contraseña">${icon("eye")}</button></div><small data-password-match>Las contraseñas deben coincidir.</small></label><div class="security-note">${icon("shield")}<span>La sesión se cerrará en otros dispositivos después de actualizar la contraseña.</span></div><p class="form-error" role="alert" data-password-error hidden></p><button class="btn btn-primary" type="submit" data-password-submit disabled>Actualizar contraseña</button></form></article>
  </section>`, "Mi cuenta");
  montarCuenta({ session, initials, showToast });
}

// Tabla de vistas: "rol:vista" → función que la dibuja.
const renderers = {
  "director:dashboard": directorDashboard, "director:usuarios": usersView, "director:plantillas": templatesView, "director:asignaciones": assignmentsView, "director:auditoria": auditView,
  "director:perfil": userProfileView, "director:institucion": institutionProfileView,
  "director:asesor-perfil": advisorProfileView,
  "director:practica": studentPracticeDetailView,
  "estudiante:dashboard": studentDashboard, "estudiante:documentos": documentsView, "estudiante:bitacora": journalView,
  "asesor:dashboard": evaluatorDashboard, "asesor:evaluacion": evaluationView,
  "docente:dashboard": evaluatorDashboard, "docente:evaluacion": evaluationView,
};

// Dibuja la vista actual (o la cuenta si la combinación no existe).
(renderers[`${role}:${view}`] || accountView)();

// Cambio de rol activo: se valida en el servidor y se redirige al panel del nuevo rol.
document.querySelector("#role-switch")?.addEventListener("change", async (event) => {
  const destino = event.target.value;
  try {
    await elegirRol(ROL_DE_PAGINA[destino]);
    window.location.assign(pathFor(destino, "dashboard"));
  } catch (error) {
    event.target.value = role;
    showToast(error.message);
  }
});
// Cerrar sesión.
document.querySelector(".logout")?.addEventListener("click", () => cerrarSesion());
// Cambio de periodo en el dashboard del director.
document.querySelector("#dashboard-period")?.addEventListener("change", (event) => {
  dashEstado.periodoId = event.target.value;
  dashEstado.pagina = 1;
  cargarDashboardDirector();
});
// Clics del dashboard: paginación, reintentar y descarga del PDF de la bitácora.
document.addEventListener("click", (event) => {
  const pagina = event.target.closest("[data-dashboard-page]");
  if (pagina && !pagina.disabled) { dashEstado.pagina = Number(pagina.dataset.dashboardPage); cargarDashboardDirector(); return; }
  if (event.target.closest("[data-dashboard-retry]")) cargarDashboardDirector();
  if (event.target.closest("[data-student-retry]")) studentDashboard();
  const exportar = event.target.closest("[data-export-logbook]");
  if (exportar) {
    exportar.disabled = true;
    api.descargar(`/logbooks/${exportar.dataset.exportLogbook}/export`, "bitacora.pdf")
      .catch((error) => showToast(error.message || "No se pudo descargar el PDF."))
      .finally(() => { exportar.disabled = false; });
  }
});
const sidebar = document.querySelector(".sidebar");
const backdrop = document.querySelector(".sidebar-backdrop");
document.querySelector(".mobile-menu")?.addEventListener("click", () => { sidebar.classList.add("open"); backdrop.hidden = false; });
function closeMenu() { sidebar.classList.remove("open"); backdrop.hidden = true; }
document.querySelector(".sidebar-close")?.addEventListener("click", (event) => { event.preventDefault(); closeMenu(); });
backdrop?.addEventListener("click", closeMenu);

document.querySelector("[data-search]")?.addEventListener("input", () => { currentUsersPage = 1; applyUserFilters(); });
document.querySelector("#user-role-filter")?.addEventListener("change", () => { currentUsersPage = 1; applyUserFilters(); });
document.querySelector("#user-semester-filter")?.addEventListener("change", () => { currentUsersPage = 1; applyUserFilters(); });
document.querySelector("#user-status-filter")?.addEventListener("change", () => { currentUsersPage = 1; applyUserFilters(); });
document.querySelector("[data-site-search]")?.addEventListener("input", () => { currentInstitutionsPage = 1; applyInstitutionFilters(); });
document.querySelector("#institution-agreement-filter")?.addEventListener("change", () => { currentInstitutionsPage = 1; applyInstitutionFilters(); });
document.querySelector("#institution-status-filter")?.addEventListener("change", () => { currentInstitutionsPage = 1; applyInstitutionFilters(); });
document.querySelector("[data-question-level]")?.addEventListener("change", (event) => {
  const nextLevel = event.target.value;
  if (dirtyQuestionLevels.has(selectedQuestionLevel)) {
    const saveBeforeChanging = window.confirm(`Tienes cambios sin guardar en la Práctica ${selectedQuestionLevel}.\n\nSelecciona Aceptar para guardar y cambiar de nivel, o Cancelar para permanecer en este nivel.`);
    if (!saveBeforeChanging) {
      event.target.value = selectedQuestionLevel;
      return;
    }
    dirtyQuestionLevels.delete(selectedQuestionLevel);
    showToast(`Cambios de Práctica ${selectedQuestionLevel} guardados`);
  }
  renderQuestionBank(nextLevel);
});
document.querySelector("#assignment-search")?.addEventListener("input", filterAssignments);
document.querySelector("#assignment-period-filter")?.addEventListener("change", filterAssignments);
document.querySelector("#assignment-level-filter")?.addEventListener("change", filterAssignments);
document.querySelector("#assignment-status-filter")?.addEventListener("change", filterAssignments);
document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === tab));
  const showInstitutions = tab.dataset.tab === "sites";
  document.querySelector("#users-catalog").hidden = showInstitutions;
  document.querySelector("#sites-catalog").hidden = !showInstitutions;
  const newButton = document.querySelector("[data-new]");
  if (newButton) newButton.textContent = showInstitutions ? "+ Nueva institución" : "+ Nuevo usuario";
  if (showInstitutions) applyInstitutionFilters();
}));
document.querySelectorAll("[data-linked-tab]").forEach((tab) => tab.addEventListener("click", () => {
  const target = tab.dataset.linkedTab;
  document.querySelectorAll("[data-linked-tab]").forEach((item) => {
    const selected = item === tab;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll("[data-linked-panel]").forEach((panel) => panel.hidden = panel.dataset.linkedPanel !== target);
}));
document.querySelectorAll("[data-practice-tab]").forEach((tab) => tab.addEventListener("click", () => {
  const target = tab.dataset.practiceTab;
  document.querySelectorAll("[data-practice-tab]").forEach((item) => {
    const selected = item === tab;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll("[data-practice-panel]").forEach((panel) => panel.hidden = panel.dataset.practicePanel !== target);
}));
document.querySelector("#audit-search")?.addEventListener("input", applyAuditFilters);
document.querySelector("#audit-filter")?.addEventListener("change", applyAuditFilters);
document.querySelector("#audit-practice-filter")?.addEventListener("change", applyAuditFilters);
document.querySelector("#audit-period-filter")?.addEventListener("change", applyAuditFilters);
document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => {
  const row = button.closest("[data-user-row]");
  const activating = button.textContent === "Habilitar";
  button.textContent = activating ? "Deshabilitar" : "Habilitar";
  row.dataset.statusValue = activating ? "Activo" : "Inactivo";
  const statusBadge = row.querySelector(".badge");
  statusBadge.textContent = row.dataset.statusValue;
  statusBadge.className = `badge badge-${activating ? "success" : "neutral"}`;
  applyUserFilters();
  showToast("Estado del usuario actualizado");
}));
document.querySelector("[data-new]")?.addEventListener("click", (clickEvent) => {
  const isInstitution = clickEvent.currentTarget.textContent.includes("institución");
  return; // las altas las gestionan usuariosAdmin.js e institucionesAdmin.js
  const userFields = `<label class="field"><span>Tipo de usuario</span><select data-user-role><option>Estudiante</option><option>Docente</option><option>Asesor</option></select></label><label class="field"><span>Documento</span><input required /></label><label class="field"><span>Nombre completo</span><input required /></label><label class="field"><span>Correo institucional</span><input type="email" required /></label><label class="field" data-student-only><span>Licenciatura</span><select><option>Licenciatura en Educación Infantil</option></select></label><label class="field" data-student-only><span>Semestre actual</span><select><option>1° semestre</option><option>2° semestre</option><option>3° semestre</option><option>4° semestre</option><option>5° semestre</option><option>6° semestre</option><option>7° semestre</option><option>8° semestre</option></select></label><label class="field" data-advisor-only style="display:none"><span>Institución educativa</span><select disabled required><option value="">Seleccionar institución</option>${institutionDirectory.filter((institution) => institution.status === "Activa").map((institution) => `<option value="${institution.id}">${institution.name} · ${institution.city}</option>`).join("")}</select></label>`;
  const institutionFields = `<label class="field"><span>Nombre de la institución</span><input required /></label><label class="field"><span>NIT</span><input required /></label><label class="field"><span>Ciudad</span><input required /></label><label class="field"><span>Dirección</span><input required /></label><label class="field"><span>Correo institucional</span><input type="email" placeholder="contacto@institucion.edu.co" required /></label><label class="field"><span>Teléfono de la institución</span><input type="tel" placeholder="607 000 0000" required /></label><label class="field"><span>Estado del convenio</span><select><option>Vigente</option><option>En trámite</option><option>Suspendido</option></select></label>`;
  const modal = openModal(isInstitution ? "Registrar nueva institución" : "Registrar nuevo usuario", `<form id="new-record"><div class="form-grid">${isInstitution ? institutionFields : userFields}</div>${isInstitution ? "" : '<div class="notice">La contraseña inicial será el documento de identidad.</div>'}<div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar registro</button></div></form>`);
  modal.querySelector("[data-user-role]")?.addEventListener("change", (event) => {
    const isStudent = event.target.value === "Estudiante";
    const isAdvisor = event.target.value === "Asesor";
    modal.querySelectorAll("[data-student-only]").forEach((field) => {
      field.style.display = isStudent ? "flex" : "none";
      field.querySelector("select").disabled = !isStudent;
    });
    modal.querySelectorAll("[data-advisor-only]").forEach((field) => {
      field.style.display = isAdvisor ? "flex" : "none";
      field.querySelector("select").disabled = !isAdvisor;
    });
  });
  modal.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); modal.remove(); showToast(isInstitution ? "Institución registrada correctamente" : "Usuario registrado correctamente"); });
});
document.querySelector("[data-add]")?.addEventListener("click", () => {
  const questions = document.querySelector("#questions");
  const number = questions.children.length + 1;
  questions.insertAdjacentHTML("beforeend", `<div class="question"><span class="question-number">${number}</span><textarea>Escribe aquí la nueva pregunta</textarea><button class="btn btn-ghost" data-remove>×</button></div>`);
});
document.addEventListener("click", (event) => {
  const reassignButton = event.target.closest("[data-reassign]");
  if (reassignButton) {
    const record = assignmentRecords.find((assignment) => assignment.id === reassignButton.dataset.reassign);
    if (record) openAssignmentEditor(record);
  }
  const selectQuestionLevel = event.target.closest("[data-select-question-level]");
  if (selectQuestionLevel) renderQuestionBank(selectQuestionLevel.dataset.selectQuestionLevel);
  const addQuestion = event.target.closest("[data-add-question]");
  if (addQuestion) openQuestionCreator(addQuestion.dataset.addQuestion);
  const editQuestion = event.target.closest("[data-edit-question]");
  if (editQuestion) openQuestionCreator(editQuestion.dataset.level, editQuestion.dataset.editQuestion);
  const deleteQuestion = event.target.closest("[data-delete-question]");
  if (deleteQuestion) {
    const level = deleteQuestion.dataset.level;
    practiceQuestionBanks[level].questions = practiceQuestionBanks[level].questions.filter((question) => String(question.id) !== deleteQuestion.dataset.deleteQuestion);
    dirtyQuestionLevels.add(level);
    renderQuestionBank(level);
    showToast("Pregunta eliminada del banco");
  }
  const profileUserToggle = event.target.closest("[data-toggle-profile-user]");
  if (profileUserToggle) {
    const user = userDirectory.find((record) => record.id === profileUserToggle.dataset.toggleProfileUser);
    if (user) {
      user.status = user.status === "Activo" ? "Inactivo" : "Activo";
      document.querySelector("[data-profile-user-status]").innerHTML = badge(user.status, user.status === "Activo" ? "success" : "neutral");
      profileUserToggle.textContent = user.status === "Activo" ? "Deshabilitar usuario" : "Habilitar usuario";
      profileUserToggle.className = `btn ${user.status === "Activo" ? "btn-danger" : "btn-primary"}`;
      showToast(`Usuario ${user.status === "Activo" ? "habilitado" : "deshabilitado"} correctamente`);
    }
  }
  const practiceDocumentApprove = event.target.closest("[data-practice-document-approve]");
  if (practiceDocumentApprove) {
    const practice = studentPracticeHistory[practiceDocumentApprove.dataset.practiceDocumentApprove]?.find((record) => record.level === practiceDocumentApprove.dataset.level);
    const documentIndex = Number(practiceDocumentApprove.dataset.index);
    if (practice?.documents?.[documentIndex]) {
      practice.documents[documentIndex][1] = "Aprobado";
      const row = practiceDocumentApprove.closest("[data-practice-document-row]");
      row.querySelector("[data-practice-document-status]").innerHTML = badge("Aprobado", "success");
      row.querySelector(".doc-icon").className = "doc-icon green";
      practiceDocumentApprove.remove();
      if (practice.documents.every((document) => document[1] === "Aprobado")) practice.documentStatus = "Aprobados";
      showToast(`${practice.documents[documentIndex][0]} aprobado para la Práctica ${practice.level}`);
    }
  }
  const downloadPractice = event.target.closest("[data-download-practice]");
  if (downloadPractice) {
    showToast(`Preparando ${downloadPractice.dataset.downloadPractice} en PDF`);
    window.setTimeout(() => window.print(), 300);
  }
  const advisorSummary = event.target.closest("[data-advisor-summary]");
  if (advisorSummary) {
    openModal(`Asesor de sitio · ${advisorSummary.dataset.advisorSummary}`, `<div class="content-block"><div class="person"><span class="avatar">${initials(advisorSummary.dataset.advisorSummary)}</span><div><strong>${advisorSummary.dataset.advisorSummary}</strong><small>Asesor de sitio · Usuario activo</small></div></div><p>Este asesor se encuentra vinculado a la institución y tiene prácticas asignadas durante el periodo académico vigente.</p><div class="form-actions"><button class="btn btn-primary" type="button" data-close>Cerrar</button></div></div>`);
  }
  const institutionPageButton = event.target.closest("[data-institutions-page]");
  if (institutionPageButton && !institutionPageButton.disabled) {
    currentInstitutionsPage = Number(institutionPageButton.dataset.institutionsPage);
    applyInstitutionFilters();
  }
  const editInstitutionButton = event.target.closest("[data-edit-institution]");
  if (editInstitutionButton) {
    const institution = institutionDirectory.find((record) => record.id === editInstitutionButton.dataset.editInstitution);
    if (institution) {
      const modal = openModal(`Editar ${institution.name}`, `<form id="edit-institution-form"><p class="muted">Actualiza los datos institucionales y la información del convenio.</p><div class="form-grid"><label class="field"><span>Nombre de la institución</span><input name="name" value="${institution.name}" required /></label><label class="field"><span>NIT</span><input name="nit" value="${institution.nit}" required /></label><label class="field"><span>Ciudad</span><input name="city" value="${institution.city}" required /></label><label class="field"><span>Dirección</span><input name="address" value="${institution.address}" required /></label><label class="field"><span>Correo</span><input name="email" type="email" value="${institution.email}" required /></label><label class="field"><span>Teléfono</span><input name="phone" value="${institution.phone}" required /></label><label class="field"><span>Estado del convenio</span><select name="agreement"><option ${institution.agreement === "Vigente" ? "selected" : ""}>Vigente</option><option ${institution.agreement === "En trámite" ? "selected" : ""}>En trámite</option><option ${institution.agreement === "Suspendido" ? "selected" : ""}>Suspendido</option></select></label></div><div class="notice">Los asesores se vinculan al registrar o editar el perfil de cada Asesor de Sitio.</div><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar cambios</button></div></form>`);
      modal.querySelector("form").addEventListener("submit", (submitEvent) => {
        submitEvent.preventDefault();
        const data = new FormData(submitEvent.target);
        ["name", "nit", "city", "address", "email", "phone", "agreement"].forEach((field) => institution[field] = data.get(field).trim());
        modal.remove();
        updateInstitutionInterface(institution);
        showToast("Información de la institución actualizada");
      });
    }
  }
  const toggleInstitutionButton = event.target.closest("[data-toggle-institution]");
  if (toggleInstitutionButton) {
    const institution = institutionDirectory.find((record) => record.id === toggleInstitutionButton.dataset.toggleInstitution);
    if (institution) {
      institution.status = institution.status === "Activa" ? "Inactiva" : "Activa";
      updateInstitutionInterface(institution);
      showToast(`Institución ${institution.status === "Activa" ? "habilitada" : "deshabilitada"} correctamente`);
    }
  }
  const practiceSummaryButton = event.target.closest("[data-practice-summary]");
  if (practiceSummaryButton) {
    const fila = dashEstado.filas.get(practiceSummaryButton.dataset.practiceSummary);
    if (fila) abrirResumenPractica(fila);
  }
  const pageButton = event.target.closest("[data-users-page]");
  if (pageButton && !pageButton.disabled) {
    currentUsersPage = Number(pageButton.dataset.usersPage);
    applyUserFilters();
  }
  const editUserButton = event.target.closest("[data-edit-user]");
  if (editUserButton) {
    const user = userDirectory.find((record) => record.id === editUserButton.dataset.editUser);
    if (user) {
      const modal = openModal(`Editar ${user.name}`, `<form id="edit-user-form"><p class="muted">Corrige los datos básicos del usuario. El rol y la información académica se mantienen sin cambios.</p><div class="form-grid"><label class="field"><span>Documento de identidad</span><input name="document" value="${user.document}" required /></label><label class="field"><span>Nombre completo</span><input name="name" value="${user.name}" required /></label><label class="field"><span>Correo institucional</span><input name="email" type="email" value="${user.email}" required /></label><label class="field"><span>Rol</span><input value="${user.role}" disabled /></label></div><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar cambios</button></div></form>`);
      modal.querySelector("form").addEventListener("submit", (submitEvent) => {
        submitEvent.preventDefault();
        const data = new FormData(submitEvent.target);
        user.document = data.get("document").trim();
        user.name = data.get("name").trim();
        user.email = data.get("email").trim();
        const row = document.querySelector(`[data-user-row="${user.id}"]`);
        row.querySelector("[data-user-document]").textContent = user.document;
        row.querySelector("[data-user-name]").textContent = user.name;
        row.querySelector("[data-user-email]").textContent = user.email;
        row.querySelector("[data-user-avatar]").textContent = initials(user.name);
        row.dataset.row = `${user.document} ${user.name} ${user.email} ${user.role} ${user.program}`.toLowerCase();
        modal.remove();
        applyUserFilters();
        showToast("Datos del usuario actualizados correctamente");
      });
    }
  }
  const studentButton = event.target.closest("[data-audit-student]");
  if (studentButton) refreshAuditStudent(studentButton.dataset.auditStudent);
  const quickAuditFilter = event.target.closest("[data-audit-quick-filter]");
  if (quickAuditFilter) {
    const filter = document.querySelector("#audit-filter");
    filter.value = quickAuditFilter.dataset.auditQuickFilter;
    document.querySelectorAll("[data-audit-quick-filter]").forEach((button) => button.classList.toggle("active", button === quickAuditFilter));
    applyAuditFilters();
  }
  const documentMenu = event.target.closest("[data-document-menu]");
  if (documentMenu) {
    const menu = documentMenu.nextElementSibling;
    document.querySelectorAll(".document-more-menu").forEach((item) => {
      if (item !== menu) item.hidden = true;
    });
    menu.hidden = !menu.hidden;
  }
  const resetDocument = event.target.closest("[data-reset-document]");
  if (resetDocument) {
    const student = auditRecords.find((record) => record.id === resetDocument.dataset.resetDocument);
    const documentRecord = student?.documents[Number(resetDocument.dataset.index)];
    if (documentRecord) {
      documentRecord[1] = "En revisión";
      documentRecord[2] = "Estado cambiado por Dirección · Pendiente de nueva validación";
      refreshAuditStudent(student.id);
      showToast(`${documentRecord[0]} marcado como pendiente`);
    }
  }
  const previewDocument = event.target.closest("[data-preview-document]");
  if (previewDocument) {
    const student = auditRecords.find((record) => record.id === previewDocument.dataset.previewDocument);
    const documentIndex = Number(previewDocument.dataset.index);
    const documentRecord = student?.documents[documentIndex];
    if (documentRecord) {
      const status = documentRecord[1];
      openModal(`Vista previa · ${documentRecord[0]}`, `<div class="pdf-preview-modal"><div class="pdf-preview-toolbar"><div><strong>${student.name}</strong><small>${student.practice} · ${student.period}</small></div><div>${status !== "Aprobado" ? `<button class="btn btn-secondary" type="button" data-approve-document="${student.id}" data-index="${documentIndex}" data-close>Aprobar</button>` : badge("Documento aprobado", "success")}<button class="btn btn-danger" type="button" data-reject-document="${student.id}" data-index="${documentIndex}" data-close>Rechazar con motivo</button></div></div><div class="pdf-viewer"><div class="pdf-page"><span>PDF</span><h3>${documentRecord[0]}</h3><p>${documentRecord[2]}</p><small>Previsualización integrada del soporte documental</small></div></div></div>`);
    }
  }
  const approveDocument = event.target.closest("[data-approve-document]");
  if (approveDocument) {
    const student = auditRecords.find((record) => record.id === approveDocument.dataset.approveDocument);
    const documentRecord = student?.documents[Number(approveDocument.dataset.index)];
    if (documentRecord) {
      documentRecord[1] = "Aprobado";
      documentRecord[2] = "Validado por dirección · Hoy";
      refreshAuditStudent(student.id);
      showToast(`${documentRecord[0]} aprobado correctamente`);
    }
  }
  const rejectDocument = event.target.closest("[data-reject-document]");
  if (rejectDocument) {
    const student = auditRecords.find((record) => record.id === rejectDocument.dataset.rejectDocument);
    const documentIndex = Number(rejectDocument.dataset.index);
    const documentRecord = student?.documents[documentIndex];
    if (documentRecord) {
      const modal = openModal(`Rechazar ${documentRecord[0]}`, `<form id="reject-document-form"><p class="muted">El rechazo requiere una justificación. Esta observación llegará por correo y notificación al estudiante para que pueda cargar una corrección.</p><label class="field"><span>Motivo del rechazo</span><select name="reason"><option value="La institución no cuenta con convenio vigente">La institución no cuenta con convenio vigente</option><option value="El documento está vencido">El documento está vencido</option><option value="El archivo no es legible">El archivo no es legible</option><option value="Faltan firmas o sellos requeridos">Faltan firmas o sellos requeridos</option><option value="Otro motivo">Otro motivo</option></select></label><label class="field"><span>Observación obligatoria</span><textarea name="comment" required placeholder="Ingresa el motivo por el cual rechazas este documento..."></textarea></label><div class="notice">El estudiante recibirá esta observación y será quien reemplace el archivo rechazado.</div><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Cancelar</button><button class="btn btn-danger" type="submit">Confirmar rechazo</button></div></form>`);
      modal.querySelector("form").addEventListener("submit", (submitEvent) => {
        submitEvent.preventDefault();
        const formData = new FormData(submitEvent.target);
        documentRecord[1] = "Rechazado";
        documentRecord[2] = `${formData.get("reason")}. ${formData.get("comment")}`;
        modal.remove();
        refreshAuditStudent(student.id);
        showToast(`${documentRecord[0]} rechazado. Se notificará al estudiante`);
      });
    }
  }
  const approveFile = event.target.closest("[data-approve-file]");
  if (approveFile && !approveFile.disabled) {
    const student = auditRecords.find((record) => record.id === approveFile.dataset.approveFile);
    student.documents.forEach((document) => {
      if (document[1] !== "Rechazado") {
        document[1] = "Aprobado";
        document[2] = "Validado por Dirección · Hoy";
      }
    });
    refreshAuditStudent(student.id);
    showToast("Expediente completo aprobado por dirección");
  }
  if (event.target.closest("[data-view-document]")) showToast("Abriendo vista previa del documento");
  if (event.target.closest("[data-edit-profile]")) showToast("Edición de perfil habilitada");
  if (event.target.closest("[data-remove]")) event.target.closest(".question").remove();
  if (event.target.closest("[data-save]")) {
    dirtyQuestionLevels.delete(selectedQuestionLevel);
    updateMasterSaveState();
    showToast(`Cuestionario de Práctica ${selectedQuestionLevel} guardado correctamente`);
  }
  if (event.target.closest("[data-approve]")) showToast("Expediente aprobado por dirección");
  if (event.target.closest("[data-draft]")) showToast("Borrador guardado correctamente");
  const sendJournalButton = event.target.closest("[data-send]");
  if (sendJournalButton) {
    const modal = openModal("Confirmar envío de bitácora", `<form data-confirm-journal-send><p class="muted">Tu bitácora quedará enviada para evaluación. Verifica que la reflexión y las evidencias estén completas antes de continuar.</p><div class="notice">Después del envío no podrás modificar el contenido mientras esté en revisión.</div><div class="form-actions"><button class="btn btn-secondary" type="button" data-close>Volver y revisar</button><button class="btn btn-primary" type="submit">Confirmar envío</button></div></form>`);
    modal.querySelector("[data-confirm-journal-send]").addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      modal.remove();
      sendJournalButton.dataset.submitted = "true";
      sendJournalButton.disabled = true;
      sendJournalButton.textContent = "Bitácora enviada";
      const journalStatus = document.querySelector("[data-journal-status]");
      journalStatus.className = "badge badge-neutral";
      journalStatus.textContent = "Bitácora enviada";
      document.querySelector(".journal-save-status").textContent = "Enviada para evaluación";
      showToast("Bitácora enviada para evaluación");
    });
  }
  if (event.target.closest("[data-print]")) window.print();
  if (event.target.closest("[data-evaluation-draft]")) {
    const evaluationStatus = document.querySelector("[data-evaluation-status]");
    if (evaluationStatus) {
      evaluationStatus.className = "badge badge-info";
      evaluationStatus.textContent = "En borrador";
    }
    showToast("Borrador de evaluación guardado");
  }
  if (event.target.closest("[data-grade]")) {
    const evaluationStatus = document.querySelector("[data-evaluation-status]");
    if (evaluationStatus) {
      evaluationStatus.className = "badge badge-success";
      evaluationStatus.textContent = "Evaluado";
    }
    showToast("Evaluación guardada y publicada correctamente");
  }
  if (event.target.closest("[data-finish]")) showToast("Práctica finalizada correctamente");
  const studentDocumentUpload = event.target.closest("[data-student-document-upload]");
  if (studentDocumentUpload) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,application/pdf";
    input.addEventListener("change", () => uploadStudentDocument(Number(studentDocumentUpload.dataset.studentDocumentUpload), input.files[0]));
    input.click();
  }
  if (event.target.closest("[data-upload]")) {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".pdf,image/*"; input.addEventListener("change", () => showToast("Archivo cargado correctamente")); input.click();
  }
});
document.querySelectorAll("[data-toggle-password]").forEach((button) => button.addEventListener("click", () => {
  const input = button.previousElementSibling;
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  button.classList.toggle("active", !showing);
  button.setAttribute("aria-label", showing ? "Mostrar contraseña" : "Ocultar contraseña");
}));
const passwordForm = document.querySelector("#password-form");
const updatePasswordState = () => {
  if (!passwordForm) return;
  const current = passwordForm.elements.currentPassword.value;
  const password = passwordForm.elements.newPassword.value;
  const confirmation = passwordForm.elements.confirmPassword.value;
  const criteria = { length: password.length >= 8, uppercase: /[A-Z]/.test(password), number: /\d/.test(password) };
  Object.entries(criteria).forEach(([name, valid]) => document.querySelector(`[data-criterion="${name}"]`)?.classList.toggle("valid", valid));
  const score = Object.values(criteria).filter(Boolean).length;
  const strength = document.querySelector("[data-password-strength]");
  const labels = ["Escribe una nueva contraseña", "Débil", "Media", "Fuerte"];
  strength.className = `password-strength strength-${score}`;
  strength.querySelector("span").textContent = labels[score];
  strength.querySelectorAll("i").forEach((bar, index) => bar.classList.toggle("active", index < score));
  const matches = Boolean(confirmation) && password === confirmation;
  const matchMessage = document.querySelector("[data-password-match]");
  matchMessage.textContent = matches ? "Las contraseñas coinciden." : "Las contraseñas deben coincidir.";
  matchMessage.classList.toggle("valid", matches);
  document.querySelector("[data-password-submit]").disabled = !(current && matches && score === 3);
};
passwordForm?.addEventListener("input", updatePasswordState);
// Cambios de selects de la vista del estudiante (periodo).
document.addEventListener("change", (event) => {
  const studentPeriod = event.target.closest("[data-student-period]");
  if (studentPeriod) {
    estEstado.periodoId = studentPeriod.value;
    document.querySelector(".page").innerHTML = '<p class="muted" style="padding:32px;text-align:center">Cargando…</p>';
    cargarPracticaEstudiante();
  }
  const enabledControl = event.target.closest("[data-enable-questions]");
  if (enabledControl) {
    const level = enabledControl.dataset.enableQuestions;
    practiceQuestionBanks[level].enabled = enabledControl.checked;
    dirtyQuestionLevels.add(level);
    renderQuestionBank(level);
    showToast(`Preguntas de Práctica ${level} ${enabledControl.checked ? "habilitadas" : "deshabilitadas"}`);
  }
});
document.addEventListener("dragover", (event) => {
  if (event.target.closest("[data-student-document-upload]")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  const documentZone = event.target.closest("[data-student-document-upload]");
  if (!documentZone) return;
  event.preventDefault();
  uploadStudentDocument(Number(documentZone.dataset.studentDocumentUpload), event.dataTransfer.files[0]);
});
document.addEventListener("dragstart", (event) => {
  const item = event.target.closest("[data-draggable-question]");
  if (!item) return;
  draggedQuestion = { id: item.dataset.draggableQuestion, level: item.dataset.level };
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
});
document.addEventListener("dragover", (event) => {
  const target = event.target.closest("[data-draggable-question]");
  if (!target || !draggedQuestion || target.dataset.level !== draggedQuestion.level) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  target.classList.add("drag-over");
});
document.addEventListener("dragleave", (event) => {
  event.target.closest("[data-draggable-question]")?.classList.remove("drag-over");
});
document.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-draggable-question]");
  if (!target || !draggedQuestion || target.dataset.level !== draggedQuestion.level) return;
  event.preventDefault();
  const questions = practiceQuestionBanks[draggedQuestion.level].questions;
  const fromIndex = questions.findIndex((question) => String(question.id) === draggedQuestion.id);
  const toIndex = questions.findIndex((question) => String(question.id) === target.dataset.draggableQuestion);
  if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
    const [moved] = questions.splice(fromIndex, 1);
    questions.splice(toIndex, 0, moved);
    dirtyQuestionLevels.add(draggedQuestion.level);
    renderQuestionBank(draggedQuestion.level);
    showToast("Orden de preguntas actualizado");
  }
  draggedQuestion = null;
});
document.addEventListener("dragend", () => {
  document.querySelectorAll(".dragging, .drag-over").forEach((item) => item.classList.remove("dragging", "drag-over"));
  draggedQuestion = null;
});
applyUserFilters();
applyInstitutionFilters();

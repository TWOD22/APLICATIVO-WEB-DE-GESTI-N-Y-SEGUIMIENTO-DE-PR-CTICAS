# Backend — Sistema de Gestión de Prácticas Pedagógicas UDI

API REST en Node.js + Express con PostgreSQL (fuente de verdad), Firebase Auth / Firestore y Supabase Storage (archivos privados).
Arquitectura por capas: `routes → middlewares → controllers → services → repositories / adapters`.

## Estado de implementación

| Fase (guía §30) | Estado |
|---|---|
| 1. Base técnica (config, logger, errores, PostgreSQL, migraciones, Firebase Admin, `/health`, `/ready`) | ✅ |
| 2. Autenticación, roles, usuarios e instituciones | ✅ |
| 3. Asignaciones (crear, reasignar, cancelar, alcance por rol) | ✅ |
| 4. Documentos legales (carga, versiones, revisión, habilitación de la bitácora) | ✅ (verificar con `pnpm probar:storage`) |
| 5. Cuestionarios y bitácoras (versionado, borrador en Firestore, evidencias, envío idempotente, devolución) | ✅ |
| 6. Evaluaciones (colas por rol, borrador, publicación independiente, reapertura, cierre de la práctica) | ✅ |
| 7.1 Notificaciones (bandeja, marcar leídas) | ✅ |
| 7.2 Exportación de la bitácora a PDF | ✅ |
| 7.3 Dashboards por rol (indicadores, alertas y tabla de seguimiento) | ✅ |
| 7.4 Integración del frontend | ⏳ |
| 8. Seguridad, reglas de Firestore/Storage, despliegue, CI/CD | ⏳ |

El modelo completo (27 tablas) ya está migrado, incluidas las reglas de integridad de las fases siguientes y las tablas del flujo de solicitud v2 (`docentes_niveles`, `evaluaciones_historial`, `guias_criterios`, `eventos_salientes`).

## Puesta en marcha

```bash
cd backend
pnpm install
cp .env.example .env           # completa DATABASE_URL y las credenciales de Firebase
pnpm migrate:up                # crea el esquema
pnpm seed                      # roles, programa, 8 niveles de práctica, documentos requeridos y periodo activo
pnpm dev                       # http://localhost:3000
```

**Director inicial:** crea el usuario en *Firebase Authentication*, copia su UID a `SEED_DIRECTOR_*` en `.env` y vuelve a ejecutar `pnpm seed` (es idempotente).

Comprobaciones: `GET /health` (proceso vivo) y `GET /ready` (PostgreSQL + Firebase + almacenamiento de archivos si está configurado).

## Autenticación

Cada petición: `Authorization: Bearer <Firebase ID Token>`. El backend valida el token con Firebase Admin,
busca al usuario en PostgreSQL, verifica que esté `ACTIVO` y calcula sus roles **vigentes en la base de datos**
(los Custom Claims son solo caché). Con varios roles se envía `X-Active-Role: <ROL>`; el servidor lo valida y
**no suma permisos** entre roles.

## API implementada (`/api/v1`)

| Método y ruta | Rol |
|---|---|
| `GET /me`, `PATCH /me`, `POST /me/active-role`, `POST /auth/logout-all` | cualquiera autenticado |
| `GET/POST /users`, `GET/PATCH /users/:id`, `PATCH /users/:id/status`, `GET /users/:id/practices` | Director |
| `GET/POST /institutions`, `GET/PATCH /institutions/:id`, `PATCH /institutions/:id/status`, `GET /institutions/:id/students`, `GET /institutions/:id/advisors` | Director |
| `POST /practice-assignments`, `PATCH /practice-assignments/:id`, `PATCH /practice-assignments/:id/status` (cancelar), `GET /practice-assignments/eligible-students` | Director |
| `GET /practice-assignments`, `GET /practice-assignments/:id` | cualquier rol, **cada uno ve solo lo suyo** (Docente: sus estudiantes; Asesor: los de su institución a su cargo; Estudiante: su práctica) |
| `GET /practice-assignments/:id/legal-documents` | Director, Estudiante (solo el suyo). **Docente y Asesor: 403** |
| `POST /practice-assignments/:id/legal-documents/:tipoId/upload` | Estudiante (su propia práctica) |
| `POST /legal-documents/:id/review`, `POST /practice-assignments/:id/legal-documents/approve-all`, `GET /legal-documents/expedientes` | Director |
| `GET /legal-documents/:id/download-url` | Director, Estudiante (solo el suyo) |
| `GET /questionnaires`, `GET /questionnaires/:id` | Director y Docente (solo consulta; `gestionable`/`editable` indican si es de su nivel) |
| `POST /questionnaires`, `PATCH /questionnaires/:id`, `GET /questionnaires/:id/publish-impact`, `POST /questionnaires/:id/publish`, `PATCH /questionnaires/:id/enabled`, `POST /questionnaires/:id/questions`, `POST /questionnaires/:id/reorder`, `PATCH/DELETE /questions/:id` | Docente asignado a ese nivel en el periodo activo (`403 NOT_LEVEL_TEACHER` si no) |
| `GET /practice-assignments/:id/logbook`, `GET /logbooks/:id` | Estudiante (la suya; se crea la primera vez), Director, y Docente/Asesor **solo si ya fue enviada** y es de su alcance |
| `POST /practice-assignments/:id/logbook` | Estudiante (obtener o crear: `201` la primera vez, `200` después) |
| `PUT /logbooks/:id/draft`, `POST /logbooks/:id/submit` | Estudiante |
| `POST /logbooks/:id/evidences`, `PATCH/DELETE /logbooks/:id/evidences/:evidenciaId` | Estudiante |
| `GET /logbooks/:id/evidences/:evidenciaId/download-url` | Estudiante, Director, Docente y Asesor (con acceso a la bitácora) |
| `POST /logbooks/:id/return` | Director |
| `GET /evaluations`, `GET /evaluations/:id` | Docente y Asesor (solo su evaluación en sus estudiantes), Estudiante (solo lo **publicado**), Director (todas) |
| `PUT /evaluations/:id/draft`, `POST /evaluations/:id/publish` | Docente (nota académica) y Asesor (nota de sitio) |
| `POST /practice-assignments/:id/finish` | Director |
| `POST /evaluations/:id/correct` | Docente supervisor, Asesor de sitio (solo su propia evaluación) |
| `GET /logbooks/:id/export` | Estudiante, Director, Docente y Asesor (con su alcance): descarga el PDF |
| `GET /dashboard`, `GET /dashboard/practices` | Todos los roles; cada uno ve solo lo suyo (ver «Dashboards») |
| `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` | Cualquier rol (solo la bandeja propia) |
| `GET /programs`, `GET /periods`, `GET /practice-levels` | cualquier rol |

Contrato: `{ data, meta: { request_id } }`, listados con `page, page_size, total, total_pages`,
errores `{ error: { code, message, details, request_id } }`.

Decisiones: los usuarios nuevos se crean en Firebase **sin contraseña**; la respuesta de `POST /users` incluye
`enlace_definir_contrasena` (de un solo uso) para entregárselo a la persona. Asignaciones: docente y asesor son opcionales (estados `SIN_DOCENTE` / `SIN_ASESOR` / `COMPLETA`); el nivel debe
corresponder al semestre del estudiante (Práctica N = semestre N); la institución debe estar activa con convenio
vigente; el asesor debe pertenecer a la institución en ese periodo; un estudiante tiene una sola práctica vigente por
periodo; al cambiar de institución se libera al asesor; un evaluador que ya publicó su nota no puede reemplazarse;
cancelar exige motivo (y `confirmar` si la práctica ya está en curso). Quien consulta una asignación ajena recibe `404`.
Documentos legales: el PDF se envía **al backend** como cuerpo binario (`Content-Type: application/pdf`, nombre en la
cabecera `X-File-Name` codificado con `encodeURIComponent`, máx. 10 MB o el configurado por tipo). El backend comprueba
que sea un PDF real y legible, calcula su SHA-256, lo guarda en el bucket privado con una ruta sin datos personales y
registra la versión; si el registro en PostgreSQL falla, retira el archivo. Reemplazar crea una versión nueva y conserva
la anterior; una versión aprobada no se sobrescribe (Dirección debe devolverla a revisión). Cuando todos los requisitos
obligatorios quedan aprobados la práctica pasa a `ACTIVA` y la bitácora a `BORRADOR`; si luego se devuelve uno y la
bitácora no se ha enviado, vuelve a bloquearse (el borrador se conserva); si ya se envió, no se toca y se alerta a
Dirección. Las descargas son URL firmadas de 15 minutos y las consultas de Dirección quedan auditadas.
Deshabilitar un usuario o institución
con prácticas en curso responde `409 CONFIRMATION_REQUIRED` hasta enviar `"confirmar": true`.

### Cuestionarios y bitácoras (Fase 5)

**Cuestionarios.** Cada nivel tiene versiones numeradas. `POST /questionnaires` crea el siguiente **borrador** copiando por
defecto las preguntas de la versión habilitada (`"sin_copia": true` para empezar en blanco); solo puede haber un borrador por nivel.
Un borrador se edita libremente; `publish` lo deja **inmutable** (el servicio y un trigger de PostgreSQL lo impiden) y lo habilita,
deshabilitando la versión anterior (que se conserva). Solo una versión por nivel puede estar habilitada. Preguntas: `ABIERTA`,
`CERRADA_UNICA` o `CERRADA_MULTIPLE` (2 a 10 opciones, sin repetir). Eliminar una pregunta del borrador es lógico y renumera el orden.

**Quién configura (flujo v2).** El cuestionario lo crea, edita, publica y habilita el docente asignado al nivel en el periodo activo
(`docentes_niveles`); Dirección solo consulta y recibe un aviso cuando el docente publica, habilita o deshabilita. Un docente puede
copiar preguntas (`copiar_de`) de cualquier versión publicada, incluso de otro nivel. Antes de publicar, `GET …/publish-impact` dice
cuántas bitácoras sin cuestionario lo recibirán (`recibiran`) y cuántas conservan su versión (`conservan`); la respuesta de `publish`
trae el mismo `impacto`. La bitácora funciona aunque el nivel no tenga cuestionario habilitado.

**Bitácora.** Se crea la primera vez que el estudiante la consulta: `BLOQUEADA` si faltan documentos aprobados y `BORRADOR` si la
práctica ya está activa. Al estar en `BORRADOR` toma el cuestionario habilitado **en ese momento**; las bitácoras ya iniciadas
conservan su versión aunque Dirección publique otra. Estados: `BLOQUEADA → BORRADOR → ENVIADA → (EN_EVALUACION → EVALUADA, Fase 6)`
y `DEVUELTA` (editable otra vez). Las transiciones `EN_EVALUACION` y `EVALUADA` las produce la Fase 6 (ver abajo).

**Borrador y autoguardado.** `PUT /logbooks/:id/draft` guarda la reflexión y las respuestas **en Firestore**
(`/borradores_bitacora/{bitacora_id}`); PostgreSQL no se toca hasta el envío. El cuerpo reemplaza el borrador completo e incluye
`revision_base` (la revisión que la interfaz vio por última vez). Si otra pestaña guardó antes responde `409 DRAFT_CONFLICT`
con `details: [{ revision_actual }]`. Si Firestore falla responde `502 DRAFT_STORE_ERROR` (nunca se simula un guardado). La respuesta
trae `requisitos` (palabras, evidencias, preguntas obligatorias pendientes, `listo_para_enviar`) para activar el botón de envío.
Firestore solo lo escribe el backend: **las reglas de seguridad de `borradores_bitacora` deben negar todo acceso desde el cliente**.

**Evidencias.** Se envían al backend como cuerpo binario (`Content-Type: image/jpeg`, `image/png` o `application/pdf`; nombre en
`X-File-Name` con `encodeURIComponent`; descripción opcional en `X-Evidence-Description`). Máx. 10 MB y 20 por bitácora. Se valida
la **firma real del archivo** (no solo la cabecera) y que la extensión corresponda. Retirar una evidencia es lógico: el registro y el
archivo se conservan. Solo se modifican evidencias con la bitácora en `BORRADOR` o `DEVUELTA`.

**Envío definitivo.** `POST /logbooks/:id/submit` con cuerpo `{ "revision_base": n }` y la cabecera **`Idempotency-Key`**
(8 a 63 caracteres; la interfaz genera una nueva por cada confirmación del modal). En una sola transacción: bloquea la práctica y
la bitácora, verifica documentos aprobados y que existan docente y asesor, valida reflexión (≥ 20 palabras), al menos una evidencia
y las preguntas obligatorias, copia el borrador a las tablas oficiales, pasa a `ENVIADA`, crea las **dos evaluaciones pendientes**
(docente y asesor, sin promedio) y deja la práctica en `PENDIENTE_EVALUACION`. Repetir la misma llave devuelve el resultado original
(`"idempotente": true`) sin duplicar nada; otra llave sobre una bitácora ya enviada da `409 LOGBOOK_ALREADY_SUBMITTED`; reutilizar la
llave de un envío anterior tras una devolución da `409 IDEMPOTENCY_KEY_REUSED`. Si la práctica aún no tiene docente y asesor asignados,
el envío responde `422 EVALUATORS_MISSING` (Dirección debe completarlos).

**Devolución.** `POST /logbooks/:id/return` (`{ "motivo": "..." }`, Director) solo aplica a bitácoras `ENVIADA`/`EN_EVALUACION` y se rechaza con
`422 EVALUATION_ALREADY_PUBLISHED` si algún evaluador ya publicó su nota. Retira las evaluaciones pendientes, vuelve la práctica a
`ACTIVA` y vuelve a sembrar el borrador con lo que el estudiante había entregado para que lo corrija.

### Evaluaciones y cierre (Fase 6)

Al enviarse la bitácora existen **dos evaluaciones independientes** (docente supervisor y asesor de sitio). **No se calcula ningún
promedio**: cada nota se guarda y se muestra por separado.

**Quién ve qué.** Docente y asesor ven *únicamente* la evaluación de su propio tipo en los estudiantes de su alcance (docente asignado;
asesor asignado con vinculación vigente en esa institución): no ven la del otro evaluador. El estudiante ve solo las evaluaciones
**publicadas** de su práctica. Dirección ve el estado de todas, pero la nota y la retroalimentación de un **borrador** solo las ve su autor.
Quien no tiene acceso recibe `404 EVALUATION_NOT_FOUND` (no se revela que existe).

**Cola.** `GET /evaluations` (filtros `estado`, `tipo`, `q`, `periodo_id`, `asignacion_id`, paginación) devuelve primero las `PENDIENTE`,
luego `BORRADOR` y `PUBLICADA`. `meta.resumen` trae los contadores por estado (ignoran el filtro `estado`) para las pestañas del tablero.
`GET /evaluations/:id` devuelve la evaluación y, a Dirección y evaluadores, la entrega en solo lectura (`bitacora`: reflexión,
evidencias, preguntas y respuestas). `editable` y `corregible` dicen qué botones mostrar.

**Borrador.** `PUT /evaluations/:id/draft` con `{ nota, retroalimentacion }` (reemplaza ambos; lo omitido queda vacío). Puede estar
incompleto. La nota es opcional aquí pero, si se envía, debe estar entre **0.00 y 5.00 con máximo dos decimales**. La primera vez la
bitácora pasa a `EN_EVALUACION`. El borrador vive en PostgreSQL (estado `BORRADOR`).

**Publicación.** `POST /evaluations/:id/publish` acepta `{ nota?, retroalimentacion? }` (usa lo enviado y, si falta algo, el borrador); sin
nota responde `422 GRADE_REQUIRED`. Es transaccional (bloquea práctica → bitácora → evaluación): registra quién publicó, deja la bitácora en
`EN_EVALUACION` o, si ya están las dos publicadas, en **`EVALUADA`**, y avisa al estudiante (y a Dirección cuando la práctica queda lista
para cerrar). Una evaluación publicada es **inmutable** (el servicio y un trigger lo impiden): editarla o publicarla otra vez da
`409 EVALUATION_ALREADY_PUBLISHED`.

**Corrección de nota.** `POST /evaluations/:id/correct` (`{ nota, retroalimentacion?, motivo }`, solo el docente o asesor dueño de esa
evaluación) cambia la nota ya publicada con la práctica en `PENDIENTE_EVALUACION`. La versión reemplazada queda en
`evaluaciones_historial` (inmutable) y la nota nueva queda publicada de inmediato; el detalle devuelve `historial` (no al estudiante).
Avisa al estudiante y a Dirección y audita. Sin cambios reales responde `422 NO_CHANGES`; con la práctica finalizada, `422 PRACTICE_FINISHED`.
Dirección ya no reabre evaluaciones. `reabierta_en` y `motivo_reapertura` (migración `…010`) se reutilizan como "última corrección".

**Cierre.** `POST /practice-assignments/:id/finish` (solo Director) exige práctica `PENDIENTE_EVALUACION` y las dos evaluaciones
publicadas (`422 EVALUATIONS_PENDING` con el detalle de las que faltan); pasa la asignación a `FINALIZADA`, audita y avisa a estudiante,
docente y asesor. Es manual y de una sola vez (`409 ASSIGNMENT_ALREADY_FINISHED`). Cerrar no vuelve a exigir convenios ni vinculaciones
vigentes (el periodo pudo terminar). Después ya no se editan, publican ni corrigen evaluaciones, ni se reasigna o cancela la práctica.

**Cambios de evaluador.** Si Dirección cambia al docente o al asesor mientras su evaluación está sin publicar, esta pasa al nuevo
evaluador y vuelve a `PENDIENTE` (no hereda el borrador del anterior, que pierde el acceso). Una evaluación ya publicada no se reemplaza
(`EVALUATOR_LOCKED`); la corrige su propio evaluador. La migración `…010` agrega `reabierta_en`, `motivo_reapertura` y la restricción
`ck_bitacoras_evaluada`.

### Guía de criterios (flujo v2, Fase 3b)

`POST /levels/:nivelId/periods/:periodoId/criteria-guide` (cuerpo binario `application/pdf`, nombre en `X-File-Name`; solo el docente
asignado a ese nivel y periodo en `docentes_niveles`, `403 NOT_LEVEL_TEACHER` si no). Valida PDF real (firma, máx. 10 MB) y
periodo no cerrado (`422 PERIOD_CLOSED`). Cada carga crea una versión nueva en `guias_criterios`; la anterior queda histórica
(una sola vigente). `GET` de la misma ruta devuelve la guía vigente con URL firmada (`guia: null` si aún no hay) y, para Dirección y
el docente, `versiones`. Lo leen Dirección, el docente del nivel, el estudiante con práctica en ese nivel y periodo y el asesor con
practicantes en él; los demás reciben `404 GUIDE_NOT_FOUND`.

### Notificaciones (Fase 7.1)

Se guardan en Firestore (`notificaciones_usuario/{uid}/elementos/{id}`) y pertenecen a la **persona**, no al rol activo. `GET /notifications`
(`page`, `page_size`, `solo_no_leidas=true|false`) devuelve la más reciente primero y en `meta` agrega `no_leidas`. Se leen las últimas 200
por consulta (tope de lecturas). `PATCH /notifications/:id/read` es idempotente y responde `404 NOTIFICATION_NOT_FOUND` si la notificación no
es del usuario; `PATCH /notifications/read-all` responde `{ actualizadas }`. Si Firestore falla: `502 NOTIFICATION_STORE_ERROR`.

### Exportación a PDF (Fase 7.2)

`GET /logbooks/:id/export` responde el archivo (`application/pdf`, `Content-Disposition: attachment`), no el JSON habitual. Tiene los mismos
permisos que consultar la bitácora: el estudiante exporta la suya (incluso en borrador, con un aviso), Dirección cualquiera, y docente y
asesor solo las entregadas de sus estudiantes; lo demás responde `404 LOGBOOK_NOT_FOUND`. Contenido: datos de la práctica, reflexión,
preguntas con sus respuestas, lista de evidencias (nombre, tamaño y descripción; **los archivos no se incrustan**) y las evaluaciones
**publicadas** que el rol puede ver (docente y asesor solo la suya; nunca borradores). Cada exportación queda en la auditoría
(`BITACORA_EXPORTADA`). El PDF lo arma `src/utils/pdf.js`, un generador propio sin dependencias (Helvetica estándar, A4, varias páginas).

### Dashboards (Fase 7.3)

`GET /dashboard?periodo_id=` devuelve según el **rol activo** (sin `periodo_id` usa el periodo activo; si no hay, todos):
- **Director:** `indicadores` (`practicas_activas`, `practicas_finalizadas`, `expedientes_completos`, `evaluaciones_pendientes`, `evaluaciones_publicadas`,
  `instituciones_activas`) y `alertas` (`expedientes_por_auditar`, `expedientes_por_corregir`, `practicas_sin_docente`, `practicas_sin_asesor`,
  `convenios_en_tramite`). «Activa» = pendiente de documentos, activa o pendiente de evaluación; las canceladas no cuentan en ningún indicador.
- **Docente y asesor:** `estudiantes`, `en_desarrollo` (aún sin entrega), `pendientes`, `en_borrador` y `evaluados`, solo de su tipo de evaluación y su alcance.
- **Estudiante:** `practica` (su fila de seguimiento del periodo, o `null`).

`GET /dashboard/practices` (`q`, `periodo_id`, `todos_los_periodos`, `estado`, paginación; `meta.periodo`) es la tabla de seguimiento. Cada fila trae la
asignación y: Director y estudiante → `bitacora`, `documentos` (estado del expediente y aprobados/total), `evaluaciones.{docente,asesor}` y `evaluacion_global`
(`SIN_ENTREGA`, `PENDIENTE`, `PARCIAL`, `COMPLETA`); docente y asesor → solo `mi_evaluacion` (`SIN_ENTREGA` si aún no entregan) y un `bitacora.estado`
simple (`EN_DESARROLLO` hasta que se envía), sin expediente legal ni la evaluación del otro. La nota solo aparece cuando está publicada; para el estudiante, lo no
publicado figura como `PENDIENTE`.

### Tarjetas de acción inmediata (flujo v2, Fase 4)

`GET /dashboard/actions?periodo_id=` (por defecto el periodo activo; solo Director y Docente, los demás `403`). Devuelve
`{ rol, periodo, pendientes, tarjetas[] }`; cada tarjeta es `{ codigo, titulo, total, severidad (alta|media|info), destino: { pantalla, filtro } }`.
`pendientes` suma solo las de severidad alta o media. Director: `DOCUMENTOS_POR_REVISAR`, `PLAZAS_POR_VALIDAR`,
`PRACTICAS_LISTAS_PARA_CERRAR`, `NIVELES_SIN_DOCENTE`, `NIVELES_SIN_CUESTIONARIO`, `NIVELES_SIN_GUIA`, `PRACTICAS_SIN_ASESOR`,
`CONVENIOS_EN_TRAMITE` y, informativas, `SOLICITUDES_DEVUELTAS` y `SOLICITUDES_ESPERANDO_PLAZA`. Docente (bandeja): `EVALUACIONES_POR_CALIFICAR`,
`EVALUACIONES_EN_BORRADOR`, `NIVELES_SIN_GUIA`, `NIVELES_SIN_CUESTIONARIO` y `CUESTIONARIOS_SIN_PUBLICAR` (informativa). Los
«niveles sin cuestionario/guía» del Director solo cuentan niveles que ya tienen docente.

### Eventos hacia el segundo servicio (flujo v2, Fase 5a)

Con `EVENTS_MODE=outbox` el núcleo guarda cada evento en `eventos_salientes` y un publicador (`services/outboxPublisher.js`, arranca con
`server.js`) lo envía por `POST {NOTIFICATIONS_SERVICE_URL}/events` con cabeceras `X-Event-Id`, `X-Timestamp` y `X-Signature`
(HMAC-SHA256 de `"<marca>.<cuerpo>"` con `EVENTS_SHARED_SECRET`, mínimo 32 caracteres, el mismo en ambos servicios). Éxito = `2xx` o `409`
(ya procesado). Si falla, reintenta con espera exponencial (5 s, 10 s, 20 s… tope 15 min) hasta `OUTBOX_MAX_ATTEMPTS`; luego queda `FALLIDO`
sin perderse (`reencolarFallidos`). `FOR UPDATE SKIP LOCKED` permite varios publicadores sin duplicar. El sobre (versión 1) es
`{ id, tipo, version, ocurrido_en, actor, entidad: {tipo,id}, destinatarios[], carga, contexto }`; `tipo` empieza por `auditoria.` o
`notificacion.`.

### Conexión con el servicio de notificaciones (Fase 5c)

El modo por defecto sigue siendo `direct` (Firestore directo, como antes). Con `EVENTS_MODE=outbox` no cambia ningún caso de uso: los dos
puntos que ya usaba el negocio se desvían (`adapters/eventosAdapter.js`):

- `registrarAuditoria(...)` → evento `auditoria.<ACCION>` en el outbox (con `valor_anterior` y `valor_nuevo` en la carga).
- `crearNotificacion(uid, {...})` → evento `notificacion.<TIPO>` con ese destinatario y el título, mensaje, ruta y prioridad en la carga.
- `GET /notifications`, `PATCH /notifications/:id/read` y `POST /notifications/read-all` se resuelven contra el servicio de notificaciones
  con llamadas firmadas (`adapters/notificacionesRemotas.js`, firma de `"<MÉTODO> <ruta>"`). Si el servicio no responde: `502 NOTIFICATION_STORE_ERROR`.

Como antes, es «mejor esfuerzo»: si el evento no se puede encolar se registra en el log y la operación académica no se revierte. Los
borradores de bitácora siguen en el Firestore del backend. Pruebas: `tests/integration/eventos_conectados.test.js` (incluye una prueba de
punta a punta contra el servicio real si la carpeta `notifications-service` está junto a `backend`).

## Pruebas

```bash
pnpm test:unit                          # sin base de datos
pnpm probar:storage                     # prueba REAL de Supabase Storage (sube, firma, descarga y borra un PDF de prueba)
# Integración: base EXCLUSIVA para pruebas (se borra y recrea)
createdb practicas_udi_test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/practicas_udi_test pnpm test
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/integration/reglas_integridad.sql   # reglas del modelo
```

Firebase se sustituye por una implementación en memoria (`tests/helpers/firebaseFalso.js`); no se necesitan credenciales.

## Supuestos por confirmar

- **Niveles**: el seed crea Práctica I a VIII; cada una se cursa en el semestre de su número (I = 1.º ... VIII = 8.º). Volver a ejecutar `pnpm seed` corrige los datos si cambian.
- Periodo inicial `2026-2` (20‑jul a 5‑dic de 2026).
- El Director no se crea desde la API (solo por seed); los roles registrables son Estudiante, Docente y Asesor.

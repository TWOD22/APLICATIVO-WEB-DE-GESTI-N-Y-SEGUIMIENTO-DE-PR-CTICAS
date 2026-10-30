# Servicio de notificaciones y auditoría (quanta 2)

Segundo servicio del Sistema de Gestión de Prácticas UDI. Recibe los eventos del servicio principal de forma asíncrona y los
guarda en **su propia base** (un proyecto Firebase distinto, con Firestore). No usa PostgreSQL ni comparte datos con el backend.

## Cómo se comunica
- **Entrada:** `POST /events` — el backend (publicador del outbox) envía el evento con `X-Event-Id`, `X-Timestamp` y `X-Signature`
  (HMAC-SHA256 de `"<marca>.<cuerpo>"` con `EVENTS_SHARED_SECRET`). Respuestas: `201` guardado, `409` ya procesado (idempotente por id),
  `400` evento inválido, `401` firma inválida o vencida (±5 min), `500` falla del almacén (el emisor reintenta).
- **Consulta (para que el backend sirva la bandeja):** `GET /users/:uid/notifications`, `PATCH /users/:uid/notifications/:id/read`,
  `POST /users/:uid/notifications/read-all`. La firma cubre `"<MÉTODO> <ruta con parámetros>"`.
- **Sondas:** `GET /health`, `GET /ready` (sin firma).

## Qué guarda (Firestore del proyecto propio)
| Colección | Contenido |
|---|---|
| `eventos_procesados/{evento_id}` | marca de idempotencia |
| `auditoria/{evento_id}` | huella inmutable (actor, acción, entidad, valores, IP, agente, request id) |
| `notificaciones/{uid}/elementos/{evento_id}_{n}` | bandeja de cada usuario |

Todo lo de un evento se escribe en un solo lote atómico; la marca se crea con `create`, que falla si ya existe, así reprocesar no duplica.
`firestore.rules` bloquea todo acceso de clientes: solo este servicio (Firebase Admin) lee y escribe.

## Puesta en marcha
1. `pnpm install`
2. Copia `.env.example` a `.env` y completa `EVENTS_SHARED_SECRET` (el mismo del backend) y las tres credenciales del proyecto Firebase **nuevo**.
   Sin credenciales corre en memoria (solo para probar).
3. `pnpm start` (puerto 4000) · `pnpm test`

En el backend: `EVENTS_MODE=outbox`, `NOTIFICATIONS_SERVICE_URL=http://localhost:4000` y el mismo `EVENTS_SHARED_SECRET`.

/**
 * Almacén en memoria: para pruebas y para correr el servicio sin credenciales (los datos se pierden al reiniciar).
 * Misma interfaz que el almacén de Firestore.
 */
export function crearAlmacenMemoria() {
  const procesados = new Set();
  const auditoria = [];
  const notificaciones = new Map(); // uid -> Map(id -> datos)

  return {
    nombre: "memoria",
    auditoria,
    /** Guarda todo lo del evento de forma atómica. Devuelve false si el evento ya se había procesado. */
    async guardarEvento({ eventoId, auditoria: doc = null, notificaciones: lista = [] }) {
      if (procesados.has(eventoId)) return false;
      procesados.add(eventoId);
      if (doc) auditoria.push({ ...doc });
      for (const n of lista) {
        if (!notificaciones.has(n.firebase_uid)) notificaciones.set(n.firebase_uid, new Map());
        notificaciones.get(n.firebase_uid).set(n.id, { ...n.datos });
      }
      return true;
    },
    async listarNotificaciones(uid, limite = 200) {
      const filas = [...(notificaciones.get(uid) ?? new Map()).entries()].map(([id, d]) => ({ id, ...d }));
      return filas.sort((a, b) => b.fecha - a.fecha).slice(0, limite);
    },
    /** Devuelve la notificación (marcada) o null si no existe en la bandeja del usuario. Idempotente. */
    async marcarLeida(uid, id) {
      const d = notificaciones.get(uid)?.get(id);
      if (!d) return null;
      if (!d.leida) {
        d.leida = true;
        d.leida_en = new Date();
      }
      return { id, ...d };
    },
    async marcarTodasLeidas(uid) {
      let n = 0;
      for (const d of (notificaciones.get(uid) ?? new Map()).values()) {
        if (!d.leida) {
          d.leida = true;
          d.leida_en = new Date();
          n += 1;
        }
      }
      return n;
    },
    async eliminarNotificacion(uid, id) {
      return notificaciones.get(uid)?.delete(id) ?? false;
    },
    async eliminarTodasNotificaciones(uid) {
      const bandeja = notificaciones.get(uid);
      const n = bandeja?.size ?? 0;
      bandeja?.clear();
      return n;
    },
    async disponible() {
      return true;
    },
  };
}

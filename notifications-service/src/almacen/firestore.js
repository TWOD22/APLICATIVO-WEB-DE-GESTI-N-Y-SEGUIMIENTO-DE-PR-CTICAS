/**
 * Almacén en Firestore: base PROPIA del servicio (un proyecto Firebase distinto al del backend). Colecciones (el prefijo
 * FIRESTORE_PREFIX es opcional, por defecto vacío; sirve solo si algún día se comparte un proyecto):
 *   {p}eventos_procesados/{evento_id}        marca de idempotencia
 *   {p}auditoria/{evento_id}                 huella inmutable
 *   {p}notificaciones/{uid}/elementos/{id}   bandeja de cada usuario
 * Todo lo de un evento se escribe en un solo lote: la marca se crea con `create`, que falla si ya existe, y ese
 * fallo (ALREADY_EXISTS) deja intacto el resto del lote. Así reprocesar un evento no duplica nada.
 */
const ALREADY_EXISTS = 6;

export function crearAlmacenFirestore(db, { prefijo = "" } = {}) {
  const col = (nombre) => db.collection(`${prefijo}${nombre}`);
  const bandeja = (uid) => col("notificaciones").doc(uid).collection("elementos");

  const aFecha = (v) => (typeof v?.toDate === "function" ? v.toDate() : v instanceof Date ? v : null);
  const aFila = (id, d) => ({ id, ...d, fecha: aFecha(d.fecha), leida_en: aFecha(d.leida_en) });

  return {
    nombre: "firestore",
    async guardarEvento({ eventoId, auditoria = null, notificaciones = [] }) {
      const lote = db.batch();
      lote.create(col("eventos_procesados").doc(eventoId), { procesado_en: new Date() });
      if (auditoria) lote.create(col("auditoria").doc(eventoId), auditoria);
      for (const n of notificaciones) lote.create(bandeja(n.firebase_uid).doc(n.id), n.datos);
      try {
        await lote.commit();
        return true;
      } catch (error) {
        if (error?.code === ALREADY_EXISTS) return false;
        throw error;
      }
    },
    async listarNotificaciones(uid, limite = 200) {
      const instantanea = await bandeja(uid).orderBy("fecha", "desc").limit(limite).get();
      return instantanea.docs.map((doc) => aFila(doc.id, doc.data()));
    },
    async marcarLeida(uid, id) {
      const ref = bandeja(uid).doc(id);
      const actual = await ref.get();
      if (!actual.exists) return null;
      if (!actual.data().leida) await ref.update({ leida: true, leida_en: new Date() });
      return aFila(id, (await ref.get()).data());
    },
    async marcarTodasLeidas(uid) {
      const pendientes = await bandeja(uid).where("leida", "==", false).limit(400).get();
      if (pendientes.empty) return 0;
      const lote = db.batch();
      for (const doc of pendientes.docs) lote.update(doc.ref, { leida: true, leida_en: new Date() });
      await lote.commit();
      return pendientes.size;
    },
    async eliminarNotificacion(uid, id) {
      const ref = bandeja(uid).doc(id);
      if (!(await ref.get()).exists) return false;
      await ref.delete();
      return true;
    },
    async eliminarTodasNotificaciones(uid) {
      let total = 0;
      for (;;) {
        const lista = await bandeja(uid).limit(400).get();
        if (lista.empty) break;
        const lote = db.batch();
        for (const doc of lista.docs) lote.delete(doc.ref);
        await lote.commit();
        total += lista.size;
        if (lista.size < 400) break;
      }
      return total;
    },
    async disponible() {
      try {
        await col("eventos_procesados").limit(1).get();
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Crea el almacén real con Firebase Admin a partir de las credenciales del servicio. */
export async function crearAlmacenFirestoreDesdeEntorno(env) {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp(
    {
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    },
    "servicio-notificaciones"
  );
  return crearAlmacenFirestore(getFirestore(app), { prefijo: env.FIRESTORE_PREFIX });
}

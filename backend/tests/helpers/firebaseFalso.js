/**
 * Firebase Admin falso (Auth + Firestore en memoria) para pruebas rápidas y repetibles, sin tocar servicios reales.
 */
/** Firebase Admin en memoria (Auth + Firestore) para pruebas deterministas. */
export function crearFirebaseFalso() {
  const estado = {
    usuarios: new Map(), // uid -> { uid, email, displayName, disabled }
    claims: new Map(),
    revocados: [],
    eventos: [], // documentos escritos en Firestore
    fallar: {}, // { createUser, updateUser, claims, firestore }
    tokens: new Map(), // idToken -> uid
  };
  let contador = 0;
  const error = (code) => Object.assign(new Error(code), { code });

  const auth = {
    async verifyIdToken(token) {
      const uid = estado.tokens.get(token);
      if (!uid) throw error("auth/argument-error");
      return { uid };
    },
    async createUser({ email, displayName }) {
      if (estado.fallar.createUser) throw error("auth/internal-error");
      for (const u of estado.usuarios.values()) if (u.email === email) throw error("auth/email-already-exists");
      const uid = `fb-${++contador}`;
      estado.usuarios.set(uid, { uid, email, displayName, disabled: false });
      return { uid };
    },
    async updateUser(uid, cambios) {
      if (estado.fallar.updateUser) throw error("auth/internal-error");
      const usuario = estado.usuarios.get(uid);
      if (!usuario) throw error("auth/user-not-found");
      Object.assign(usuario, cambios);
      return usuario;
    },
    async deleteUser(uid) {
      estado.usuarios.delete(uid);
    },
    async setCustomUserClaims(uid, claims) {
      if (estado.fallar.claims) throw error("auth/internal-error");
      estado.claims.set(uid, claims);
    },
    async revokeRefreshTokens(uid) {
      estado.revocados.push(uid);
    },
    async generatePasswordResetLink(email) {
      return `https://enlace.test/definir-contrasena?correo=${encodeURIComponent(email)}`;
    },
  };

  // Documentos en memoria por ruta completa ("coleccion/id"); además cada escritura queda en `eventos`
  // (excepto los borradores, que se sobrescriben) para poder inspeccionar auditoría y notificaciones.
  estado.documentos = new Map();
  const fallaFirestore = () => {
    if (estado.fallar.firestore) throw new Error("firestore caído");
  };
  const referencia = (ruta, id) => {
    const clave = `${ruta}/${id}`;
    return {
      clave,
      collection: (nombre) => coleccion(`${clave}/${nombre}`),
      get: async () => {
        fallaFirestore();
        const datos = estado.documentos.get(clave);
        return { exists: datos !== undefined, data: () => (datos === undefined ? undefined : structuredClone(datos)) };
      },
      set: async (valor, opciones) => {
        fallaFirestore();
        const anterior = estado.documentos.get(clave);
        estado.documentos.set(clave, opciones?.merge ? { ...(anterior ?? {}), ...valor } : { ...valor });
        if (ruta !== "borradores_bitacora") estado.eventos.push({ ruta, id, ...valor });
      },
      // Como en Firestore, actualizar un documento inexistente falla (NOT_FOUND).
      update: async (cambios) => {
        fallaFirestore();
        const anterior = estado.documentos.get(clave);
        if (anterior === undefined) throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
        estado.documentos.set(clave, { ...anterior, ...cambios });
      },
    };
  };
  /** Consulta mínima: where(campo, "==", valor), orderBy (el orden de inserción hace de fecha) y limit. */
  const coleccion = (ruta, { filtros = [], descendente = false, tope = Infinity } = {}) => ({
    doc: (id) => referencia(ruta, id),
    where: (campo, operador, valor) => {
      if (operador !== "==") throw new Error(`operador no soportado por el falso: ${operador}`);
      return coleccion(ruta, { filtros: [...filtros, [campo, valor]], descendente, tope });
    },
    orderBy: (_campo, direccion = "asc") => coleccion(ruta, { filtros, descendente: direccion === "desc", tope }),
    limit: (n) => coleccion(ruta, { filtros, descendente, tope: n }),
    get: async () => {
      fallaFirestore();
      const prefijo = `${ruta}/`;
      let docs = [...estado.documentos.entries()]
        .filter(([clave]) => clave.startsWith(prefijo) && !clave.slice(prefijo.length).includes("/"))
        .filter(([, datos]) => filtros.every(([campo, valor]) => datos[campo] === valor))
        .map(([clave, datos]) => ({ id: clave.slice(prefijo.length), ref: referencia(ruta, clave.slice(prefijo.length)), data: () => structuredClone(datos) }));
      if (descendente) docs = docs.reverse();
      docs = docs.slice(0, tope);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const firestore = {
    collection: (nombre) => coleccion(nombre),
    batch: () => {
      const operaciones = [];
      return {
        update: (ref, cambios) => operaciones.push(() => ref.update(cambios)),
        commit: async () => {
          for (const operacion of operaciones) await operacion();
        },
      };
    },
    // Transacción simplificada: Node es monohilo y no hay entrelazado dentro del callback salvo en awaits,
    // así que se serializan las transacciones para imitar el aislamiento de Firestore.
    runTransaction: async (trabajo) => {
      fallaFirestore();
      const anterior = estado.cola ?? Promise.resolve();
      let liberar;
      estado.cola = new Promise((r) => (liberar = r));
      await anterior;
      try {
        const escrituras = [];
        const resultado = await trabajo({
          get: (ref) => ref.get(),
          set: (ref, valor) => escrituras.push([ref.clave, valor]),
        });
        for (const [clave, valor] of escrituras) estado.documentos.set(clave, { ...valor });
        return resultado;
      } finally {
        liberar();
      }
    },
  };

  return {
    estado,
    implementacion: { auth, firestore },
    /** Registra una identidad (uid) y devuelve el ID Token que la representa. */
    emitirToken(uid) {
      const token = `token-${uid}`;
      estado.tokens.set(token, uid);
      return token;
    },
  };
}

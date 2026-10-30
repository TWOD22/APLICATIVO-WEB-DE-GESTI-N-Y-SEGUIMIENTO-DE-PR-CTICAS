/**
 * Punto de entrada del servicio de notificaciones y auditoría.
 */
import { crearAlmacenFirestoreDesdeEntorno } from "./almacen/firestore.js";
import { crearAlmacenMemoria } from "./almacen/memoria.js";
import { crearApp } from "./app.js";
import { cargarEntorno } from "./config/env.js";

const env = cargarEntorno();
const almacen = env.usaFirestore ? await crearAlmacenFirestoreDesdeEntorno(env) : crearAlmacenMemoria();
if (!env.usaFirestore) console.warn("Sin credenciales de Firebase: usando memoria (los datos se pierden al reiniciar).");

const servidor = crearApp({ almacen, secreto: env.EVENTS_SHARED_SECRET }).listen(env.PORT, () => {
  console.log(`Servicio de notificaciones y auditoría en el puerto ${env.PORT} (almacén: ${almacen.nombre})`);
});
const apagar = () => servidor.close(() => process.exit(0));
process.on("SIGTERM", apagar);
process.on("SIGINT", apagar);

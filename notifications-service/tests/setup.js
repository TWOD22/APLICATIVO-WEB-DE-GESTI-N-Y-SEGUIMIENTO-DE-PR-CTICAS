// Se carga antes de cualquier prueba: fuerza el entorno de pruebas y evita leer credenciales reales.
process.env.NODE_ENV = "test";
process.env.EVENTS_SHARED_SECRET = "t".repeat(40);
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

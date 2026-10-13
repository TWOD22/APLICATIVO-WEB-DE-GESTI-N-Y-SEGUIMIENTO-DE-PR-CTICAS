/**
 * Utilidad de comparación de objetos; sirve para registrar en la auditoría solo los campos que cambiaron.
 */
/** Compara dos objetos sobre una lista de campos y devuelve solo lo que cambió. */
export function calcularCambios(actual, propuesto, campos) {
  const anterior = {};
  const nuevo = {};
  for (const campo of campos) {
    if (propuesto[campo] === undefined) continue;
    const a = actual[campo] ?? null;
    const b = propuesto[campo] ?? null;
    if (a !== b) {
      anterior[campo] = a;
      nuevo[campo] = b;
    }
  }
  return { anterior, nuevo, hayCambios: Object.keys(nuevo).length > 0 };
}

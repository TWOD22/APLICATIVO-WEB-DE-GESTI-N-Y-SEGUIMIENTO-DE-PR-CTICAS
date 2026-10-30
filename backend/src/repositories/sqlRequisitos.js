/**
 * Fragmento SQL: ¿el requisito `r` es obligatorio para la asignación `a`?
 * Es obligatorio si el nivel lo marca así y la asignación no fue exentada (prácticas en curso cuando el Director
 * volvió obligatorio un documento sin aplicarlo a ellas). Usar solo en consultas con los alias `r` y `a`.
 */
export const OBLIGATORIO_PARA_ASIGNACION =
  "(r.obligatorio AND NOT EXISTS (SELECT 1 FROM requisitos_exentos ex WHERE ex.requisito_id = r.id AND ex.asignacion_practica_id = a.id))";

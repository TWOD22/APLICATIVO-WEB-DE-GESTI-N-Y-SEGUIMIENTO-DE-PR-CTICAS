/**
 * Utilidades de paginación y búsqueda para los listados (LIMIT/OFFSET y metadatos de respuesta).
 */
import { PAGINA_TAMANO_MAXIMO, PAGINA_TAMANO_POR_DEFECTO } from "./constants.js";

/** Convierte { page, page_size } en límites SQL. */
export function calcularPaginacion({ page = 1, page_size = PAGINA_TAMANO_POR_DEFECTO } = {}) {
  const tamano = Math.min(Math.max(Number(page_size) || PAGINA_TAMANO_POR_DEFECTO, 1), PAGINA_TAMANO_MAXIMO);
  const pagina = Math.max(Number(page) || 1, 1);
  return { page: pagina, page_size: tamano, limit: tamano, offset: (pagina - 1) * tamano };
}

/** Metadatos de paginación para la respuesta de listados. */
export function armarMetaPaginacion({ page, page_size }, total) {
  return {
    page,
    page_size,
    total,
    total_pages: Math.max(Math.ceil(total / page_size), 1),
  };
}

/** Escapa los comodines de LIKE para búsquedas literales. */
export function escaparLike(texto) {
  return String(texto).replace(/[\\%_]/g, (caracter) => `\\${caracter}`);
}

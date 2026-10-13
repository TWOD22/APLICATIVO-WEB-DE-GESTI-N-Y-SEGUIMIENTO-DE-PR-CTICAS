/**
 * Utilidades de interfaz compartidas: avisos (toast), ventanas modales y iniciales.
 */
/** Muestra un aviso temporal (2,8 s) en pantalla; reemplaza el anterior. */
export function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

/** Abre una ventana modal con título y contenido HTML; se cierra al pulsar fuera o el botón ×. Devuelve el elemento. */
export function openModal(title, content) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><span class="eyebrow">Gestión de prácticas</span><h2 id="modal-title">${title}</h2></div><button type="button" data-close aria-label="Cerrar">×</button></header>${content}</section>`;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-close]")) backdrop.remove();
  });
  document.body.append(backdrop);
  return backdrop;
}

/** Iniciales de las dos primeras palabras de un nombre (para los avatares). */
export function initials(name) {
  return name.split(" ").slice(0, 2).map((word) => word[0]).join("");
}

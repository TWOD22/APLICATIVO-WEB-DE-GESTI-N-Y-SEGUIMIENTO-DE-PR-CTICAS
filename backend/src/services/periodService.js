/**
 * Servicio de catálogos académicos: programas, periodos y niveles de práctica (solo lectura).
 */
import * as programRepository from "../repositories/programRepository.js";
import * as periodRepository from "../repositories/periodRepository.js";

export const listarProgramas = () => programRepository.listar();
export const listarPeriodos = () => periodRepository.listar();
export const listarNivelesPractica = (programaId) => programRepository.listarNivelesPractica({ programaId });

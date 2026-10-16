import type { Task } from './types';

const priorityRank = { high: 0, medium: 1, low: 2 };

export function compareTaskPriority(a: Task, b: Task) {
  return priorityRank[a.priority] - priorityRank[b.priority] || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
}

export function compareTaskRecent(a: Task, b: Task) {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
}

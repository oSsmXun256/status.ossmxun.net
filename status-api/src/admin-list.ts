import type { ManagedIncident } from './incidents.js';
export function incidentPage(items: ManagedIncident[], filter: 'active' | 'resolved', requestedPage: number, pageSize = 10) {
  const activeCount = items.filter(item => item.status !== 'resolved').length;
  const records = items.filter(item => (item.status === 'resolved') === (filter === 'resolved')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(records.length / pageSize));
  const page = Math.max(1, Math.min(requestedPage, pages));
  return { items: records.slice((page - 1) * pageSize, page * pageSize), page, pages, total: records.length, activeCount, resolvedCount: items.length - activeCount };
}

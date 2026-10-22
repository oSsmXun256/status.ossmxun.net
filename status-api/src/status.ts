import { services, type ServiceDefinition } from './services.js';

export type State = 'operational' | 'degraded' | 'down' | 'maintenance' | 'unknown';

export interface MonitorRecord {
  id: number;
  status: unknown;
  createDateTime?: string;
  lastDayUptimes?: { histogram?: Array<{ uptime?: number; timestamp?: number }> } | null;
  currentStateDuration?: number;
}

export interface IncidentRecord {
  id: string | number;
  monitor?: { id?: number } | null;
  startedAt?: string | number | null;
  resolvedAt?: string | number | null;
  type?: unknown;
}

export function mapMonitorState(value: unknown): State {
  switch (String(value ?? '').toUpperCase()) {
    case 'UP': return 'operational';
    case 'LOOKS_DOWN': return 'degraded';
    case 'DOWN': return 'down';
    default: return 'unknown';
  }
}

export function getUptime24h(monitor: MonitorRecord): number | null {
  const points = monitor.lastDayUptimes?.histogram;
  if (!Array.isArray(points) || points.length === 0) return null;
  const values = points.map(point => point.uptime).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);
  if (values.length !== points.length) return null;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(avg * 100) / 100;
}

export function overall(states: State[]): State {
  if (!states.length || states.includes('unknown')) return 'unknown';
  if (states.every(state => state === 'down')) return 'down';
  if (states.some(state => state === 'down' || state === 'degraded')) return 'degraded';
  if (states.includes('maintenance')) return 'maintenance';
  return 'operational';
}

export function sanitizeMonitorResults(records: MonitorRecord[], now = Date.now()) {
  const byId = new Map(records.filter(item => Number.isSafeInteger(item.id)).map(item => [item.id, item]));
  return services.map((service: ServiceDefinition) => {
    const monitor = byId.get(service.monitorId);
    const since = monitor && Number.isFinite(monitor.currentStateDuration) && monitor.currentStateDuration! >= 0
      ? new Date(now - monitor.currentStateDuration! * 1000).toISOString()
      : null;
    return {
      id: service.id,
      state: monitor ? mapMonitorState(monitor.status) : 'unknown' as State,
      uptime24h: monitor ? getUptime24h(monitor) : null,
      monitoringStateSince: since,
    };
  });
}

export function sanitizeIncidents(records: IncidentRecord[]) {
  const ids = new Map(services.map(service => [service.monitorId, service.id]));
  return records.flatMap(item => {
    const serviceId = item.monitor?.id ? ids.get(item.monitor.id) : undefined;
    const startedAt = normalizeTime(item.startedAt);
    if (!serviceId || !startedAt || !isDowntime(item.type)) return [];
    return [{
      id: String(item.id),
      serviceId,
      startedAt,
      resolvedAt: normalizeTime(item.resolvedAt),
    }];
  }).slice(0, 50);
}

function isDowntime(value: unknown) {
  const status = String(value ?? '').toUpperCase();
  return status === 'DOWNTIME' || status === 'DOWN' || status === 'OUTAGE';
}

function normalizeTime(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function activeMaintenance(items: MaintenanceItem[], now = Date.now()) {
  return effectiveMaintenance(items, now).filter(item => item.status === 'in_progress' && (!item.startsAt || Date.parse(item.startsAt) <= now));
}

export function effectiveMaintenance(items: MaintenanceItem[], now = Date.now()): MaintenanceItem[] {
  return items.map(item => item.status === 'scheduled' && item.startsAt && Date.parse(item.startsAt) <= now
    ? { ...item, status: 'in_progress' } : item);
}

export interface MaintenanceItem {
  id: string;
  title: string;
  serviceIds: string[];
  reason: string;
  status: 'scheduled' | 'in_progress' | 'completed';
  startsAt: string | null;
  endsAt: string | null;
  completedAt: string | null;
}

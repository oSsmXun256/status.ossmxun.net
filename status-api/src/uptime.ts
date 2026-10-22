import { services } from './services.js';
import { mapMonitorState, type MonitorRecord } from './status.js';

export interface UptimeRange { date: string; from: number; to: number; }
export interface UptimeRecord { id: number; custom_uptime_ratio?: unknown; custom_uptime_ranges?: unknown; }

// Calendar days in Japan. Requests for dates before monitor creation are never published as uptime.
export function uptimeRanges(now = Date.now()): UptimeRange[] {
  const day = 86_400;
  const offset = 9 * 3600;
  const end = Math.floor(now / 1000);
  const today = Math.floor((end + offset) / day) * day - offset;
  return Array.from({ length: 30 }, (_, index) => {
    const from = today - (29 - index) * day;
    return { date: new Date((from + offset) * 1000).toISOString().slice(0, 10), from, to: Math.min(from + day, end) };
  });
}

function ratio(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

export function sanitizeUptimeResults(records: UptimeRecord[], monitors: MonitorRecord[], ranges: UptimeRange[]) {
  const recordsById = new Map(records.map(item => [item.id, item]));
  const monitorsById = new Map(monitors.map(item => [item.id, item]));
  return services.map(service => {
    const record = recordsById.get(service.monitorId);
    const monitor = monitorsById.get(service.monitorId);
    const active = monitor && mapMonitorState(monitor.status) !== 'unknown';
    const created = monitor?.createDateTime ? Date.parse(monitor.createDateTime) : NaN;
    const values = typeof record?.custom_uptime_ranges === 'string' ? record.custom_uptime_ranges.split('-') : [];
    return {
      id: service.id,
      uptime24h: active ? ratio(record?.custom_uptime_ratio) : null,
      uptimeHistory: ranges.map((range, index) => ({
        date: range.date,
        uptime: active && Number.isFinite(created) && created <= range.from * 1000 && range.to > range.from && values.length === ranges.length
          ? ratio(values[index]) : null,
      })),
    };
  });
}

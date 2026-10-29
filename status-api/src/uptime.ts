import { services } from './services.js';
import type { MonitorRecord } from './status.js';

export interface UptimeRange { date: string; from: number; to: number; }
export interface UptimeLog { type: number; datetime: number; }
export interface UptimeRecord { id: number; logs?: UptimeLog[]; }

// Calendar days in Japan. Never publish dates before monitor creation.
export function uptimeRanges(now = Date.now()): UptimeRange[] {
  const day = 86_400, offset = 9 * 3600, end = Math.floor(now / 1000);
  const today = Math.floor((end + offset) / day) * day - offset;
  return Array.from({ length: 30 }, (_, index) => {
    const from = today - (29 - index) * day;
    return { date: new Date((from + offset) * 1000).toISOString().slice(0, 10), from, to: Math.min(from + day, end) };
  });
}

type ObservedState = 'up' | 'down' | 'unknown';
function logState(type: number): ObservedState { return type === 2 ? 'up' : type === 1 ? 'down' : 'unknown'; }

// Only integrate intervals covered by actual transitions or the current state's
// observed duration. Missing history and paused intervals are not assumed up.
export function intervalUptime(logs: UptimeLog[], from: number, to: number, monitor: MonitorRecord, now: number): number | null {
  if (to <= from || !logs.every(log => log && Number.isSafeInteger(log.datetime) && Number.isSafeInteger(log.type))) return null;
  const events = [...logs].sort((a, b) => a.datetime - b.datetime);
  const previous = events.filter(log => log.datetime <= from).at(-1);
  let state: ObservedState = previous ? logState(previous.type) : 'unknown';
  if (!previous && typeof monitor.currentStateDuration === 'number' && Number.isFinite(monitor.currentStateDuration) && monitor.currentStateDuration >= 0 && now - monitor.currentStateDuration <= from) {
    state = monitor.status === 'UP' ? 'up' : monitor.status === 'DOWN' ? 'down' : 'unknown';
  }
  let cursor = from, up = 0;
  for (const event of events.filter(log => log.datetime > from && log.datetime < to)) {
    if (event.datetime > cursor && state === 'unknown') return null;
    if (state === 'up') up += event.datetime - cursor;
    cursor = event.datetime; state = logState(event.type);
  }
  if (cursor < to && state === 'unknown') return null;
  if (state === 'up') up += to - cursor;
  return Math.round(up / (to - from) * 100_000) / 1000;
}

export function sanitizeUptimeResults(records: UptimeRecord[], monitors: MonitorRecord[], ranges: UptimeRange[], now = Date.now()) {
  const recordsById = new Map(records.map(item => [item.id, item]));
  const monitorsById = new Map(monitors.map(item => [item.id, item]));
  const end = Math.floor(now / 1000);
  return services.map(service => {
    const record = recordsById.get(service.monitorId), monitor = monitorsById.get(service.monitorId);
    const created = monitor?.createDateTime ? Date.parse(monitor.createDateTime) / 1000 : NaN;
    function calculate(from: number, to: number) {
      if (!monitor || !['UP', 'DOWN', 'LOOKS_DOWN'].includes(String(monitor.status)) || !Array.isArray(record?.logs) || !Number.isFinite(created) || created > from || to > end) return null;
      return intervalUptime(record.logs, from, to, monitor, end);
    }
    return { id: service.id, uptime24h: calculate(end - 86_400, end), uptimeHistory: ranges.map(range => ({ date: range.date, uptime: calculate(range.from, range.to) })) };
  });
}

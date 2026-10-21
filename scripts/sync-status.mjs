import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { monitorState } from '../src/lib/status.mjs';

const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('src/data/services.json', root), 'utf8'));
const output = new URL('public/data/status.json', root);
const previous = JSON.parse(await readFile(output, 'utf8'));
const now = new Date().toISOString();

export function publicMonitor(service, monitor) {
  const values = (monitor.lastDayUptimes?.histogram ?? []).map(bucket => bucket.uptime).filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);
  return { id: service.id, state: monitorState(monitor.status), uptime24h: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1000) / 1000 : null };
}

export function mergeIncidents(old, services, monitors, fetchedAt) {
  const result = new Map(old.map(item => [item.id, item]));
  for (const service of services) {
    const monitor = monitors.find(item => item.url?.replace(/\/$/, '') === service.monitorUrl?.replace(/\/$/, ''));
    if (!monitor) continue;
    const last = monitor.lastIncident;
    if (last?.id && last.startedAt && Number.isFinite(Date.parse(last.startedAt))) {
      const id = `${service.id}:${last.id}`;
      const known = result.get(id);
      const startedAt = new Date(last.startedAt).toISOString();
      const duration = last.duration;
      const resolvedAt = monitor.status === 'UP' && typeof duration === 'number' && duration > 0 ? new Date(Date.parse(startedAt) + duration * 1000).toISOString() : known?.resolvedAt ?? null;
      result.set(id, { id, serviceId: service.id, startedAt, resolvedAt });
    }
    // Resolve previously observed outages only when the provider confirms UP.
    for (const [id, item] of result) {
      if (item.serviceId === service.id && !item.resolvedAt && monitor.status === 'UP') result.set(id, { ...item, resolvedAt: item.id === `${service.id}:${last?.id}` && item.resolvedAt ? item.resolvedAt : fetchedAt });
    }
  }
  return [...result.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200);
}

async function sync() {
  const key = process.env.UPTIMEROBOT_API_KEY;
  if (!key) throw new Error('UPTIMEROBOT_API_KEY is not configured');
  const response = await fetch('https://api.uptimerobot.com/v3/monitors?limit=200', {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`UptimeRobot returned HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.data) || data.nextLink) throw new Error('Incomplete monitor response');
  const services = config.flatMap(service => {
    if (!service.monitorUrl) return [];
    const monitor = data.data.find(item => item.url?.replace(/\/$/, '') === service.monitorUrl.replace(/\/$/, ''));
    return monitor ? [publicMonitor(service, monitor)] : [];
  });
  // Only explicitly allowlisted service IDs, status, uptime and incident dates are public.
  const next = { version: 1, fetchedAt: now, fetchState: 'ok', services, incidents: mergeIncidents(previous.incidents, config, data.data, now) };
  await writeFile(output, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Published ${services.length} allowlisted monitor results.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await sync(); }
  catch {
    await writeFile(output, `${JSON.stringify({ ...previous, fetchedAt: now, fetchState: 'error', services: previous.services.map(item => ({ ...item, state: 'unknown', uptime24h: null })) }, null, 2)}\n`);
    console.error('Monitor sync failed. Public state is unknown; no credentials or raw responses were logged.');
    process.exitCode = 1;
  }
}

import Fastify from 'fastify';
import { reportedState, type ManagedIncident } from './incidents.js';
import { activeMaintenance, effectiveMaintenance, overall, sanitizeIncidents, sanitizeMonitorResults, type IncidentRecord, type MaintenanceItem, type MonitorRecord, type State } from './status.js';
import { services } from './services.js';
import { uptimeRanges, sanitizeUptimeResults, type UptimeRange } from './uptime.js';
import { accessVerifier } from './access.js';
import { registerAdmin } from './admin.js';
import { MaintenanceStore } from './maintenance.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const ORIGIN = process.env.STATUS_ORIGIN ?? 'https://status.ossmxun.net';
const API_KEY = process.env.UPTIMEROBOT_API_KEY?.trim();
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.STATUS_CACHE_TTL_MS ?? 120_000));
const MAX_AGE_MS = Math.max(CACHE_TTL_MS * 2, Number(process.env.STATUS_MAX_AGE_MS ?? 300_000));
const MAINTENANCE_FILE = process.env.MAINTENANCE_FILE ?? '/var/lib/status-api/maintenance.json';
const UPSTREAM = 'https://api.uptimerobot.com/v3';
const maintenanceStore = new MaintenanceStore(MAINTENANCE_FILE);

interface CacheSnapshot {
  fetchedAt: string;
  services: ReturnType<typeof sanitizeMonitorResults>;
  incidents: ReturnType<typeof sanitizeIncidents>;
  uptime: ReturnType<typeof sanitizeUptimeResults>;
}

let snapshot: CacheSnapshot | null = null;
let lastAttemptAt: string | null = null;
let lastErrorAt: string | null = null;
let refreshPromise: Promise<void> | null = null;
const requestBuckets = new Map<string, { startedAt: number; count: number }>();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["cf-access-jwt-assertion"]', 'res.headers["set-cookie"]'],
  },
  trustProxy: 'loopback',
  bodyLimit: 16 * 1024,
  requestTimeout: 10_000,
});

app.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (origin === ORIGIN) {
    reply.header('access-control-allow-origin', ORIGIN).header('vary', 'Origin');
  }
  if (request.method === 'OPTIONS') {
    if (origin !== ORIGIN) return reply.code(403).send();
    return reply.header('access-control-allow-methods', 'GET, OPTIONS')
      .header('access-control-allow-headers', 'content-type')
      .header('access-control-max-age', '600')
      .code(204).send();
  }
  const now = Date.now();
  const key = request.ip;
  let bucket = requestBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    bucket = { startedAt: now, count: 0 };
    requestBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (requestBuckets.size > 5000) {
    for (const [ip, value] of requestBuckets) if (now - value.startedAt >= 60_000) requestBuckets.delete(ip);
  }
  if (bucket.count > 60) return reply.code(429).send({ error: 'rate_limited' });
});

async function upstreamGet(url: URL): Promise<any> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${API_KEY}`, accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return response.json();
}

async function listAll(path: string): Promise<any[]> {
  const first = new URL(`${UPSTREAM}${path}`);
  if (path === '/monitors') first.searchParams.set('limit', '100');
  const all: any[] = [];
  let url: URL | null = first;
  let pages = 0;
  while (url && pages < 3) {
    const response = await upstreamGet(url);
    if (!Array.isArray(response.data)) throw new Error('invalid_upstream_data');
    all.push(...response.data);
    pages += 1;
    const nextLink = typeof response.nextLink === 'string' ? new URL(response.nextLink, UPSTREAM) : null;
    url = nextLink && nextLink.origin === new URL(UPSTREAM).origin ? nextLink : null;
  }
  return all;
}

async function refresh() {
  if (!API_KEY) throw new Error('not_configured');
  lastAttemptAt = new Date().toISOString();
  const ranges = uptimeRanges();
  const [monitors, incidents, uptime] = await Promise.all([
    listAll('/monitors'), listAll('/incidents'), fetchUptime(ranges).catch(() => null),
  ]);
  const fetchedAt = new Date().toISOString();
  snapshot = {
    fetchedAt,
    services: sanitizeMonitorResults(monitors as MonitorRecord[], Date.now()),
    incidents: sanitizeIncidents(incidents as IncidentRecord[]),
    uptime: uptime ? sanitizeUptimeResults(uptime, monitors as MonitorRecord[], ranges) : [],
  };
  lastErrorAt = null;
}

async function fetchUptime(ranges: UptimeRange[]) {
  // v3 currently returns empty lastDayUptimes. The documented v2 API returns all
  // monitors' daily ratios in one request, within the Free plan's rate limit.
  const body = new URLSearchParams({
    api_key: API_KEY!, format: 'json', monitors: services.map(service => service.monitorId).join('-'),
    custom_uptime_ratios: '1', custom_uptime_ranges: ranges.map(range => `${range.from}_${range.to}`).join('-'),
  });
  const response = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('uptime_unavailable');
  const result = await response.json() as { stat?: string; monitors?: unknown };
  if (result.stat !== 'ok' || !Array.isArray(result.monitors)) throw new Error('invalid_uptime_data');
  return result.monitors;
}

async function refreshIfExpired() {
  if (!API_KEY) {
    lastErrorAt ??= new Date().toISOString();
    return;
  }
  const freshEnough = snapshot && Date.now() - Date.parse(snapshot.fetchedAt) < CACHE_TTL_MS && !lastErrorAt;
  if (freshEnough) return;
  if (lastErrorAt && lastAttemptAt && Date.now() - Date.parse(lastAttemptAt) < 30_000) return;
  if (!refreshPromise) {
    refreshPromise = refresh().catch(() => { lastErrorAt = new Date().toISOString(); }).finally(() => { refreshPromise = null; });
  }
  await refreshPromise;
}

async function loadRecords() {
  try {
    return await maintenanceStore.read();
  } catch { return null; }
}

function publicStatus(maintenance: MaintenanceItem[] | null, incidents: ManagedIncident[] | null) {
  const cacheAgeSeconds = snapshot ? Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.fetchedAt)) / 1000)) : null;
  const stale = !snapshot || lastErrorAt !== null || cacheAgeSeconds! * 1000 > MAX_AGE_MS;
  const active = activeMaintenance(maintenance ?? []);
  const servicesOut = services.map(service => {
    const result = snapshot?.services.find(item => item.id === service.id);
    const metrics = snapshot?.uptime.find(item => item.id === service.id);
    const base: State = active.some(item => item.serviceIds.includes(service.id)) ? 'maintenance' : stale || maintenance === null ? 'unknown' : result?.state ?? 'unknown';
    const state = reportedState(base, incidents ?? [], service.id);
    return { id: service.id, state, uptime24h: stale ? null : metrics?.uptime24h ?? result?.uptime24h ?? null,
      uptimeHistory: stale ? [] : metrics?.uptimeHistory ?? [], monitoringStateSince: result?.monitoringStateSince ?? null };
  });
  const totalState = overall(servicesOut.map(item => item.state));
  return {
    version: 1,
    state: totalState,
    services: servicesOut,
    incidents: snapshot?.incidents ?? [],
    managedIncidents: { available: incidents !== null, items: incidents ?? [] },
    maintenance: { state: active.length ? 'in_progress' : 'none', items: maintenance ?? [], available: maintenance !== null },
    freshness: { state: stale ? 'stale' : 'fresh', fetchedAt: snapshot?.fetchedAt ?? null, updatedAt: [snapshot?.fetchedAt, ...(incidents ?? []).map(item => item.updatedAt)].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null, ageSeconds: cacheAgeSeconds },
  };
}

app.get('/api/status', async (_request, reply) => {
  await refreshIfExpired();
  const records = await loadRecords();
  reply.header('cache-control', 'no-store');
  return publicStatus(records ? effectiveMaintenance(records.items) : null, records?.incidents ?? null);
});

app.get('/health', async (_request, reply) => {
  const age = snapshot ? Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.fetchedAt)) / 1000)) : null;
  const upstream = !API_KEY ? 'not_configured' : lastErrorAt ? 'error' : snapshot && age! * 1000 <= MAX_AGE_MS ? 'ok' : 'unknown';
  reply.header('cache-control', 'no-store');
  return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()), uptimeRobot: { state: upstream, lastSuccessAt: snapshot?.fetchedAt ?? null, lastAttemptAt, ageSeconds: age } };
});

registerAdmin(app, {
  store: maintenanceStore, origin: process.env.ADMIN_ORIGIN ?? 'https://status-api.ossmxun.net',
  verify: accessVerifier({
    issuer: process.env.ACCESS_ISSUER ?? '', audience: process.env.ACCESS_AUDIENCE ?? '',
    allowedEmails: (process.env.ACCESS_ALLOWED_EMAILS ?? '').split(',').map(email => email.trim()).filter(Boolean),
  }),
});

app.listen({ host: HOST, port: PORT }).catch(error => {
  app.log.error({ err: error }, 'Status API failed to start');
  process.exitCode = 1;
});

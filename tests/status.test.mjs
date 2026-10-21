import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorState, overall, isFresh, activeMaintenance, MAX_AGE_MS } from '../src/lib/status.mjs';
import { publicMonitor, mergeIncidents } from '../scripts/sync-status.mjs';
test('unknown and provider failures never become healthy', () => {
  for (const value of ['PAUSED', 'STARTED', undefined, 'NEW_STATUS']) assert.equal(monitorState(value), 'unknown');
  assert.equal(monitorState('LOOKS_DOWN'), 'degraded');
  assert.equal(overall(['operational', 'unknown']), 'unknown');
  assert.equal(overall(['down', 'unknown']), 'degraded');
  assert.equal(overall(['down', 'down']), 'down');
  assert.equal(overall(['operational', 'maintenance']), 'maintenance');
});
test('stale, failed and future data are not accepted', () => {
  const now = Date.now();
  assert.equal(isFresh({ fetchState: 'ok', fetchedAt: new Date(now).toISOString() }, now), true);
  assert.equal(isFresh({ fetchState: 'ok', fetchedAt: new Date(now - MAX_AGE_MS - 1).toISOString() }, now), false);
  assert.equal(isFresh({ fetchState: 'error', fetchedAt: new Date(now).toISOString() }, now), false);
  assert.equal(isFresh({ fetchState: 'ok', fetchedAt: new Date(now + 120000).toISOString() }, now), false);
});
test('maintenance is explicit and never ends solely because ETA elapsed', () => {
  assert.equal(activeMaintenance([{ status: 'in_progress', startsAt: '2020-01-01', endsAt: '2020-01-02' }]).length, 1);
  assert.equal(activeMaintenance([{ status: 'scheduled' }]).length, 0);
});
test('public output strips API credentials, URLs, contacts and headers', () => {
  const result = publicMonitor({ id: 'website' }, { status: 'UP', apiKey: 'secret', httpPassword: 'secret', url: 'https://private.invalid', lastDayUptimes: { histogram: [{ uptime: 100 }, { uptime: 90 }] } });
  assert.deepEqual(result, { id: 'website', state: 'operational', uptime24h: null });
});
test('incident recovery and history survive missing recent provider logs', () => {
  const service = { id: 'website', monitorUrl: 'https://example.com/' };
  const old = [{ id: 'website:1', serviceId: 'website', startedAt: '2026-01-01T00:00:00.000Z', resolvedAt: null }];
  const now = '2026-01-01T01:00:00.000Z';
  assert.equal(mergeIncidents(old, [service], [{ url: service.monitorUrl, status: 'PAUSED' }], now)[0].resolvedAt, null);
  assert.equal(mergeIncidents(old, [service], [{ url: service.monitorUrl, status: 'UP' }], now)[0].resolvedAt, now);
});

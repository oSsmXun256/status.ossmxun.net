import test from 'node:test';
import assert from 'node:assert/strict';
import { getUptime24h, mapMonitorState, overall, sanitizeIncidents, sanitizeMonitorResults } from '../src/status.js';

test('provider failures and paused states never become operational', () => {
  for (const value of ['PAUSED', 'STARTED', undefined, 'NEW_STATUS']) assert.equal(mapMonitorState(value), 'unknown');
  assert.equal(mapMonitorState('LOOKS_DOWN'), 'degraded');
  assert.equal(overall(['operational', 'unknown']), 'unknown');
  assert.equal(overall(['down', 'down']), 'down');
});

test('uses real 24-hour buckets only and keeps unknown when absent', () => {
  assert.equal(getUptime24h({ id: 1, status: 'UP', lastDayUptimes: { histogram: [{ uptime: 99 }, { uptime: 100 }] } }), 99.5);
  assert.equal(getUptime24h({ id: 1, status: 'UP' }), null);
});

test('public monitor data is allowlisted and missing monitors stay unknown', () => {
  const results = sanitizeMonitorResults([{ id: 804369884, status: 'UP', apiKey: 'secret', url: 'private', lastDayUptimes: { histogram: [{ uptime: 100 }] } } as any]);
  assert.deepEqual(results[0], { id: 'website', state: 'operational', uptime24h: 100, monitoringStateSince: null });
  assert.equal(results.find(item => item.id === 'notify')?.state, 'unknown');
  assert.equal(JSON.stringify(results).includes('secret'), false);
});

test('incidents expose only mapped id and timestamps', () => {
  const result = sanitizeIncidents([{ id: 'inc-1', type: 'DOWNTIME', monitor: { id: 804370253 }, startedAt: '2026-10-22T01:00:00Z', resolvedAt: null, reason: 'secret', url: 'private' } as any]);
  assert.deepEqual(result, [{ id: 'inc-1', serviceId: 'notify', startedAt: '2026-10-22T01:00:00.000Z', resolvedAt: null }]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { meanUptime, groupState, groupHistory } from '../../src/lib/metrics.mjs';

test('group summaries never mask missing service data', () => {
  assert.equal(meanUptime([100, null]), null);
  assert.equal(meanUptime([]), null);
  assert.equal(meanUptime([100, 99]), 99.5);
  assert.equal(groupState(['operational', 'unknown']), 'unknown');
  assert.equal(groupState(['operational', 'down']), 'degraded');
  assert.equal(groupState(['down', 'down']), 'down');
});

test('daily group uptime requires matching observations from every service', () => {
  const one = { uptimeHistory: [{ date: '2026-10-23', uptime: 100 }] };
  const two = { uptimeHistory: [{ date: '2026-10-23', uptime: 99 }] };
  assert.deepEqual(groupHistory([one, two]), [{ date: '2026-10-23', uptime: 99.5 }]);
  assert.equal(groupHistory([one, undefined])[0].uptime, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalUptime, sanitizeUptimeResults, uptimeRanges } from '../src/uptime.js';
const now = Date.parse('2026-10-29T09:00:00Z'), end = now / 1000;
const monitor = { id: 804369884, status: 'DOWN', createDateTime: '2026-10-01T00:00:00Z', currentStateDuration: 300 };
const logs = [{ type: 1, datetime: end - 300 }, { type: 2, datetime: end - 10 * 86400 }];

test('daily ranges follow Japan calendar days and stop at now', () => {
  const ranges = uptimeRanges(now);
  assert.equal(ranges.length, 30); assert.equal(ranges.at(-1)?.date, '2026-10-29');
  assert.equal(ranges.at(-1)?.from, Date.parse('2026-10-28T15:00:00Z') / 1000);
  assert.equal(ranges.at(-1)?.to, end);
});
test('a five-minute active outage reduces 24-hour uptime by elapsed duration, not to zero', () => {
  const record = { id: monitor.id, logs, custom_uptime_ratio: '0', custom_uptime_ranges: Array(30).fill('0').join('-') };
  const result = sanitizeUptimeResults([record], [monitor], uptimeRanges(now), now)[0];
  assert.equal(result.uptime24h, 99.653);
  assert.equal(result.uptimeHistory.find(day => day.date === '2026-10-28')?.uptime, 100);
  assert.equal(result.uptimeHistory.at(-1)?.uptime, 99.537);
});
test('recovery keeps the same historical downtime and clips outages at interval boundaries', () => {
  const recovered = [...logs, { type: 2, datetime: end }];
  assert.equal(intervalUptime(recovered, end - 86400, end, { ...monitor, status: 'UP' }, end), 99.653);
  assert.equal(intervalUptime([{ type: 1, datetime: 0 }, { type: 2, datetime: 50 }], 25, 125, monitor, 125), 75);
  assert.equal(intervalUptime([{ type: 1, datetime: 0 }], 25, 125, monitor, 125), 0);
  assert.equal(intervalUptime([{ type: 2, datetime: 0 }, { type: 1, datetime: 125 }], 25, 125, monitor, 125), 100);
});
test('missing, truncated, paused and invalid history never becomes invented uptime', () => {
  assert.equal(intervalUptime([{ type: 1, datetime: end - 300 }], end - 86400, end, monitor, end), null);
  assert.equal(intervalUptime([{ type: 2, datetime: 0 }, { type: 99, datetime: 50 }, { type: 2, datetime: 75 }], 0, 100, monitor, 100), null);
  assert.equal(intervalUptime([{ type: 1, datetime: NaN }], 0, 100, monitor, 100), null);
  const ranges = uptimeRanges(now);
  const result = sanitizeUptimeResults([{ id: monitor.id, logs }], [monitor], ranges, now)[0];
  assert.ok(result.uptimeHistory.filter(day => day.date < '2026-10-19').every(day => day.uptime === null));
  assert.equal(sanitizeUptimeResults([{ id: monitor.id, logs }], [{ ...monitor, status: 'PAUSED' }], ranges, now)[0].uptime24h, null);
  assert.equal(sanitizeUptimeResults([{ id: monitor.id, logs }], [{ ...monitor, createDateTime: '2026-10-29T08:00:00Z' }], ranges, now)[0].uptime24h, null);
  assert.equal(sanitizeUptimeResults([], [monitor], ranges, now)[0].uptime24h, null);
});
test('an observed unchanging state covers an interval only when its duration reaches the start', () => {
  assert.equal(intervalUptime([], end - 86400, end, { ...monitor, status: 'UP', currentStateDuration: 90000 }, end), 100);
  assert.equal(intervalUptime([], end - 86400, end, { ...monitor, currentStateDuration: 90000 }, end), 0);
  assert.equal(intervalUptime([], end - 86400, end, { ...monitor, status: 'UP', currentStateDuration: 300 }, end), null);
});

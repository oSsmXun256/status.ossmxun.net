import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUptimeResults, uptimeRanges } from '../src/uptime.js';

test('daily ranges follow Japan calendar days and stop at now', () => {
  const now = Date.parse('2026-10-22T16:30:00Z');
  const ranges = uptimeRanges(now);
  assert.equal(ranges.length, 30);
  assert.equal(ranges.at(-1)?.date, '2026-10-23');
  assert.equal(ranges.at(-1)?.from, Date.parse('2026-10-22T15:00:00Z') / 1000);
  assert.equal(ranges.at(-1)?.to, now / 1000);
});

test('provider ratios do not fill days before monitoring or incomplete start days', () => {
  const ranges = uptimeRanges(Date.parse('2026-10-22T16:30:00Z'));
  const monitors = [{ id: 804369884, status: 'UP', createDateTime: '2026-10-21T19:07:00Z' }];
  const records = [{ id: 804369884, custom_uptime_ratio: '99.647', custom_uptime_ranges: Array(30).fill('100.000').join('-'), apiKey: 'secret' }];
  const result = sanitizeUptimeResults(records, monitors, ranges)[0];
  assert.equal(result.uptime24h, 99.647);
  assert.equal(result.uptimeHistory.filter(day => day.uptime !== null).length, 1);
  assert.equal(result.uptimeHistory.at(-1)?.uptime, 100);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('missing, invalid, and paused metrics remain unknown', () => {
  const ranges = uptimeRanges();
  for (const value of ['', 'NaN', '100.01', '-1', null]) {
    const result = sanitizeUptimeResults([{ id: 804369884, custom_uptime_ratio: value, custom_uptime_ranges: '100' }], [{ id: 804369884, status: 'UP' }], ranges)[0];
    assert.equal(result.uptime24h, null);
    assert.ok(result.uptimeHistory.every(day => day.uptime === null));
  }
  assert.equal(sanitizeUptimeResults([{ id: 804369884, custom_uptime_ratio: '100' }], [{ id: 804369884, status: 'PAUSED' }], ranges)[0].uptime24h, null);
});

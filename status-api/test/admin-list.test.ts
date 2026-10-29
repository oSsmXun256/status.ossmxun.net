import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentPage } from '../src/admin-list.js';
import type { ManagedIncident } from '../src/incidents.js';
const record = (id: string, status: 'investigating' | 'resolved') => ({ id, status, updatedAt: `2026-10-${id.padStart(2, '0')}T00:00:00Z` } as ManagedIncident);
test('resolved incidents disappear from the default list immediately and remain in history', () => {
  const items = [record('1', 'resolved'), record('2', 'investigating')];
  assert.deepEqual(incidentPage(items, 'active', 1).items.map(item => item.id), ['2']);
  items[1].status = 'resolved';
  assert.equal(incidentPage(items, 'active', 1).items.length, 0);
  assert.deepEqual(incidentPage(items, 'resolved', 1).items.map(item => item.id), ['2','1']);
  assert.equal(items.length, 2);
});
test('incident lists stay bounded and clamp the current page after resolving the last item', () => {
  const items = Array.from({length:21}, (_,index) => record(String(index+1), 'investigating'));
  assert.equal(incidentPage(items, 'active', 1).items.length, 10);
  assert.equal(incidentPage(items, 'active', 3).items.length, 1);
  items[0].status = 'resolved';
  const result = incidentPage(items, 'active', 3);
  assert.equal(result.page, 2); assert.equal(result.items.length, 10); assert.equal(result.activeCount, 20); assert.equal(result.resolvedCount, 1);
});

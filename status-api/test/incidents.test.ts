import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { incidentInput, validStoredIncident, reportedState } from '../src/incidents.js';
import { MaintenanceStore } from '../src/maintenance.js';
import { registerAdmin } from '../src/admin.js';
const input = { title: '送信できない問題', serviceIds: ['notify'], impact: 'degraded', status: 'investigating', message: '調査しています。' };

test('incident updates append status and text, preserve history, and support resolving and reopening', () => {
  const initial = incidentInput(input, undefined, '2026-10-23T01:00:00.000Z');
  const updated = incidentInput({ status: 'identified', message: '原因を特定し対応しています。', title: 'changed', serviceIds: ['website'], updates: [] }, initial, '2026-10-23T01:05:00.000Z');
  assert.equal(updated.title, initial.title); assert.deepEqual(updated.serviceIds, ['notify']);
  assert.equal(updated.updates.length, 2); assert.deepEqual(updated.updates[0], initial.updates[0]);
  assert.equal(updated.resolvedAt, null); assert.ok(validStoredIncident(updated));
  const resolved = incidentInput({ impact: 'down', status: 'resolved', message: '解決しました。' }, updated, '2026-10-23T01:10:00.000Z');
  assert.equal(resolved.impact, 'down'); assert.equal(resolved.updates[0].impact, 'degraded'); assert.equal(resolved.resolvedAt, resolved.updatedAt); assert.ok(validStoredIncident(resolved));
  const reopened = incidentInput({ status: 'investigating', message: '再発したため調査しています。' }, resolved, '2026-10-23T01:15:00.000Z');
  assert.equal(reopened.resolvedAt, null); assert.equal(reopened.updates.length, 4); assert.ok(validStoredIncident(reopened));
  assert.equal(validStoredIncident({ ...updated, status: 'resolved' }), false);
});
test('incident validation rejects missing content, unknown services and invented states', () => {
  for (const patch of [{ title: '' }, { serviceIds: [] }, { serviceIds: ['unknown'] }, { serviceIds: ['notify', 'notify'] }, { status: 'normal' }, { message: ' ' }, { message: 'a'.repeat(4001) }, { impact: 'operational' }]) assert.throws(() => incidentInput({ ...input, ...patch }));
  assert.throws(() => incidentInput({ status: 'resolved' }, incidentInput(input)));
});
test('manual reports reflect impact without masking a monitor outage or manufacturing recovery', () => {
  const incident = incidentInput(input);
  assert.equal(reportedState('operational', [incident], 'notify'), 'degraded');
  assert.equal(reportedState('unknown', [incident], 'notify'), 'degraded');
  assert.equal(reportedState('down', [incident], 'notify'), 'down');
  assert.equal(reportedState('maintenance', [incident], 'notify'), 'maintenance');
  assert.equal(reportedState('operational', [{ ...incident, impact: 'down' }], 'notify'), 'down');
  assert.equal(reportedState('unknown', [{ ...incident, status: 'resolved' }], 'notify'), 'unknown');
  assert.equal(reportedState('operational', [incident], 'website'), 'operational');
});
test('incident API inherits Access and CSRF protection and preserves maintenance through concurrent writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'status-incidents-')), file = join(directory, 'maintenance.json');
  await writeFile(file, JSON.stringify({ version: 1, maintenance: [] }));
  const store = new MaintenanceStore(file), app = Fastify();
  registerAdmin(app, { store, origin: 'https://status-api.ossmxun.net', verify: async token => { if (token !== 'test-only') throw new Error(); return { email: 'local@example.com', subject: 'local' }; } });
  const headers = { 'cf-access-jwt-assertion': 'test-only', origin: 'https://status-api.ossmxun.net', 'x-status-admin': '1', 'content-type': 'application/json' };
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/admin/api/incidents', payload: input })).statusCode, 401);
    const current = await store.read(); const matched = { ...headers, 'if-match': `"${current.revision}"` };
    assert.equal((await app.inject({ method: 'POST', url: '/admin/api/incidents', headers: { ...matched, origin: 'https://evil.example' }, payload: input })).statusCode, 403);
    const created = await app.inject({ method: 'POST', url: '/admin/api/incidents', headers: matched, payload: input });
    assert.equal(created.statusCode, 201); const body = created.json(); const id = body.incidents[0].id;
    const revision = body.revision;
    const writes = await Promise.all([
      app.inject({ method: 'PATCH', url: '/admin/api/incidents/' + id, headers: { ...headers, 'if-match': `"${revision}"` }, payload: { status: 'monitoring', message: '修正後の状況を確認しています。' } }),
      app.inject({ method: 'POST', url: '/admin/api/maintenance', headers: { ...headers, 'if-match': `"${revision}"` }, payload: { title: '保守', reason: '更新', status: 'in_progress', serviceIds: ['website'], startsAt: null, endsAt: null } }),
    ]);
    assert.equal(writes.filter(result => result.statusCode === 409).length, 1); assert.equal(writes.filter(result => [200, 201].includes(result.statusCode)).length, 1);
    let after = await store.read();
    if (after.incidents[0].updates.length === 1) { await store.updateIncident(after.revision, { status: 'monitoring', message: '修正後の状況を確認しています。' }, id); after = await store.read(); }
    if (!after.items.length) await store.update(after.revision, { title: '保守', reason: '更新', status: 'in_progress', serviceIds: ['website'], startsAt: null, endsAt: null });
    const final = await store.read(); assert.equal(final.incidents[0].updates.length, 2); assert.equal(final.items.length, 1);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).incidents.length, 1);
    assert.equal((await app.inject({ method: 'PATCH', url: '/admin/api/incidents/' + id, headers: { ...headers, 'if-match': `"${final.revision}"` }, payload: { status: 'resolved', message: '' } })).statusCode, 400);
    assert.equal((await store.read()).revision, final.revision);
    await writeFile(file, JSON.stringify({ version: 1, maintenance: [], incidents: null })); await assert.rejects(store.read());
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { accessVerifier } from '../src/access.js';
import { registerAdmin } from '../src/admin.js';
import { MaintenanceStore, maintenanceInput } from '../src/maintenance.js';
import { activeMaintenance, effectiveMaintenance } from '../src/status.js';
const config = { issuer: 'https://example.cloudflareaccess.com', audience: 'test-audience', allowedEmails: ['admin@example.com'] };
const pair = await generateKeyPair('RS256');
const jwk = await exportJWK(pair.publicKey); jwk.kid = 'test';
const verify = accessVerifier(config, createLocalJWKSet({ keys: [jwk] }))!;
async function token(overrides: Record<string, unknown> = {}, signingKey = pair.privateKey) { return new SignJWT({ type: 'app', email: 'admin@example.com', sub: 'admin', iss: config.issuer, aud: config.audience, exp: Math.floor(Date.now()/1000)+600, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(signingKey); }
const input = { title: 'テスト用メンテナンス', reason: 'ローカル検証', serviceIds: ['website'], status: 'scheduled', startsAt: '2030-01-01T10:00:00+09:00', endsAt: '2030-01-01T11:00:00+09:00' };
test('Access verifies signature, issuer, audience, expiry, app type and email', async () => {
  assert.equal((await verify(await token())).email, 'admin@example.com');
  for (const overrides of [{ iss: 'https://wrong.cloudflareaccess.com' }, { aud: 'wrong' }, { exp: 1 }, { email: 'other@example.com' }, { type: 'org' }, { sub: undefined }]) await assert.rejects(verify(await token(overrides)));
  const forged = await generateKeyPair('RS256'); await assert.rejects(verify(await token({}, forged.privateKey)));
  assert.equal(accessVerifier({ ...config, audience: '' }), null);
  assert.equal(accessVerifier({ ...config, allowedEmails: [] }), null);
});
test('maintenance validation and scheduled state do not turn planned end into completion', () => {
  const item = maintenanceInput(input);
  assert.equal(item.startsAt, '2030-01-01T01:00:00.000Z');
  assert.equal(activeMaintenance([item], Date.parse('2030-01-01T00:59:59Z')).length, 0);
  assert.equal(effectiveMaintenance([item], Date.parse('2030-01-01T01:00:00Z'))[0].status, 'in_progress');
  assert.equal(activeMaintenance([item], Date.parse('2030-01-02T00:00:00Z')).length, 1);
  for (const patch of [{ serviceIds: ['not-a-service'] }, { serviceIds: [] }, { title: '' }, { startsAt: null }, { startsAt: '2030-02-30T01:00:00Z' }, { endsAt: '2020-01-01T01:00:00Z' }]) assert.throws(() => maintenanceInput({ ...input, ...patch }));
});
test('admin routes fail closed and writes enforce origin and revision, with atomic conflict detection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'status-admin-')); const file = join(directory, 'maintenance.json');
  await writeFile(file, JSON.stringify({ version: 1, maintenance: [] }));
  const app = Fastify(); const store = new MaintenanceStore(file);
  registerAdmin(app, { store, origin: 'https://status-api.ossmxun.net', verify });
  try {
    for (const path of ['/admin', '/admin/', '/admin/style.css', '/admin/app.js', '/admin/api/maintenance']) assert.equal((await app.inject(path)).statusCode, 401);
    const headers = { 'cf-access-jwt-assertion': await token(), origin: 'https://status-api.ossmxun.net', 'x-status-admin': '1', 'content-type': 'application/json' };
    assert.equal((await app.inject({ url: '/admin/', headers })).statusCode, 200);
    assert.equal((await app.inject({ url: '/admin/style.css', headers })).statusCode, 200);
    const state = (await app.inject({ url: '/admin/api/maintenance', headers })).json();
    assert.equal(state.services.some((service: object) => 'host' in service), false);
    assert.equal((await app.inject({ method: 'POST', url: '/admin/api/maintenance', headers, payload: input })).statusCode, 428);
    const validHeaders = { ...headers, 'if-match': `"${state.revision}"` };
    assert.equal((await app.inject({ method: 'POST', url: '/admin/api/maintenance', headers: { ...validHeaders, origin: 'https://evil.example' }, payload: input })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/admin/api/maintenance', headers: { ...validHeaders, 'x-status-admin': '' }, payload: input })).statusCode, 403);
    const attempts = await Promise.all([1,2].map(() => app.inject({ method: 'POST', url: '/admin/api/maintenance', headers: validHeaders, payload: input })));
    assert.deepEqual(attempts.map(result => result.statusCode).sort(), [201, 409]);
    const created = attempts.find(result => result.statusCode === 201)!.json();
    const id = created.maintenance[0].id;
    const completed = await app.inject({ method: 'PATCH', url: '/admin/api/maintenance/' + id, headers: { ...headers, 'if-match': `"${created.revision}"` }, payload: { ...input, status: 'completed' } });
    assert.equal(completed.statusCode, 200); assert.ok(completed.json().maintenance[0].completedAt);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).maintenance.length, 1);
    await writeFile(file, '{broken'); await assert.rejects(store.read());
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
test('admin remains unavailable without authentication configuration', async () => {
  const app = Fastify(); registerAdmin(app, { store: new MaintenanceStore('unused'), origin: 'https://status-api.ossmxun.net', verify: null });
  try { assert.equal((await app.inject('/admin/')).statusCode, 503); } finally { await app.close(); }
});

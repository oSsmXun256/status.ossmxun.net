import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { services } from './services.js';
import { MaintenanceError, MaintenanceStore } from './maintenance.js';
import type { AccessPrincipal } from './access.js';

interface Options {
  store: MaintenanceStore;
  origin: string;
  verify: ((token: string) => Promise<AccessPrincipal>) | null;
}

export function registerAdmin(app: FastifyInstance, options: Options) {
  const principals = new WeakMap<FastifyRequest, AccessPrincipal>();
  app.register(async admin => {
    admin.addHook('onRequest', async (request, reply) => {
      reply.header('cache-control', 'no-store').header('x-frame-options', 'DENY').header('referrer-policy', 'no-referrer')
        .header('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      if (!options.verify) return reply.code(503).send({ message: '管理画面の認証設定が完了していません。' });
      const token = request.headers['cf-access-jwt-assertion'];
      if (typeof token !== 'string' || token.length > 16_384) return reply.code(401).send({ message: 'ログインが必要です。ページを再読み込みしてください。' });
      try { principals.set(request, await options.verify(token)); }
      catch { return reply.code(401).send({ message: 'ログインの有効期限が切れたか、アクセスが許可されていません。' }); }
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (request.headers.origin !== options.origin || request.headers['x-status-admin'] !== '1') return reply.code(403).send({ message: '同じ管理画面から操作してください。' });
        if (!request.headers['content-type']?.startsWith('application/json')) return reply.code(415).send({ message: 'JSON形式で送信してください。' });
      }
    });
    admin.setErrorHandler((error, request, reply) => {
      if (error instanceof MaintenanceError) return reply.code(error.statusCode).send({ message: error.message });
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 400) return reply.code(400).send({ message: '入力内容を確認してください。' });
      request.log.error({ event: 'maintenance_operation_failed' });
      return reply.code(503).send({ message: 'メンテナンス情報の読み書きに失敗しました。' });
    });
    admin.get('', async (_request, reply) => reply.redirect('/admin/'));
    admin.get('/', { prefixTrailingSlash: 'slash' }, async (_request, reply) => reply.type('text/html; charset=utf-8').send(await readFile(new URL('../admin/index.html', import.meta.url))));
    admin.get('/style.css', async (_request, reply) => reply.type('text/css').send(await readFile(new URL('../admin/style.css', import.meta.url))));
    admin.get('/app.js', async (_request, reply) => reply.type('text/javascript').send(await readFile(new URL('./admin-client.js', import.meta.url))));
    admin.get('/api/maintenance', async (request, reply) => {
      const state = await options.store.read();
      return reply.header('etag', `"${state.revision}"`).send({ version: 1, revision: state.revision, maintenance: state.items,
        services: services.map(service => ({ id: service.id, name: service.name, group: service.group })), email: principals.get(request)!.email });
    });
    async function save(request: FastifyRequest, reply: import('fastify').FastifyReply, id?: string) {
      const match = request.headers['if-match'];
      if (typeof match !== 'string' || !/^"[a-f0-9]{64}"$/.test(match)) return reply.code(428).send({ message: '一覧を読み込んでから保存してください。' });
      const result = await options.store.update(match.slice(1, -1), request.body, id);
      request.log.info({ event: id ? 'maintenance_updated' : 'maintenance_created', maintenanceId: result.item.id, actor: principals.get(request)!.email });
      return reply.code(id ? 200 : 201).header('etag', `"${result.revision}"`).send({ version: 1, revision: result.revision, maintenance: result.items });
    }
    admin.post('/api/maintenance', async (request, reply) => save(request, reply));
    admin.patch<{ Params: { id: string } }>('/api/maintenance/:id', async (request, reply) => save(request, reply, request.params.id));
  }, { prefix: '/admin' });
}

import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { services } from './services.js';
import type { MaintenanceItem } from './status.js';
import { incidentInput, validStoredIncident, type ManagedIncident } from './incidents.js';

export class MaintenanceError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

function date(value: unknown, label: string): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new MaintenanceError(400, `${label}を正しく入力してください。`);
  }
  if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new MaintenanceError(400, `${label}を正しく入力してください。`);
  return new Date(value).toISOString();
}

export function maintenanceInput(input: unknown, previous?: MaintenanceItem, now = new Date().toISOString()): MaintenanceItem {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MaintenanceError(400, '入力内容を確認してください。');
  const value = input as Record<string, unknown>;
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) throw new MaintenanceError(400, 'タイトルは1〜120文字で入力してください。');
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 2000) throw new MaintenanceError(400, '理由は1〜2000文字で入力してください。');
  if (!Array.isArray(value.serviceIds) || !value.serviceIds.length || value.serviceIds.length > services.length || !value.serviceIds.every(id => typeof id === 'string' && services.some(service => service.id === id))) {
    throw new MaintenanceError(400, '対象サービスを選択してください。');
  }
  if (!['scheduled', 'in_progress', 'completed'].includes(String(value.status))) throw new MaintenanceError(400, '状態を選択してください。');
  const status = value.status as MaintenanceItem['status'];
  const startsAt = date(value.startsAt, '開始日時') ?? (status === 'in_progress' ? now : null);
  const endsAt = date(value.endsAt, '終了予定');
  if (status === 'scheduled' && !startsAt) throw new MaintenanceError(400, '予定には開始日時が必要です。');
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new MaintenanceError(400, '終了予定は開始日時より後にしてください。');
  return {
    id: previous?.id ?? randomUUID(), title: value.title.trim(), reason: value.reason.trim(),
    serviceIds: [...new Set(value.serviceIds)] as string[], status, startsAt, endsAt,
    completedAt: status === 'completed' ? previous?.completedAt ?? now : null,
  };
}

function validStored(item: unknown): item is MaintenanceItem {
  try {
    if (!item || typeof item !== 'object') return false;
    const stored = item as MaintenanceItem;
    if (typeof stored.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(stored.id)) return false;
    date(stored.completedAt, '完了日時');
    maintenanceInput(stored, stored);
    return true;
  } catch { return false; }
}

export class MaintenanceStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private path: string) {}

  async read() {
    const raw = await readFile(this.path, 'utf8');
    if (Buffer.byteLength(raw) > 1_000_000) throw new Error('maintenance_file_too_large');
    const parsed = JSON.parse(raw) as { version?: unknown; maintenance?: unknown; incidents?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.maintenance) || parsed.maintenance.length > 200 || !parsed.maintenance.every(validStored)) throw new Error('invalid_maintenance_file');
    const items = parsed.maintenance as MaintenanceItem[];
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('duplicate_maintenance_id');
    const incidents = parsed.incidents === undefined ? [] : parsed.incidents;
    if (!Array.isArray(incidents) || incidents.length > 200 || !incidents.every(validStoredIncident) || new Set(incidents.map(item => item.id)).size !== incidents.length) throw new Error('invalid_incident_file');
    return { items, incidents: incidents as ManagedIncident[], revision: createHash('sha256').update(raw).digest('hex') };
  }

  update(revision: string, input: unknown, id?: string) { return this.updateRecord('maintenance', revision, input, id); }

  updateIncident(revision: string, input: unknown, id?: string) { return this.updateRecord('incident', revision, input, id); }

  private updateRecord(kind: 'maintenance' | 'incident', revision: string, input: unknown, id?: string) {
    const operation = this.queue.then(async () => {
      const current = await this.read();
      if (current.revision !== revision) throw new MaintenanceError(409, '別の操作で更新されています。一覧を再読み込みしてから保存してください。');
      const records = kind === 'maintenance' ? current.items : current.incidents;
      const previous = id ? records.find(item => item.id === id) : undefined;
      if (id && !previous) throw new MaintenanceError(404, '対象の情報が見つかりません。');
      if (!id && records.length >= 200) throw new MaintenanceError(400, '登録上限に達しました。');
      const item = kind === 'maintenance'
        ? maintenanceInput(input, previous as MaintenanceItem | undefined)
        : incidentInput(input, previous as ManagedIncident | undefined);
      const items = kind === 'maintenance' ? (previous ? current.items.map(existing => existing.id === item.id ? item as MaintenanceItem : existing) : [...current.items, item as MaintenanceItem]) : current.items;
      const incidents = kind === 'incident' ? (previous ? current.incidents.map(existing => existing.id === item.id ? item as ManagedIncident : existing) : [...current.incidents, item as ManagedIncident]) : current.incidents;
      const raw = JSON.stringify({ version: 1, maintenance: items, incidents }, null, 2) + '\n';
      if (Buffer.byteLength(raw) > 1_000_000) throw new MaintenanceError(400, 'メンテナンス情報の容量上限に達しました。');
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, raw, { mode: 0o640, flag: 'wx' });
        await rename(temporary, this.path);
      } finally { await unlink(temporary).catch(() => {}); }
      return { item, items, incidents, revision: createHash('sha256').update(raw).digest('hex') };
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

import { randomUUID } from 'node:crypto';
import { services } from './services.js';
import type { State } from './status.js';

export const incidentStatuses = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export type IncidentStatus = typeof incidentStatuses[number];
export interface IncidentUpdate { id: string; status: IncidentStatus; impact: 'degraded' | 'down'; message: string; createdAt: string }
export interface ManagedIncident {
  id: string;
  title: string;
  serviceIds: string[];
  impact: 'degraded' | 'down';
  status: IncidentStatus;
  startedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  updates: IncidentUpdate[];
}
export class IncidentError extends Error { statusCode = 400; }
const validStatus = (value: unknown): value is IncidentStatus => incidentStatuses.includes(value as IncidentStatus);
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
function validServices(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.length <= services.length && value.every(id => services.some(service => service.id === id)) && new Set(value).size === value.length; }

export function incidentInput(input: unknown, previous?: ManagedIncident, now = new Date().toISOString()): ManagedIncident {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new IncidentError('入力内容を確認してください。');
  const value = input as Record<string, unknown>;
  if (!validStatus(value.status)) throw new IncidentError('状態を選択してください。');
  if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 4000) throw new IncidentError('更新内容は1〜4000文字で入力してください。');
  if (previous && previous.updates.length >= 200) throw new IncidentError('追記の上限に達しました。');
  if (!previous) {
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) throw new IncidentError('タイトルは1〜120文字で入力してください。');
    if (!validServices(value.serviceIds)) throw new IncidentError('対象サービスを選択してください。');
  }
  const impact = value.impact ?? previous?.impact;
  if (impact !== 'degraded' && impact !== 'down') throw new IncidentError('影響を選択してください。');
  const update: IncidentUpdate = { id: randomUUID(), status: value.status, impact, message: value.message.trim(), createdAt: now };
  return {
    id: previous?.id ?? randomUUID(), title: previous?.title ?? (value.title as string).trim(),
    serviceIds: previous?.serviceIds ?? [...value.serviceIds as string[]], impact,
    status: value.status, startedAt: previous?.startedAt ?? now, updatedAt: now,
    resolvedAt: value.status === 'resolved' ? previous?.resolvedAt ?? now : null,
    updates: [...previous?.updates ?? [], update],
  };
}

export function validStoredIncident(input: unknown): input is ManagedIncident {
  if (!input || typeof input !== 'object') return false;
  const item = input as ManagedIncident;
  if (!validId(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120 || !validServices(item.serviceIds) || !['degraded', 'down'].includes(item.impact) || !validStatus(item.status) || !validTime(item.startedAt) || !validTime(item.updatedAt)) return false;
  if (!Array.isArray(item.updates) || !item.updates.length || item.updates.length > 200) return false;
  if (!item.updates.every((update, index) => update && typeof update === 'object' && validId(update.id) && validStatus(update.status) && ['degraded', 'down'].includes(update.impact) && typeof update.message === 'string' && update.message.trim().length > 0 && update.message.length <= 4000 && validTime(update.createdAt) && (index === 0 || update.createdAt >= item.updates[index - 1].createdAt))) return false;
  const last = item.updates.at(-1)!;
  return new Set(item.updates.map(update => update.id)).size === item.updates.length && item.startedAt === item.updates[0].createdAt && item.updatedAt === last.createdAt && item.status === last.status && item.impact === last.impact && (item.status === 'resolved' ? validTime(item.resolvedAt) && item.resolvedAt >= item.startedAt && item.resolvedAt <= item.updatedAt : item.resolvedAt === null);
}

export function reportedState(base: State, incidents: ManagedIncident[], serviceId: string): State {
  const active = incidents.filter(item => item.status !== 'resolved' && item.serviceIds.includes(serviceId));
  if (base === 'maintenance' || !active.length) return base;
  return base === 'down' || active.some(item => item.impact === 'down') ? 'down' : 'degraded';
}

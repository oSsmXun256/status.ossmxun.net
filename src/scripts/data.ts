export type State = 'operational' | 'degraded' | 'down' | 'maintenance' | 'unknown';
export interface ServiceResult { id: string; state: State; uptime24h: number | null; uptimeUpdatedAt?: string; }
export interface Incident { id: string; serviceId: string; startedAt: string; resolvedAt: string | null; }
export interface StatusData { version: number; fetchedAt: string | null; fetchState: string; services: ServiceResult[]; incidents: Incident[]; }
export interface Maintenance { id: string; title: string; serviceIds: string[]; reason: string; status: 'scheduled' | 'in_progress' | 'completed'; startsAt: string | null; endsAt: string | null; completedAt: string | null; }
export interface MaintenanceData { version: number; maintenance: Maintenance[]; }
const base = 'https://raw.githubusercontent.com/oSsmXun256/status.ossmxun.net/main/public/data/';

export async function loadData<T>(file: string): Promise<T> {
  const response = await fetch(`${base}${file}?t=${Math.floor(Date.now() / 300000)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('データを取得できません');
  const data = await response.json();
  if (data.version !== 1) throw new Error('未対応のデータ形式です');
  return data as T;
}

export function element(tag: string, text: string, className?: string) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

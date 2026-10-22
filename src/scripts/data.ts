export type State = 'operational' | 'degraded' | 'down' | 'maintenance' | 'unknown';
export interface ServiceResult { id: string; state: State; uptime24h: number | null; monitoringStateSince: string | null; }
export interface Incident { id: string; serviceId: string; startedAt: string; resolvedAt: string | null; }
export interface Maintenance { id: string; title: string; serviceIds: string[]; reason: string; status: 'scheduled' | 'in_progress' | 'completed'; startsAt: string | null; endsAt: string | null; completedAt: string | null; }
export interface StatusData {
  version: number;
  state: State;
  services: ServiceResult[];
  incidents: Incident[];
  maintenance: { state: 'none' | 'in_progress'; items: Maintenance[] };
  freshness: { state: 'fresh' | 'stale'; fetchedAt: string | null; updatedAt: string | null; ageSeconds: number | null };
}

export async function loadStatus<T>(): Promise<T> {
  const response = await fetch('https://status-api.ossmxun.net/api/status', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('status_unavailable');
  const data = await response.json();
  if (data.version !== 1) throw new Error('unsupported_status_version');
  return data as T;
}

export function element(tag: string, text: string, className?: string) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

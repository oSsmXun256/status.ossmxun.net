import services from '../data/services.json';
import { labels, dateLabel } from '../lib/status.mjs';
import { loadStatus, type StatusData, type State } from './data';
import { incidentCard, maintenanceCard } from './events';

const get = (id: string) => document.getElementById(id)!;
let latest: StatusData | null = null;
let failed = false;

function render() {
  const fresh = latest?.freshness.state === 'fresh' && !failed;
  for (const service of services) {
    const row = document.querySelector<HTMLElement>(`[data-service="${service.id}"]`)!;
    const result = latest?.services.find(item => item.id === service.id);
    const state: State = fresh && result && result.state in labels ? result.state : 'unknown';
    const badge = row.querySelector<HTMLElement>('[data-badge]')!;
    badge.dataset.state = state;
    badge.textContent = labels[state];
    const uptime = result?.uptime24h;
    row.querySelector('[data-uptime]')!.textContent = fresh && typeof uptime === 'number' && Number.isFinite(uptime) && uptime >= 0 && uptime <= 100 ? `${uptime.toFixed(2)}%` : '—';
  }

  const state: State = fresh && latest ? latest.state : 'unknown';
  const overview = get('overall');
  overview.dataset.state = state;
  const titles = { operational: 'すべてのシステムは正常に稼働しています', degraded: '一部のサービスで障害が発生しています', down: 'サービスが停止しています', maintenance: 'メンテナンス中', unknown: '稼働状況は不明です' };
  get('overall-label').textContent = titles[state];
  get('last-updated').textContent = dateLabel(latest?.freshness.updatedAt);
  get('data-error').textContent = failed || !fresh ? '現在、稼働情報を取得できません' : '';

  const current = get('current-events');
  const history = get('history-events');
  const currentSection = get('current-section');
  const historySection = get('history-section');
  current.replaceChildren();
  history.replaceChildren();
  currentSection.hidden = true;
  historySection.hidden = true;
  if (!fresh || !latest) return;
  const active = latest.incidents.filter(item => !item.resolvedAt);
  const ongoingMaintenance = latest.maintenance.items.filter(item => item.status === 'in_progress');
  active.forEach(item => current.append(incidentCard(item)));
  ongoingMaintenance.forEach(item => current.append(maintenanceCard(item)));
  currentSection.hidden = !current.children.length;
  const past = [
    ...latest.incidents.filter(item => item.resolvedAt).map(item => ({ at: item.startedAt, node: incidentCard(item) })),
    ...latest.maintenance.items.filter(item => item.status === 'completed').map(item => ({ at: item.completedAt ?? item.startsAt ?? '', node: maintenanceCard(item) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  past.slice(0, 50).forEach(item => history.append(item.node));
  historySection.hidden = !history.children.length;
}

async function refresh() {
  try {
    latest = await loadStatus<StatusData>();
    failed = false;
  } catch {
    failed = true;
  }
  render();
}

void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 300000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });

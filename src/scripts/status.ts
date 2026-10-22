import services from '../data/services.json';
import { labels, dateLabel } from '../lib/status.mjs';
import { loadStatus, element, type StatusData, type State, type UptimeDay } from './data';
import { incidentCard, maintenanceCard, managedIncidentCard } from './events';
import { groupHistory, groupState, meanUptime, validUptime } from '../lib/metrics.mjs';

const get = (id: string) => document.getElementById(id)!;
let latest: StatusData | null = null;
let failed = false;

const formatUptime = (value: unknown) => validUptime(value) ? `${(value as number).toFixed(2)}%` : '—';

function renderHistory(target: HTMLElement, points: UptimeDay[]) {
  target.replaceChildren();
  target.hidden = !points.some(point => validUptime(point.uptime));
  if (target.hidden) return;
  const descriptions: string[] = [];
  for (const point of points) {
    const state = !validUptime(point.uptime) ? 'unknown' : point.uptime === 100 ? 'operational' : point.uptime === 0 ? 'down' : 'degraded';
    const label = `${point.date}：${state === 'unknown' ? '記録不足' : formatUptime(point.uptime)}`;
    const bar = element('span', '', 'history-bar');
    bar.dataset.state = state;
    bar.title = label;
    descriptions.push(label);
    target.append(bar);
  }
  if (target.getAttribute('aria-hidden') !== 'true') target.setAttribute('aria-label', descriptions.join('、'));
}

function render() {
  const fresh = latest?.freshness.state === 'fresh' && !failed;
  const reports = !failed ? latest?.managedIncidents?.items ?? [] : [];
  const openReports = reports.filter(item => item.status !== 'resolved');
  for (const service of services) {
    const row = document.querySelector<HTMLElement>(`[data-service="${service.id}"]`)!;
    const result = latest?.services.find(item => item.id === service.id);
    const state: State = !failed && result?.state === 'maintenance' ? 'maintenance' : openReports.some(item => item.serviceIds.includes(service.id)) && result ? result.state : fresh && result && result.state in labels ? result.state : 'unknown';
    const badge = row.querySelector<HTMLElement>('[data-badge]')!;
    badge.dataset.state = state;
    badge.textContent = labels[state];
    const uptime = result?.uptime24h;
    row.querySelector('[data-uptime]')!.textContent = fresh ? formatUptime(uptime) : '—';
    renderHistory(row.querySelector<HTMLElement>('[data-service-history]')!, fresh ? result?.uptimeHistory ?? [] : []);
  }

  for (const group of document.querySelectorAll<HTMLElement>('[data-group]')) {
    const members = services.filter(service => service.group === group.dataset.group);
    const results = members.map(service => latest?.services.find(item => item.id === service.id));
    const state = fresh ? groupState(results.map(result => result?.state ?? 'unknown')) : !failed && results.some(result => result?.state === 'maintenance') ? 'maintenance' : openReports.some(item => members.some(member => item.serviceIds.includes(member.id))) ? 'degraded' : 'unknown';
    const ratio = fresh ? meanUptime(results.map(result => result?.uptime24h)) : null;
    group.querySelector<HTMLElement>('[data-group-icon]')!.dataset.state = state;
    group.querySelector('[data-group-uptime]')!.textContent = formatUptime(ratio);
    group.querySelector('summary')!.setAttribute('aria-label', `${group.dataset.group}、${labels[state as State]}、${members.length}サービス、24時間の平均稼働率 ${formatUptime(ratio)}`);
    renderHistory(group.querySelector<HTMLElement>('[data-group-history]')!, fresh ? groupHistory(results) : []);
  }

  const state: State = fresh && latest && latest.state !== 'unknown' ? latest.state : openReports.length ? 'degraded' : !failed && latest?.maintenance.state === 'in_progress' ? 'maintenance' : 'unknown';
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
  get('history-link').hidden = true;
  if (failed || !latest) return;
  const active = fresh ? latest.incidents.filter(item => !item.resolvedAt) : [];
  const ongoingMaintenance = latest.maintenance.items.filter(item => item.status !== 'completed');
  active.forEach(item => current.append(incidentCard(item)));
  ongoingMaintenance.forEach(item => current.append(maintenanceCard(item)));
  openReports.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).forEach(item => current.append(managedIncidentCard(item)));
  currentSection.hidden = !current.children.length;
  const past = [
    ...reports.filter(item => item.status === 'resolved').map(item => ({ at: item.resolvedAt ?? item.updatedAt, node: managedIncidentCard(item) })),
    ...(fresh ? latest.incidents.filter(item => item.resolvedAt).map(item => ({ at: item.startedAt, node: incidentCard(item) })) : []),
    ...latest.maintenance.items.filter(item => item.status === 'completed').map(item => ({ at: item.completedAt ?? item.startsAt ?? '', node: maintenanceCard(item) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  past.slice(0, 50).forEach(item => history.append(item.node));
  historySection.hidden = !history.children.length;
  get('history-link').hidden = historySection.hidden;
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

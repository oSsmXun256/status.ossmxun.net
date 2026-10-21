import services from '../data/services.json';
import { labels, overall, isFresh, activeMaintenance, dateLabel } from '../lib/status.mjs';
import { loadData, element, type StatusData, type MaintenanceData, type Maintenance, type State } from './data';
import { maintenanceCard, incidentCard } from './events';

const get = (id: string) => document.getElementById(id)!;
let latest: StatusData | null = null;
let maintenance: MaintenanceData | null = null;
let failed = false;
function render() {
  const fresh = latest && !failed && isFresh(latest);
  const ongoing: Maintenance[] = maintenance ? activeMaintenance(maintenance.maintenance) : [];
  const states: State[] = [];
  for (const service of services) {
    const row = document.querySelector<HTMLElement>(`[data-service="${service.id}"]`)!;
    const result = latest?.services.find(item => item.id === service.id);
    const inMaintenance = ongoing.some(item => item.serviceIds.includes(service.id));
    const state: State = inMaintenance ? 'maintenance' : fresh && result && result.state in labels ? result.state : 'unknown';
    states.push(state);
    const badge = row.querySelector<HTMLElement>('[data-badge]')!;
    badge.dataset.state = state;
    badge.textContent = labels[state];
    const uptime = result?.uptime24h;
    row.querySelector('[data-uptime]')!.textContent = fresh && typeof uptime === 'number' && Number.isFinite(uptime) && uptime >= 0 && uptime <= 100 ? `${uptime.toFixed(2)}%` : '—';
    row.querySelector('[data-note]')!.textContent = !service.monitorUrl ? '監視用URLを確認中' : !result ? '監視データ未取得' : !fresh ? '最新の監視データを確認できません' : state === 'unknown' ? '未確認、または監視が停止しています' : '';
  }
  const state = maintenance ? overall(states) : (overall(states) === 'operational' ? 'unknown' : overall(states));
  get('overall').dataset.state = state;
  const titles = { operational: 'すべて正常に稼働しています', degraded: '一部のサービスに障害があります', down: 'サービスが停止しています', maintenance: 'メンテナンス中です', unknown: '稼働状況は不明です' };
  get('overall-label').textContent = titles[state];
  get('overall-detail').textContent = state === 'unknown' ? '未確認のサービスがあります。下の一覧をご確認ください。' : state === 'operational' ? '監視対象の応答を確認しています。' : '対象と現在の状況は下の一覧をご確認ください。';
  get('fetched-at').textContent = dateLabel(latest?.fetchedAt);
  get('monitored-count').textContent = String(latest?.services.length ?? 0);
  get('data-notice').textContent = failed ? '監視データの取得に失敗しました。状態を「不明」として表示しています。' : !maintenance ? 'メンテナンス情報を取得できません。' : !fresh ? '最新の監視データがありません。未設定、取得失敗、または更新の遅延が考えられます。' : '監視結果は1時間ごとに反映します。監視データ取得時刻をご確認ください。';
  const current = get('current-events');
  const history = get('history-events');
  current.replaceChildren(); history.replaceChildren();
  const incidents = latest?.incidents ?? [];
  incidents.filter(item => !item.resolvedAt).forEach(item => current.append(incidentCard(item)));
  maintenance?.maintenance.filter(item => item.status !== 'completed').forEach(item => current.append(maintenanceCard(item)));
  if (!current.children.length) current.append(element('p', fresh && maintenance ? '公開されている障害・メンテナンス情報はありません。' : '最新情報を確認できません。', 'empty'));
  const past = [
    ...incidents.filter(item => item.resolvedAt).map(item => ({ at: item.startedAt, node: incidentCard(item) })),
    ...(maintenance?.maintenance ?? []).filter(item => item.status === 'completed').map(item => ({ at: item.completedAt ?? item.startsAt ?? '', node: maintenanceCard(item) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  past.slice(0, 50).forEach(item => history.append(item.node));
  if (!history.children.length) history.append(element('p', latest ? '公開されている履歴はありません。' : '履歴を取得できません。', 'empty'));
}
async function refresh() {
  const [statusResult, maintenanceResult] = await Promise.allSettled([loadData<StatusData>('status.json'), loadData<MaintenanceData>('maintenance.json')]);
  failed = statusResult.status === 'rejected';
  if (statusResult.status === 'fulfilled' && Array.isArray(statusResult.value.services) && Array.isArray(statusResult.value.incidents)) latest = statusResult.value;
  else failed = true;
  maintenance = maintenanceResult.status === 'fulfilled' && Array.isArray(maintenanceResult.value.maintenance) ? maintenanceResult.value : null;
  render();
}
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 300000);
setInterval(render, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });

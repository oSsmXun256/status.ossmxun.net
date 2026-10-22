import { loadStatus, element, type StatusData } from './data';
import { maintenanceCard } from './events';

const target = document.getElementById('maintenance-events')!;
async function refresh() {
  try {
    const data = await loadStatus<StatusData>();
    if (!Array.isArray(data.maintenance?.items)) throw new Error('maintenance_unavailable');
    const active = data.maintenance.items.filter(item => item.status !== 'completed');
    target.replaceChildren(...active.map(maintenanceCard));
    if (!active.length) target.replaceChildren(element('p', '現在、公開されているメンテナンス情報はありません。', 'empty'));
  } catch {
    target.replaceChildren(element('p', 'メンテナンス情報を取得できません。', 'empty'));
  }
}
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 300000);

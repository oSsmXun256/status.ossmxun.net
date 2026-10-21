import { loadData, element, type MaintenanceData } from './data';
import { maintenanceCard } from './events';
const target = document.getElementById('maintenance-events')!;
async function refresh() {
  try {
    const data = await loadData<MaintenanceData>('maintenance.json');
    if (!Array.isArray(data.maintenance)) throw new Error('Invalid maintenance data');
    const current = data.maintenance.filter(item => item.status !== 'completed');
    target.replaceChildren(...current.map(maintenanceCard));
    if (!current.length) target.append(element('p', '対象サービス・理由・終了予定はまだ公開されていません。転送元サービスの案内を確認し、時間をおいて再度お試しください。', 'empty'));
  } catch {
    target.replaceChildren(element('p', 'メンテナンス情報を取得できません。時間をおいて再度お試しください。', 'empty'));
  }
}
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 300000);

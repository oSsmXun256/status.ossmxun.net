import services from '../data/services.json';
import { labels, dateLabel } from '../lib/status.mjs';
import { element, type Incident, type Maintenance, type ManagedIncident } from './data';

export function serviceName(id: string) { return services.find(service => service.id === id)?.name ?? id; }
export function maintenanceCard(item: Maintenance) {
  const article = element('article', '', 'event');
  const badge = element('span', item.status === 'completed' ? '完了' : item.status === 'scheduled' ? '予定' : labels.maintenance, 'badge');
  badge.dataset.state = 'maintenance';
  article.append(badge, element('h3', item.title), element('p', `対象：${item.serviceIds.map(serviceName).join('、')}`), element('p', item.reason));
  if (item.startsAt) article.append(element('p', `開始：${dateLabel(item.startsAt)}`));
  if (item.endsAt) article.append(element('p', `終了予定：${dateLabel(item.endsAt)}`));
  if (item.status === 'completed' && item.completedAt) article.append(element('p', `完了：${dateLabel(item.completedAt)}`));
  return article;
}

export function incidentCard(item: Incident) {
  const article = element('article', '', 'event');
  const badge = element('span', item.resolvedAt ? '復旧' : '障害', 'badge');
  badge.dataset.state = item.resolvedAt ? 'operational' : 'down';
  article.append(badge, element('h3', `${serviceName(item.serviceId)}の障害`));
  article.append(element('p', `検知：${dateLabel(item.startedAt)}`));
  if (item.resolvedAt) article.append(element('p', `復旧：${dateLabel(item.resolvedAt)}`));
  return article;
}

export function managedIncidentCard(item: ManagedIncident) {
  const statuses = { investigating: '調査中', identified: '対応中', monitoring: '経過観察中', resolved: '解決済み' };
  const article = element('article', '', 'event');
  const badge = element('span', statuses[item.status], 'badge');
  badge.dataset.state = item.status === 'resolved' ? 'operational' : item.impact;
  article.append(badge, element('h3', item.title), element('p', `対象：${item.serviceIds.map(serviceName).join('、')}`));
  const latest = item.updates.at(-1)!;
  article.append(element('p', latest.message), element('p', dateLabel(latest.createdAt)));
  if (item.updates.length > 1) {
    const details = element('details', ''), list = element('ol', '', 'incident-timeline');
    details.append(element('summary', '更新履歴'));
    for (const update of [...item.updates].reverse()) {
      const row = element('li', '');
      row.append(element('h4', `${statuses[update.status]}　${dateLabel(update.createdAt)}`), element('p', update.message));
      list.append(row);
    }
    details.append(list); article.append(details);
  }
  return article;
}

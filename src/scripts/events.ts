import services from '../data/services.json';
import { labels, dateLabel } from '../lib/status.mjs';
import { element, type Incident, type Maintenance } from './data';

export function serviceName(id: string) { return services.find(service => service.id === id)?.name ?? id; }
export function maintenanceCard(item: Maintenance) {
  const article = element('article', '', 'event');
  const badge = element('span', item.status === 'completed' ? '完了' : item.status === 'scheduled' ? '予定' : labels.maintenance, 'badge');
  badge.dataset.state = 'maintenance';
  article.append(badge, element('h3', item.title), element('p', `対象：${item.serviceIds.map(serviceName).join('、') || '対象情報を確認中'}`), element('p', item.reason || 'メンテナンス理由を確認中です。'));
  if (item.startsAt) article.append(element('p', `開始：${dateLabel(item.startsAt)}`));
  article.append(element('p', item.endsAt ? `終了予定：${dateLabel(item.endsAt)}` : '終了予定：未定'));
  if (item.status === 'completed' && item.completedAt) article.append(element('p', `完了：${dateLabel(item.completedAt)}`));
  return article;
}

export function incidentCard(item: Incident) {
  const article = element('article', '', 'event');
  const badge = element('span', item.resolvedAt ? '復旧' : '障害', 'badge');
  badge.dataset.state = item.resolvedAt ? 'operational' : 'down';
  article.append(badge, element('h3', `${serviceName(item.serviceId)}の応答障害`));
  article.append(element('p', `検知：${dateLabel(item.startedAt)}`));
  if (item.resolvedAt) article.append(element('p', `復旧：${dateLabel(item.resolvedAt)}`));
  article.append(element('p', '外部監視で記録された情報です。'));
  return article;
}

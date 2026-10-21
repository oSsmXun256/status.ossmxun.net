export const labels = { operational: '正常', degraded: '一部障害', down: '停止中', maintenance: 'メンテナンス中', unknown: '不明' };
export const MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function monitorState(status) {
  return ({ UP: 'operational', LOOKS_DOWN: 'degraded', DOWN: 'down', PAUSED: 'unknown', STARTED: 'unknown' })[status] ?? 'unknown';
}

export function isFresh(data, now = Date.now()) {
  const time = Date.parse(data.fetchedAt);
  return data.fetchState === 'ok' && Number.isFinite(time) && time <= now + 60000 && now - time <= MAX_AGE_MS;
}

export function activeMaintenance(items, now = Date.now()) {
  return items.filter(item => item.status === 'in_progress' && (!item.startsAt || Date.parse(item.startsAt) <= now));
}

export function overall(states) {
  if (!states.length) return 'unknown';
  if (states.every(state => state === 'down')) return 'down';
  if (states.some(state => state === 'down' || state === 'degraded')) return 'degraded';
  if (states.includes('unknown')) return 'unknown';
  if (states.includes('maintenance')) return 'maintenance';
  return 'operational';
}

export function dateLabel(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未取得';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

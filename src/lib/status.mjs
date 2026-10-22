export const labels = { operational: '正常', degraded: '一部障害', down: '停止中', maintenance: 'メンテナンス中', unknown: '不明' };

export function dateLabel(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

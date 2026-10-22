export function validUptime(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function meanUptime(values) {
  return values.length && values.every(validUptime) ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function groupState(states) {
  if (!states.length || states.includes('unknown')) return 'unknown';
  if (states.every(state => state === 'down')) return 'down';
  if (states.some(state => state === 'down' || state === 'degraded')) return 'degraded';
  if (states.includes('maintenance')) return 'maintenance';
  return 'operational';
}

export function groupHistory(results) {
  const dates = results.find(result => result?.uptimeHistory?.length)?.uptimeHistory.map(day => day.date) ?? [];
  return dates.map(date => ({ date, uptime: meanUptime(results.map(result => result?.uptimeHistory?.find(day => day.date === date)?.uptime)) }));
}

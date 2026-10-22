import type { ManagedIncident, IncidentStatus } from './incidents.js';
interface Item { id: string; title: string; reason: string; serviceIds: string[]; status: 'scheduled' | 'in_progress' | 'completed'; startsAt: string | null; endsAt: string | null; completedAt: string | null }
interface Service { id: string; name: string; group: string }
const form = document.querySelector<HTMLFormElement>('#editor')!;
const fields = document.querySelector<HTMLFieldSetElement>('#fields')!;
const message = document.querySelector<HTMLParagraphElement>('#message')!;
let incidents: ManagedIncident[] = [];
let revision = '', items: Item[] = [], services: Service[] = [], editing: string | undefined, busy = false;
const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
function notice(text: string, error = false) { message.textContent = text; message.classList.toggle('error', error); }
function setBusy(value: boolean) { busy = value; fields.disabled = value || !revision; document.querySelector<HTMLFieldSetElement>('#incident-fields')!.disabled = value || !revision; document.querySelectorAll<HTMLFieldSetElement>('#incident-items fieldset').forEach(field => field.disabled = value); document.querySelector<HTMLButtonElement>('#reload')!.disabled = value; document.querySelectorAll<HTMLButtonElement>('#items button').forEach(button => button.disabled = value); }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) { const node = document.createElement(tag); if (text) node.textContent = text; return node; }
const dateText = (value: string | null) => value ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '未設定';
const localDate = (value: string | null) => value ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16) : '';
const isoDate = (value: string) => value ? new Date(value + ':00+09:00').toISOString() : null;
function reset() { editing = undefined; form.reset(); document.querySelector('#editor-title')!.textContent = 'メンテナンス登録'; }
function edit(item: Item) { editing = item.id; document.querySelector('#editor-title')!.textContent = '編集'; for (const name of ['title', 'reason', 'status'] as const) input(name).value = item[name]; input('startsAt').value = localDate(item.startsAt); input('endsAt').value = localDate(item.endsAt); form.querySelectorAll<HTMLInputElement>('[name="serviceIds"]').forEach(box => box.checked = item.serviceIds.includes(box.value)); input('title').focus(); }
function renderServices(selector = '#services') { const root = document.querySelector(selector)!; root.replaceChildren(); for (const group of [...new Set(services.map(service => service.group))]) { const block = element('div'); block.className = 'service-group'; block.append(element('p', group)); for (const service of services.filter(service => service.group === group)) { const label = element('label'), box = element('input'); box.type = 'checkbox'; box.name = 'serviceIds'; box.value = service.id; label.append(box, document.createTextNode(service.name)); block.append(label); } root.append(block); } }
function renderItems() { const root = document.querySelector('#items')!; root.replaceChildren(); if (!items.length) { root.append(element('p', '登録はありません')); return; } for (const item of [...items].reverse()) { const entry = element('article'); entry.className = 'entry'; const heading = element('h3', item.title), badge = element('span', { scheduled: '予定', in_progress: '実施中', completed: '完了' }[item.status]); badge.className = 'badge'; heading.append(badge); entry.append(heading, element('p', services.filter(service => item.serviceIds.includes(service.id)).map(service => service.name).join('・')), element('p', item.reason), element('p', `開始 ${dateText(item.startsAt)} / 終了予定 ${dateText(item.endsAt)}`)); if (item.completedAt) entry.append(element('p', `完了 ${dateText(item.completedAt)}`)); const actions = element('div'); actions.className = 'actions'; const editButton = element('button', '編集'); editButton.type = 'button'; editButton.className = 'secondary'; editButton.addEventListener('click', () => edit(item)); actions.append(editButton); if (item.status !== 'completed') { const finish = element('button', '完了にする'); finish.type = 'button'; finish.addEventListener('click', () => save({ ...item, status: 'completed' }, item.id)); actions.append(finish); } entry.append(actions); root.append(entry); } }
async function request(path: string, options: RequestInit = {}) { const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', ...options }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.message ?? '取得に失敗しました。ページを再読み込みしてください。'); if (!data || data.version !== 1) throw new Error('応答を確認できません。'); return data; }
async function load() { if (busy) return; setBusy(true); try { const data = await request('/admin/api/maintenance'); revision = data.revision; items = data.maintenance; incidents = data.incidents; services = data.services; document.querySelector('#account')!.textContent = data.email; renderServices(); renderServices('#incident-services'); renderItems(); renderIncidents(); reset(); notice(''); } catch (error) { notice(error instanceof Error ? error.message : '読み込みに失敗しました。', true); } finally { setBusy(false); } }
async function save(value: object, id?: string) { if (busy) return; setBusy(true); try { const data = await request('/admin/api/maintenance' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json', 'x-status-admin': '1', 'if-match': `"${revision}"` }, body: JSON.stringify(value) }); revision = data.revision; items = data.maintenance; incidents = data.incidents; renderItems(); renderIncidents(); reset(); notice('保存しました'); } catch (error) { notice(error instanceof Error ? error.message : '保存に失敗しました。', true); } finally { setBusy(false); } }
form.addEventListener('submit', event => { event.preventDefault(); const serviceIds = [...form.querySelectorAll<HTMLInputElement>('[name="serviceIds"]:checked')].map(box => box.value); if (!serviceIds.length) { notice('対象サービスを選択してください。', true); return; } const status = input('status').value; if (status === 'scheduled' && !input('startsAt').value) { notice('開始日時を入力してください。', true); return; } void save({ title: input('title').value, reason: input('reason').value, status, serviceIds, startsAt: isoDate(input('startsAt').value), endsAt: isoDate(input('endsAt').value) }, editing); });
document.querySelector('#new-entry')!.addEventListener('click', reset);
document.querySelector('#reload')!.addEventListener('click', () => void load());
const incidentForm = document.querySelector<HTMLFormElement>('#incident-editor')!;
const incidentLabels: Record<IncidentStatus, string> = { investigating: '調査中', identified: '対応中', monitoring: '経過観察中', resolved: '解決済み' };
function statusSelect(status: IncidentStatus) {
  const select = element('select'); select.name = 'status';
  for (const [value, label] of Object.entries(incidentLabels)) { const option = element('option', label); option.value = value; select.append(option); }
  select.value = status; return select;
}
function renderIncidents() {
  const root = document.querySelector('#incident-items')!; root.replaceChildren();
  if (!incidents.length) { root.append(element('p', '登録はありません')); return; }
  for (const item of [...incidents].sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || b.updatedAt.localeCompare(a.updatedAt))) {
    const entry = element('article'); entry.className = 'entry'; const heading = element('h3', item.title);
    const badge = element('span', incidentLabels[item.status]); badge.className = 'badge'; heading.append(badge);
    entry.append(heading, element('p', services.filter(service => item.serviceIds.includes(service.id)).map(service => service.name).join('・')));
    const history = element('details'), summary = element('summary', `更新履歴（${item.updates.length}件）`); history.append(summary);
    for (const update of [...item.updates].reverse()) { const row = element('div'); row.className = 'incident-update'; row.append(element('p', `${dateText(update.createdAt)}　${incidentLabels[update.status]}`), element('p', update.message)); history.append(row); }
    entry.append(element('p', item.updates.at(-1)!.message), history);
    const updateForm = element('form'), fieldset = element('fieldset'), stateLabel = element('label', '状態');
    stateLabel.append(statusSelect(item.status)); const impactLabel = element('label', '影響'), impactSelect = element('select'); impactSelect.name = 'impact'; for (const [value, label] of [['degraded', '一部障害'], ['down', '停止']]) { const option = element('option', label); option.value = value; impactSelect.append(option); } impactSelect.value = item.impact; impactLabel.append(impactSelect); const textLabel = element('label', '追記'), text = element('textarea'); text.name = 'message'; text.rows = 3; text.required = true; text.maxLength = 4000; textLabel.append(text);
    const button = element('button', '更新を追加'); button.type = 'submit'; fieldset.append(stateLabel, impactLabel, textLabel, button); updateForm.append(fieldset);
    updateForm.setAttribute('aria-label', `${item.title}の更新`);
    updateForm.addEventListener('submit', event => { event.preventDefault(); const selected = updateForm.elements.namedItem('status') as HTMLSelectElement; void saveIncident({ status: selected.value, message: text.value, impact: impactSelect.value }, item.id); });
    entry.append(updateForm); root.append(entry);
  }
}
async function saveIncident(value: object, id?: string) {
  if (busy) return; setBusy(true);
  try {
    const data = await request('/admin/api/incidents' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json', 'x-status-admin': '1', 'if-match': `"${revision}"` }, body: JSON.stringify(value) });
    revision = data.revision; items = data.maintenance; incidents = data.incidents; renderItems(); renderIncidents();
    if (!id) incidentForm.reset(); notice('保存しました');
  } catch (error) { notice(error instanceof Error ? error.message : '保存に失敗しました。', true); }
  finally { setBusy(false); }
}
incidentForm.addEventListener('submit', event => {
  event.preventDefault(); const field = (name: string) => (incidentForm.elements.namedItem(name) as HTMLInputElement).value;
  const serviceIds = [...incidentForm.querySelectorAll<HTMLInputElement>('[name="serviceIds"]:checked')].map(box => box.value);
  if (!serviceIds.length) { notice('対象サービスを選択してください。', true); return; }
  void saveIncident({ title: field('title'), serviceIds, impact: field('impact'), status: field('status'), message: field('message') });
});
void load();
export {};

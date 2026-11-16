import { useEffect, useRef, useState } from 'preact/hooks';
import { CATEGORIES, type Category, FIELD_LABELS, type Entry, normalizeCategories } from '../../../shared/model';
import { OfflineError, getEntry, removeEntry, saveEntry } from '../data';
import { formatDateLong, isValidDate, todayLocal } from '../dates';
import { type FormState, clearDraft, formFromEntry, loadDraft, sameForm, saveDraft } from '../drafts';
import { navigate } from '../router';
import { AutoTextarea, Notice } from '../ui';

const HINTS = {
  achievement: 'Что сегодня получилось? Подойдёт и самое маленькое.',
  obstacle: 'Что мешало — и всё же не остановило',
  how: 'Шаги, решения, чья-то помощь',
  lesson: 'О себе, о деле, о людях',
  goal_tomorrow: 'Один небольшой шаг',
} as const;

type Status =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'error'; text: string }
  | { kind: 'offline' };

export function Today({ date: routeDate }: { date: string | null }) {
  const today = todayLocal();
  const date = routeDate ?? today;
  const [form, setForm] = useState<FormState>(() => formFromEntry(null));
  const [saved, setSaved] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftRestored, setDraftRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const baseline = useRef<FormState>(formFromEntry(null));

  useEffect(() => {
    let cancelled = false;
    void getEntry(date)
      .catch(() => null)
      .then((entry) => {
        if (cancelled) return;
        baseline.current = formFromEntry(entry);
        const draft = loadDraft(date);
        if (draft && !sameForm(draft, baseline.current)) {
          setForm(draft);
          setDraftRestored(true);
        } else {
          clearDraft(date);
          setForm(baseline.current);
        }
        setSaved(entry);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [date]);

  const dirty = !loading && !sameForm(form, baseline.current);

  const update = (patch: Partial<FormState>) => {
    const next = { ...form, ...patch };
    setForm(next);
    setStatus({ kind: 'idle' });
    // Черновик пишется сразу при каждом изменении: текст переживёт закрытие вкладки.
    if (sameForm(next, baseline.current)) clearDraft(date);
    else saveDraft(date, next);
  };

  const toggleCategory = (c: Category) => {
    const on = form.categories.includes(c);
    update({ categories: normalizeCategories(on ? form.categories.filter((x) => x !== c) : [...form.categories, c]) });
  };

  const discardDraft = () => {
    clearDraft(date);
    setForm(baseline.current);
    setDraftRestored(false);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!form.achievement.trim()) return;
    setBusy(true);
    try {
      const entry = await saveEntry(date, form);
      baseline.current = formFromEntry(entry);
      clearDraft(date);
      setForm(baseline.current);
      setSaved(entry);
      setDraftRestored(false);
      setStatus({ kind: 'saved' });
    } catch (err) {
      setStatus(err instanceof OfflineError ? { kind: 'offline' } : { kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Удалить запись за ${formatDateLong(date, false)}? Это действие нельзя отменить.`)) return;
    try {
      await removeEntry(date);
      clearDraft(date);
      navigate('#/history');
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    }
  };

  const text = (key: keyof typeof HINTS, minRows: number, required = false) => (
    <div class="field">
      <label class="label" for={key}>{FIELD_LABELS[key]}</label>
      <AutoTextarea id={key} value={form[key]} minRows={minRows} required={required}
        placeholder={HINTS[key]} disabled={loading} onInput={(v) => update({ [key]: v })} />
    </div>
  );

  return (
    <form class="page" onSubmit={submit}>
      <header class="page-head">
        <h1>{date === today ? 'Сегодня' : formatDateLong(date, false)}</h1>
        <p class="muted">
          {date === today ? formatDateLong(date) : <a href="#/">Вернуться к сегодняшнему дню</a>}
        </p>
      </header>

      {saved && <Notice>Запись за этот день уже есть — вы её редактируете.</Notice>}
      {draftRestored && (
        <Notice>
          Восстановлен несохранённый черновик.{' '}
          <button type="button" class="link" onClick={discardDraft}>
            {saved ? 'Вернуть сохранённую версию' : 'Очистить'}
          </button>
        </Notice>
      )}

      <div class="sheet">
        <div class="field">
          <label class="label" for="date">{FIELD_LABELS.date}</label>
          <input id="date" class="input input-date" type="date" value={date} max={today} required
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (isValidDate(v) && v !== date) navigate(v === today ? '#/' : `#/day/${v}`);
            }} />
        </div>

        {text('achievement', 3, true)}

        <div class="field">
          <span class="label" id="category-label">
            {FIELD_LABELS.categories} <span class="label-hint">можно несколько</span>
          </span>
          <div class="chips" role="group" aria-labelledby="category-label">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" class={`chip${form.categories.includes(c) ? ' is-on' : ''}`}
                aria-pressed={form.categories.includes(c)} disabled={loading}
                onClick={() => toggleCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {text('obstacle', 2)}
        {text('how', 2)}
        {text('lesson', 2)}
        {text('goal_tomorrow', 2)}
      </div>

      <div class="actions">
        <button class="btn btn-primary" disabled={busy || loading || !form.achievement.trim() || (!dirty && !!saved)}>
          {saved ? 'Сохранить изменения' : 'Сохранить'}
        </button>
        <span class="status" role="status">
          {status.kind === 'saved' && 'Сохранено'}
          {status.kind === 'idle' && dirty && 'Черновик хранится на этом устройстве'}
        </span>
      </div>
      {status.kind === 'offline' && (
        <Notice>Нет связи с сервером. Черновик сохранён на устройстве — нажмите «Сохранить», когда связь появится.</Notice>
      )}
      {status.kind === 'error' && <Notice kind="error">{status.text}</Notice>}

      {saved && (
        <p class="page-foot">
          <button type="button" class="link link-quiet" onClick={remove}>Удалить запись</button>
        </p>
      )}
    </form>
  );
}

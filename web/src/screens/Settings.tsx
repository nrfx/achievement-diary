import { useEffect, useState } from 'preact/hooks';
import {
  type ImportPreview,
  type ImportResult,
  MIN_PASSWORD_LENGTH,
  type Resolution,
  formatDateLong,
} from '../../../shared/model';
import { changePassword, getTotal, importApply, importPreview, logout } from '../data';
import { type Theme, getTheme, setTheme } from '../theme';
import { Notice } from '../ui';

export function Settings() {
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    void getTotal().then(setTotal).catch(() => {});
  }, []);

  return (
    <div class="page">
      <header class="page-head">
        <h1>Настройки</h1>
        {total !== null && <p class="muted">Записей всего: {total}</p>}
      </header>
      <ThemeSection />
      <ExportSection />
      <ImportSection onImported={() => void getTotal().then(setTotal).catch(() => {})} />
      <PasswordSection />
      <section class="sheet">
        <h2>Сеанс</h2>
        <p class="muted">При выходе с этого устройства стираются локальная копия записей и черновики. На сервере всё остаётся.</p>
        <button type="button" class="btn" onClick={() => void logout().then(() => location.reload())}>Выйти</button>
      </section>
    </div>
  );
}

function ThemeSection() {
  const [theme, set] = useState<Theme>(getTheme);
  const options: [Theme, string][] = [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']];
  return (
    <section class="sheet">
      <h2>Тема</h2>
      <div class="segmented segmented-wide" role="group" aria-label="Тема">
        {options.map(([value, label]) => (
          <button key={value} type="button" class={theme === value ? 'is-on' : ''} aria-pressed={theme === value}
            onClick={() => { setTheme(value); set(value); }}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function ExportSection() {
  return (
    <section class="sheet">
      <h2>Экспорт</h2>
      <p class="muted">JSON — полная копия, подходит для импорта. Markdown — чтобы читать. CSV — для таблиц.</p>
      <div class="btn-row">
        <a class="btn" href="/api/export?format=json" download>JSON</a>
        <a class="btn" href="/api/export?format=md" download>Markdown</a>
        <a class="btn" href="/api/export?format=csv" download>CSV</a>
      </div>
    </section>
  );
}

function ImportSection({ onImported }: { onImported: () => void }) {
  const [entries, setEntries] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Resolution>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setEntries(null); setPreview(null); setChoices({}); };

  const pick = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    reset();
    setResult(null);
    setError('');
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error('Не удалось прочитать файл: это не JSON.');
      }
      const list = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown } | null)?.entries;
      if (!Array.isArray(list)) throw new Error('Это не похоже на JSON-экспорт дневника.');
      setPreview(await importPreview(list));
      setEntries(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await importApply(entries, choices));
      reset();
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const conflicts = preview?.conflicts ?? [];
  const allChosen = conflicts.every((c) => choices[c.date]);
  const setAll = (r: Resolution) => setChoices(Object.fromEntries(conflicts.map((c) => [c.date, r])));

  return (
    <section class="sheet">
      <h2>Импорт</h2>
      <p class="muted">Загрузите JSON-экспорт. Записи объединяются по дате; если на дату уже есть другая запись, вы выберете, какую оставить.</p>
      {!preview && (
        <label class={`btn${busy ? ' is-disabled' : ''}`}>
          Выбрать файл
          <input type="file" accept="application/json,.json" class="visually-hidden" disabled={busy} onChange={pick} />
        </label>
      )}

      {preview && (
        <div class="import">
          <ul class="plain">
            <li>Записей в файле: {preview.total}</li>
            <li>Новых (будут добавлены): {preview.new}</li>
            <li>Уже есть такие же: {preview.identical}</li>
            <li>Отличаются от существующих: {conflicts.length}</li>
          </ul>

          {conflicts.length > 0 && (
            <>
              <div class="btn-row">
                <button type="button" class="btn btn-small" onClick={() => setAll('keep')}>Везде оставить существующие</button>
                <button type="button" class="btn btn-small" onClick={() => setAll('replace')}>Везде заменить</button>
              </div>
              {conflicts.map((c) => (
                <fieldset key={c.date} class="conflict">
                  <legend>{formatDateLong(c.date, false)}</legend>
                  {([['keep', 'Оставить существующую', c.existing], ['replace', 'Заменить на запись из файла', c.incoming]] as const).map(
                    ([value, label, entry]) => (
                      <label key={value} class={`conflict-option${choices[c.date] === value ? ' is-on' : ''}`}>
                        <input type="radio" name={`conflict-${c.date}`} checked={choices[c.date] === value}
                          onChange={() => setChoices({ ...choices, [c.date]: value })} />
                        <span>
                          <strong>{label}</strong>
                          <span class="conflict-text">{entry.achievement}</span>
                        </span>
                      </label>
                    ),
                  )}
                </fieldset>
              ))}
            </>
          )}

          <div class="btn-row">
            <button type="button" class="btn btn-primary" disabled={busy || !allChosen} onClick={apply}>Импортировать</button>
            <button type="button" class="btn" disabled={busy} onClick={reset}>Отмена</button>
          </div>
          {!allChosen && <p class="muted">Выберите вариант для каждой даты.</p>}
        </div>
      )}

      {result && (
        <Notice kind="ok">
          Готово. Добавлено: {result.imported}, заменено: {result.replaced}, оставлено без изменений:{' '}
          {result.kept + result.identical}.
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (next !== repeat) return setMsg({ kind: 'error', text: 'Новый пароль и повтор не совпадают.' });
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent(''); setNext(''); setRepeat('');
      setMsg({ kind: 'ok', text: 'Пароль изменён. На других устройствах потребуется войти заново.' });
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, autocomplete: string) => (
    <div class="field">
      <label class="label" for={id}>{label}</label>
      <input id={id} class="input" type="password" required autocomplete={autocomplete} value={value}
        minLength={id === 'pw-current' ? undefined : MIN_PASSWORD_LENGTH}
        onInput={(e) => set((e.target as HTMLInputElement).value)} />
    </div>
  );

  return (
    <section class="sheet">
      <h2>Смена пароля</h2>
      <form onSubmit={submit}>
        {field('pw-current', 'Текущий пароль', current, setCurrent, 'current-password')}
        {field('pw-new', `Новый пароль (не короче ${MIN_PASSWORD_LENGTH} символов)`, next, setNext, 'new-password')}
        {field('pw-repeat', 'Новый пароль ещё раз', repeat, setRepeat, 'new-password')}
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <button class="btn" disabled={busy}>Сменить пароль</button>
      </form>
    </section>
  );
}

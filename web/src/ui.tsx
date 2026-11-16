import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { Entry } from '../../shared/model';
import { FIELD_LABELS } from '../../shared/model';

/** Поле ввода, которое растёт вместе с текстом. */
export function AutoTextarea(props: {
  id: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  required?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      id={props.id}
      class="input"
      rows={props.minRows ?? 2}
      value={props.value}
      placeholder={props.placeholder}
      required={props.required}
      disabled={props.disabled}
      onInput={(e) => props.onInput((e.target as HTMLTextAreaElement).value)}
    />
  );
}

export function CategoryTag({ category }: { category: string | null }) {
  return category ? <span class="tag">{category}</span> : null;
}

/** Запись целиком — как страница бумажного дневника. */
export function EntryBody({ entry }: { entry: Entry }) {
  const rest = (['obstacle', 'how', 'lesson', 'goal_tomorrow'] as const).filter((k) => entry[k]);
  return (
    <div class="entry-body">
      <p class="entry-achievement">{entry.achievement}</p>
      {rest.map((k) => (
        <section key={k}>
          <h3 class="entry-label">{FIELD_LABELS[k]}</h3>
          <p class="entry-text">{entry[k]}</p>
        </section>
      ))}
    </div>
  );
}

export function Notice(props: { kind?: 'info' | 'error' | 'ok'; children: ComponentChildren }) {
  return (
    <p class={`notice notice-${props.kind ?? 'info'}`} role={props.kind === 'error' ? 'alert' : 'status'}>
      {props.children}
    </p>
  );
}

const paths: Record<string, JSX.Element> = {
  today: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />,
  history: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  remember: <path d="M12 3c.7 5 2.5 6.8 7.5 7.5-5 .7-6.8 2.5-7.5 7.5-.7-5-2.5-6.8-7.5-7.5C9.5 9.8 11.3 8 12 3zM19 16.5v4M17 18.5h4" />,
  settings: (
    <>
      <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h9M17 18h3" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="15" cy="18" r="2" />
    </>
  ),
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

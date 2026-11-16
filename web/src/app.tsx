import { useEffect, useState } from 'preact/hooks';
import { checkSession, setUnauthorizedHandler, syncSnapshot, useOffline } from './data';
import { type Route, useRoute } from './router';
import { EntryView } from './screens/EntryView';
import { History } from './screens/History';
import { Login } from './screens/Login';
import { Remember } from './screens/Remember';
import { Settings } from './screens/Settings';
import { Today } from './screens/Today';
import { Icon } from './ui';

type Auth = 'loading' | 'in' | 'out';

const TABS = [
  { href: '#/', icon: 'today', label: 'Сегодня', match: ['today'] },
  { href: '#/history', icon: 'history', label: 'История', match: ['history', 'entry'] },
  { href: '#/remember', icon: 'remember', label: 'Вспомни хорошее', match: ['remember'] },
  { href: '#/settings', icon: 'settings', label: 'Настройки', match: ['settings'] },
] as const;

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'today': return <Today key={route.date ?? 'today'} date={route.date} />;
    case 'history': return <History />;
    case 'entry': return <EntryView key={route.date} date={route.date} />;
    case 'remember': return <Remember />;
    case 'settings': return <Settings />;
  }
}

export function App() {
  const [auth, setAuth] = useState<Auth>('loading');
  const route = useRoute();
  const offline = useOffline();

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth('out'));
    void checkSession().then((s) => {
      setAuth(s === 'out' ? 'out' : 'in');
      if (s === 'in') void syncSnapshot();
    });
  }, []);

  if (auth === 'loading') return <div class="splash" aria-busy="true" />;
  if (auth === 'out') {
    return <Login onDone={() => { setAuth('in'); void syncSnapshot(); }} />;
  }

  return (
    <div class="shell">
      <nav class="nav" aria-label="Разделы">
        {TABS.map((t) => {
          const active = (t.match as readonly string[]).includes(route.name);
          return (
            <a key={t.href} href={t.href} class={`nav-item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </a>
          );
        })}
      </nav>
      <main class="main">
        {offline && (
          <p class="offline-bar" role="status">
            Нет связи с сервером. Показаны записи, сохранённые на устройстве; черновики не пропадут.
          </p>
        )}
        <Screen route={route} />
      </main>
    </div>
  );
}

import { useEffect, useState } from 'preact/hooks';
import { isValidDate } from './dates';

export type Route =
  | { name: 'today'; date: string | null }
  | { name: 'history' }
  | { name: 'entry'; date: string }
  | { name: 'remember' }
  | { name: 'settings' };

function parse(hash: string): Route {
  const [, name, arg] = hash.replace(/^#/, '').split('/');
  if (name === 'day' && isValidDate(arg)) return { name: 'today', date: arg };
  if (name === 'entry' && isValidDate(arg)) return { name: 'entry', date: arg };
  if (name === 'history' || name === 'remember' || name === 'settings') return { name };
  return { name: 'today', date: null };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parse(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(hash: string): void {
  location.hash = hash;
}

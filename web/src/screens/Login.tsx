import { useState } from 'preact/hooks';
import { login } from '../data';
import { Notice } from '../ui';

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div class="login">
      <form class="login-card" onSubmit={submit}>
        <img src="/icons/icon.svg" alt="" width="64" height="64" class="login-logo" />
        <h1>Дневник достижений</h1>
        <label class="label" for="password">Пароль</label>
        <input id="password" class="input" type="password" autocomplete="current-password" autofocus
          required value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        {error && <Notice kind="error">{error}</Notice>}
        <button class="btn btn-primary btn-wide" disabled={busy}>Войти</button>
      </form>
    </div>
  );
}

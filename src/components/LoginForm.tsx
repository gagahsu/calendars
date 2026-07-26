'use client';

import { useState } from 'react';
import { post } from '@/lib/client';

export default function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/login', { password });
      // Full navigation so the server layout re-reads the fresh cookie.
      window.location.href = '/';
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登入失敗');
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <form className="card" style={{ width: '100%', maxWidth: 360 }} onSubmit={submit}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: '2.4rem', lineHeight: 1 }} aria-hidden>
            🗓
          </div>
          <h1 style={{ fontSize: '1.15rem', marginTop: 8 }}>行事曆助理</h1>
          <p className="small muted">信用卡繳費提醒 · 待辦 · AI 消費分析</p>
        </div>

        <label className="field" htmlFor="password">
          密碼
        </label>
        <input
          id="password"
          type="password"
          value={password}
          autoComplete="current-password"
          autoFocus
          onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          placeholder="請輸入密碼"
        />

        {error && (
          <div className="alert danger" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <button
          className="btn primary block"
          style={{ marginTop: 14 }}
          type="submit"
          disabled={busy || password.length === 0}
        >
          {busy ? <span className="spinner" /> : '登入'}
        </button>
      </form>
    </main>
  );
}

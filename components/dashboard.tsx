'use client';

import { FormEvent, useEffect, useState } from 'react';

export default function Dashboard() {
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = window.sessionStorage.getItem('naka_token');
    if (saved) setToken(saved);
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const cleanSecret = secret.trim();
    if (!cleanSecret) {
      setError('Admin secret wajib diisi.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/admin-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: cleanSecret }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.token) {
        throw new Error(result.error || 'Login gagal. Periksa ADMIN_SECRET.');
      }

      window.sessionStorage.setItem('naka_token', result.token);
      setToken(result.token);
      setSecret('');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login gagal.');
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    window.sessionStorage.removeItem('naka_token');
    setToken('');
  }

  if (!token) {
    return (
      <main className="login-page">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="logo">N</div>
          <p className="eyebrow">NAKA LICENSE CLOUD</p>
          <h1>Admin Login</h1>
          <p className="description">Masukkan ADMIN_SECRET untuk membuka dashboard.</p>

          <label htmlFor="admin-secret">Admin secret</label>
          <input
            id="admin-secret"
            name="admin-secret"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="Masukkan ADMIN_SECRET"
            autoComplete="current-password"
            autoFocus
          />

          <button type="submit" disabled={loading}>
            {loading ? 'Memverifikasi…' : 'Masuk'}
          </button>

          {error ? <p className="error" role="alert">{error}</p> : null}
        </form>
      </main>
    );
  }

  return (
    <main className="dashboard-page">
      <section className="dashboard-card">
        <div>
          <p className="eyebrow">NAKA LICENSE CLOUD</p>
          <h1>Dashboard berhasil dibuka</h1>
          <p className="description">Login dan penyimpanan sesi sudah bekerja.</p>
        </div>
        <button className="logout-button" type="button" onClick={logout}>Keluar</button>
      </section>
    </main>
  );
}

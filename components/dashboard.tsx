'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, Copy, KeyRound, LayoutDashboard,
  Loader2, LogOut, Plus, RefreshCw, RotateCcw, Search, ShieldAlert,
  ShieldCheck, Trash2, Users, X, Pencil, Server, Ban
} from 'lucide-react';

type LicenseRow = {
  record_type: 'license'; owner_id: string; owner_type: 'User' | 'Group'; product: string;
  status: 'active' | 'pending' | 'suspended' | 'revoked'; expires_at?: string | null;
  universe_id_bound?: string | null; activated_at?: string | null; created_at?: string | null;
  ever_connected?: boolean; place_id?: string | null; universe_id?: string | null;
  place_name?: string | null; game_name?: string | null; player_count?: number | null;
  max_players?: number | null; is_private_server?: boolean; is_studio?: boolean;
  system_version?: string | null; first_seen_at?: string | null; last_seen_at?: string | null;
};

type AttemptRow = {
  record_type: 'unauthorized'; owner_id?: string | null; owner_type?: string | null;
  product?: string | null; place_id?: string | null; universe_id?: string | null;
  place_name?: string | null; game_name?: string | null; system_version?: string | null;
  reason?: string | null; ip_address?: string | null; attempted_at?: string | null;
  last_seen_at?: string | null; source?: string | null;
};

type ApiData = { licenses: LicenseRow[]; unauthorized: AttemptRow[]; warnings?: { code: string; message: string }[] };
type Tab = 'overview' | 'licenses' | 'unauthorized';

type FormState = {
  ownerId: string; ownerType: 'User' | 'Group'; product: string; licenseKey: string;
  status: LicenseRow['status']; universeId: string; expiresAt: string;
};

const EMPTY_FORM: FormState = {
  ownerId: '', ownerType: 'User', product: 'NAKA_SYSTEM', licenseKey: '',
  status: 'active', universeId: '', expiresAt: ''
};

const statusLabel: Record<LicenseRow['status'], string> = {
  active: 'Aktif', pending: 'Menunggu', suspended: 'Ditangguhkan', revoked: 'Dicabut'
};

function fmt(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(date);
}

function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const raw = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `NAKA-${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16, 24)}-${raw.slice(24, 32)}`;
}

export default function Dashboard() {
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [data, setData] = useState<ApiData>({ licenses: [], unauthorized: [], warnings: [] });
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [selected, setSelected] = useState<LicenseRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    const saved = window.sessionStorage.getItem('naka_token');
    if (saved) setToken(saved);
  }, []);

  const api = useCallback(async (options: RequestInit = {}) => {
    const response = await fetch('/api/licenses', {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.sessionStorage.removeItem('naka_token');
      setToken('');
      throw new Error('Sesi berakhir. Silakan masuk kembali.');
    }
    if (!response.ok) throw new Error(result.error || result.detail || 'Permintaan gagal.');
    return result;
  }, [token]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError('');
    try { setData(await api()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal memuat data.'); }
    finally { setLoading(false); }
  }, [api, token]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoginLoading(true);
    try {
      const response = await fetch('/api/admin-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret.trim() })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.token) throw new Error(result.error || 'Login gagal.');
      window.sessionStorage.setItem('naka_token', result.token);
      setToken(result.token); setSecret('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Login gagal.'); }
    finally { setLoginLoading(false); }
  }

  function logout() {
    window.sessionStorage.removeItem('naka_token'); setToken(''); setData({ licenses: [], unauthorized: [] });
  }

  const uniqueLicenses = useMemo(() => {
    const map = new Map<string, LicenseRow>();
    for (const row of data.licenses) {
      const key = `${row.owner_id}:${row.owner_type}:${row.product}`;
      const current = map.get(key);
      if (!current || (!current.ever_connected && row.ever_connected)) map.set(key, row);
    }
    return [...map.values()];
  }, [data.licenses]);

  const filtered = useMemo(() => uniqueLicenses.filter(row => {
    const haystack = `${row.owner_id} ${row.owner_type} ${row.product} ${row.place_name || ''} ${row.universe_id_bound || ''}`.toLowerCase();
    return (status === 'all' || row.status === status) && haystack.includes(query.toLowerCase());
  }), [uniqueLicenses, query, status]);

  const stats = useMemo(() => ({
    total: uniqueLicenses.length,
    active: uniqueLicenses.filter(x => x.status === 'active').length,
    connected: uniqueLicenses.filter(x => x.ever_connected).length,
    unauthorized: data.unauthorized.length
  }), [uniqueLicenses, data.unauthorized]);

  function openCreate() {
    setSelected(null); setForm({ ...EMPTY_FORM, licenseKey: generateKey() }); setModal('create');
  }

  function openEdit(row: LicenseRow) {
    setSelected(row);
    setForm({
      ownerId: row.owner_id, ownerType: row.owner_type, product: row.product,
      licenseKey: '', status: row.status, universeId: row.universe_id_bound || '',
      expiresAt: row.expires_at ? row.expires_at.slice(0, 10) : ''
    });
    setModal('edit');
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        ownerId: form.ownerId.trim(), ownerType: form.ownerType,
        product: form.product.trim(), status: form.status,
        universeId: form.universeId.trim() || null
      };
      if (form.licenseKey.trim()) body.licenseKey = form.licenseKey.trim();
      if (modal === 'create') body.expiresAt = form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null;
      await api({ method: modal === 'create' ? 'POST' : 'PATCH', body: JSON.stringify(body) });
      setModal(null); setNotice(modal === 'create' ? 'Lisensi berhasil dibuat.' : 'Lisensi berhasil diperbarui.');
      await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal menyimpan.'); }
    finally { setSaving(false); setTimeout(() => setNotice(''), 3000); }
  }

  async function remove(row: LicenseRow) {
    if (!confirm(`Hapus lisensi ${row.owner_id} / ${row.product}? Tindakan ini tidak dapat dibatalkan.`)) return;
    setSaving(true); setError('');
    try {
      await api({ method: 'DELETE', body: JSON.stringify({ ownerId: row.owner_id, ownerType: row.owner_type, product: row.product }) });
      setNotice('Lisensi berhasil dihapus.'); await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal menghapus.'); }
    finally { setSaving(false); setTimeout(() => setNotice(''), 3000); }
  }

  async function resetUniverse(row: LicenseRow) {
    if (!confirm(`Reset binding Universe untuk ${row.owner_id}?`)) return;
    setSaving(true); setError('');
    try {
      await api({ method: 'PATCH', body: JSON.stringify({ ownerId: row.owner_id, ownerType: row.owner_type, product: row.product, resetUniverse: true }) });
      setNotice('Binding Universe berhasil direset.'); await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal mereset Universe.'); }
    finally { setSaving(false); setTimeout(() => setNotice(''), 3000); }
  }

  if (!token) return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleLogin}>
        <div className="brand-mark"><ShieldCheck size={25} /></div>
        <p className="eyebrow">NAKA LICENSE CLOUD</p>
        <h1>Admin Login</h1>
        <p className="description">Kelola lisensi, instalasi, dan keamanan seluruh produk NAKA dari satu dashboard.</p>
        <label htmlFor="admin-secret">Admin secret</label>
        <input id="admin-secret" type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Masukkan ADMIN_SECRET" autoComplete="current-password" autoFocus />
        <button className="primary-button login-button" type="submit" disabled={loginLoading || !secret.trim()}>
          {loginLoading ? <><Loader2 className="spin" size={18} /> Memverifikasi…</> : <><KeyRound size={18} /> Masuk ke Dashboard</>}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark small"><ShieldCheck size={20} /></div><div><strong>NAKA</strong><span>LICENSE CLOUD</span></div></div>
        <nav>
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><LayoutDashboard size={18} /> Ringkasan</button>
          <button className={tab === 'licenses' ? 'active' : ''} onClick={() => setTab('licenses')}><KeyRound size={18} /> Lisensi <em>{stats.total}</em></button>
          <button className={tab === 'unauthorized' ? 'active' : ''} onClick={() => setTab('unauthorized')}><ShieldAlert size={18} /> Akses Ditolak <em>{stats.unauthorized}</em></button>
        </nav>
        <div className="sidebar-footer"><button onClick={logout}><LogOut size={18} /> Keluar</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">CONTROL CENTER</p><h1>{tab === 'overview' ? 'Ringkasan Sistem' : tab === 'licenses' ? 'Manajemen Lisensi' : 'Log Akses Ditolak'}</h1></div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={loadData} disabled={loading} title="Muat ulang"><RefreshCw className={loading ? 'spin' : ''} size={18} /></button>
            <button className="primary-button" onClick={openCreate}><Plus size={18} /> Tambah Lisensi</button>
          </div>
        </header>

        {error && <div className="banner error-banner"><AlertTriangle size={18} /><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
        {notice && <div className="banner success-banner"><CheckCircle2 size={18} /><span>{notice}</span></div>}
        {!!data.warnings?.length && <div className="banner warning-banner"><AlertTriangle size={18} /><span>{data.warnings.map(w => w.message).join(' · ')}</span></div>}

        {tab === 'overview' && <>
          <div className="stats-grid">
            <Stat icon={<KeyRound />} label="Total Lisensi" value={stats.total} sub="Semua produk" />
            <Stat icon={<ShieldCheck />} label="Lisensi Aktif" value={stats.active} sub={`${stats.total ? Math.round(stats.active / stats.total * 100) : 0}% dari total`} />
            <Stat icon={<Server />} label="Pernah Terhubung" value={stats.connected} sub="Instalasi terdeteksi" />
            <Stat icon={<ShieldAlert />} label="Akses Ditolak" value={stats.unauthorized} sub="Perlu ditinjau" danger={stats.unauthorized > 0} />
          </div>
          <section className="panel">
            <div className="panel-head"><div><h2>Lisensi Terbaru</h2><p>Status lisensi dan koneksi terakhir.</p></div><button className="text-button" onClick={() => setTab('licenses')}>Lihat semua</button></div>
            <LicenseTable rows={uniqueLicenses.slice(0, 6)} loading={loading} onEdit={openEdit} onReset={resetUniverse} onDelete={remove} />
          </section>
        </>}

        {tab === 'licenses' && <section className="panel">
          <div className="toolbar">
            <div className="search-box"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari Owner ID, produk, game, Universe…" /></div>
            <select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Semua status</option><option value="active">Aktif</option><option value="pending">Menunggu</option><option value="suspended">Ditangguhkan</option><option value="revoked">Dicabut</option></select>
          </div>
          <LicenseTable rows={filtered} loading={loading} onEdit={openEdit} onReset={resetUniverse} onDelete={remove} />
        </section>}

        {tab === 'unauthorized' && <section className="panel">
          <div className="panel-head"><div><h2>Aktivitas Tanpa Lisensi</h2><p>Upaya penggunaan sistem yang tidak memiliki lisensi valid.</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>Waktu</th><th>Owner</th><th>Produk</th><th>Game / Place</th><th>Universe</th><th>Alasan</th><th>IP</th></tr></thead><tbody>
            {data.unauthorized.map((row, i) => <tr key={`${row.owner_id}-${row.attempted_at}-${i}`}><td>{fmt(row.attempted_at || row.last_seen_at)}</td><td><strong>{row.owner_id || '—'}</strong><small>{row.owner_type || '—'}</small></td><td>{row.product || '—'}</td><td><strong>{row.game_name || row.place_name || '—'}</strong><small>{row.place_id || '—'}</small></td><td>{row.universe_id || '—'}</td><td><span className="status revoked">{row.reason || 'UNAUTHORIZED'}</span></td><td>{row.ip_address || '—'}</td></tr>)}
            {!data.unauthorized.length && <EmptyRow cols={7} text="Belum ada aktivitas tanpa izin." />}
          </tbody></table></div>
        </section>}
      </section>

      {modal && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setModal(null)}>
        <form className="modal" onSubmit={submitForm}>
          <div className="modal-head"><div><p className="eyebrow">{modal === 'create' ? 'LISENSI BARU' : 'PERBARUI LISENSI'}</p><h2>{modal === 'create' ? 'Tambah Lisensi' : `${selected?.owner_id} · ${selected?.product}`}</h2></div><button type="button" className="icon-button" onClick={() => setModal(null)}><X size={19} /></button></div>
          <div className="form-grid">
            <Field label="Owner ID"><input required pattern="[0-9]+" value={form.ownerId} disabled={modal === 'edit'} onChange={e => setForm({ ...form, ownerId: e.target.value })} placeholder="Contoh: 123456789" /></Field>
            <Field label="Owner Type"><select value={form.ownerType} disabled={modal === 'edit'} onChange={e => setForm({ ...form, ownerType: e.target.value as 'User' | 'Group' })}><option value="User">User</option><option value="Group">Group</option></select></Field>
            <Field label="Produk"><input required value={form.product} disabled={modal === 'edit'} onChange={e => setForm({ ...form, product: e.target.value })} placeholder="NAKA_SYSTEM" /></Field>
            <Field label="Status"><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as LicenseRow['status'] })}><option value="active">Aktif</option><option value="pending">Menunggu</option><option value="suspended">Ditangguhkan</option><option value="revoked">Dicabut</option></select></Field>
            <Field label={modal === 'create' ? 'License Key' : 'License Key Baru (opsional)'} wide><div className="input-action"><input required={modal === 'create'} minLength={16} value={form.licenseKey} onChange={e => setForm({ ...form, licenseKey: e.target.value })} placeholder="Minimal 16 karakter" /><button type="button" onClick={() => setForm({ ...form, licenseKey: generateKey() })}>Generate</button></div></Field>
            <Field label="Universe ID (opsional)"><input pattern="[0-9]*" value={form.universeId} onChange={e => setForm({ ...form, universeId: e.target.value })} placeholder="Kosong = bind saat aktivasi" /></Field>
            {modal === 'create' && <Field label="Kedaluwarsa (opsional)"><input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} /></Field>}
          </div>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Batal</button><button className="primary-button" disabled={saving}>{saving ? <><Loader2 className="spin" size={17} /> Menyimpan…</> : modal === 'create' ? 'Buat Lisensi' : 'Simpan Perubahan'}</button></div>
        </form>
      </div>}
    </main>
  );
}

function Stat({ icon, label, value, sub, danger = false }: { icon: React.ReactNode; label: string; value: number; sub: string; danger?: boolean }) {
  return <article className={`stat-card ${danger ? 'danger' : ''}`}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div></article>;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>;
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return <tr><td colSpan={cols}><div className="empty"><Activity size={28} /><strong>{text}</strong><span>Data akan muncul otomatis ketika tersedia.</span></div></td></tr>;
}

function LicenseTable({ rows, loading, onEdit, onReset, onDelete }: { rows: LicenseRow[]; loading: boolean; onEdit: (r: LicenseRow) => void; onReset: (r: LicenseRow) => void; onDelete: (r: LicenseRow) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Owner</th><th>Produk</th><th>Status</th><th>Universe</th><th>Instalasi</th><th>Terakhir Terlihat</th><th>Aksi</th></tr></thead><tbody>
    {rows.map(row => <tr key={`${row.owner_id}:${row.owner_type}:${row.product}`}><td><strong>{row.owner_id}</strong><small>{row.owner_type}</small></td><td><strong>{row.product}</strong><small>Dibuat {fmt(row.created_at)}</small></td><td><span className={`status ${row.status}`}>{statusLabel[row.status]}</span></td><td><strong>{row.universe_id_bound || 'Belum terikat'}</strong><small>{row.activated_at ? `Aktif ${fmt(row.activated_at)}` : 'Menunggu aktivasi'}</small></td><td><strong>{row.ever_connected ? row.game_name || row.place_name || 'Terhubung' : 'Belum terhubung'}</strong><small>{row.place_id || row.system_version || '—'}</small></td><td>{fmt(row.last_seen_at)}</td><td><div className="row-actions"><button title="Edit" onClick={() => onEdit(row)}><Pencil size={16} /></button><button title="Reset Universe" onClick={() => onReset(row)}><RotateCcw size={16} /></button><button className="danger-action" title="Hapus" onClick={() => onDelete(row)}><Trash2 size={16} /></button></div></td></tr>)}
    {!rows.length && !loading && <EmptyRow cols={7} text="Belum ada lisensi." />}
    {loading && <tr><td colSpan={7}><div className="empty"><Loader2 className="spin" size={28} /><strong>Memuat data…</strong></div></td></tr>}
  </tbody></table></div>;
}

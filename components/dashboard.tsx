'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { toCsv } from '../lib/csv';
import {
  Activity, AlertTriangle, Bell, CheckCircle2, Download, KeyRound, LayoutDashboard,
  Eye, Loader2, LogOut, Plus, RefreshCw, ScrollText, Search, ShieldAlert,
  ShieldCheck, Trash2, X, Pencil, Server
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

type AuditRow = {
  id: number; action: string; target_type?: string | null; target_id?: string | null;
  actor_ip?: string | null; actor_label?: string | null; created_at?: string | null;
};

type Notification = { level: 'warning' | 'danger'; title: string; detail: string };
type ExportKind = 'licenses' | 'installations' | 'unauthorized' | 'audits';

type ApiData = {
  licenses: LicenseRow[]; unauthorized: AttemptRow[]; audits: AuditRow[];
  warnings?: { code: string; message: string }[];
};
type Tab = 'overview' | 'licenses' | 'unauthorized' | 'audit';

type FormState = {
  ownerId: string; ownerType: 'User' | 'Group'; product: string; licenseKey: string;
  status: LicenseRow['status']; expiresAt: string;
};

const EMPTY_FORM: FormState = {
  ownerId: '', ownerType: 'User', product: 'kit-naka', licenseKey: '',
  status: 'active', expiresAt: ''
};

const statusLabel: Record<LicenseRow['status'], string> = {
  active: 'Aktif', pending: 'Menunggu', suspended: 'Ditangguhkan', revoked: 'Dicabut'
};

const tabTitle: Record<Tab, string> = {
  overview: 'Ringkasan Sistem',
  licenses: 'Manajemen Lisensi',
  unauthorized: 'Log Akses Ditolak',
  audit: 'Audit Log'
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
  const [data, setData] = useState<ApiData>({ licenses: [], unauthorized: [], audits: [], warnings: [] });
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [detail, setDetail] = useState<LicenseRow | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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

  useEffect(() => {
    if (!modal && !detail && !notificationsOpen && !exportOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModal(null);
        setDetail(null);
        setNotificationsOpen(false);
        setExportOpen(false);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [modal, detail, notificationsOpen, exportOpen]);

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
    window.sessionStorage.removeItem('naka_token'); setToken(''); setData({ licenses: [], unauthorized: [], audits: [] });
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
    const haystack = `${row.owner_id} ${row.owner_type} ${row.product} ${row.place_name || ''} ${row.universe_id || ''}`.toLowerCase();
    return (status === 'all' || row.status === status) && haystack.includes(query.toLowerCase());
  }), [uniqueLicenses, query, status]);

  const detailInstallations = useMemo(() => detail ? data.licenses.filter(row =>
    row.ever_connected && row.owner_id === detail.owner_id
    && row.owner_type === detail.owner_type && row.product === detail.product
  ) : [], [data.licenses, detail]);

  const stats = useMemo(() => ({
    total: uniqueLicenses.length,
    active: uniqueLicenses.filter(x => x.status === 'active').length,
    connected: uniqueLicenses.filter(x => x.ever_connected).length,
    unauthorized: data.unauthorized.length
  }), [uniqueLicenses, data.unauthorized]);

  const notifications = useMemo(() => {
    const items: Notification[] = [];
    const now = Date.now();

    for (const row of uniqueLicenses) {
      if (row.status === 'revoked' || row.status === 'suspended') {
        items.push({ level: 'danger', title: `Lisensi ${statusLabel[row.status]}`, detail: `${row.owner_id} · ${row.product}` });
      }
      if (!row.expires_at) continue;
      const remaining = new Date(row.expires_at).getTime() - now;
      const days = Math.ceil(remaining / 86_400_000);
      if (remaining <= 0) items.push({ level: 'danger', title: 'Lisensi kedaluwarsa', detail: `${row.owner_id} · ${row.product}` });
      else if (days <= 7) items.push({ level: 'warning', title: `Kedaluwarsa ${days} hari lagi`, detail: `${row.owner_id} · ${row.product}` });
    }

    const deniedToday = data.unauthorized.filter(row => {
      const time = new Date(row.attempted_at || row.last_seen_at || 0).getTime();
      return time >= now - 86_400_000;
    }).length;
    if (deniedToday) items.unshift({ level: 'danger', title: `${deniedToday} akses ditolak dalam 24 jam`, detail: 'Periksa tab Akses Ditolak.' });
    return items;
  }, [uniqueLicenses, data.unauthorized]);

  function exportCsv(kind: ExportKind) {
    const rows: Record<string, unknown>[] = kind === 'licenses'
      ? uniqueLicenses.map(row => ({
        owner_id: row.owner_id, owner_type: row.owner_type, product: row.product,
        status: row.status, expires_at: row.expires_at, created_at: row.created_at
      }))
      : kind === 'installations'
        ? data.licenses.filter(row => row.ever_connected).map(row => ({
          owner_id: row.owner_id, owner_type: row.owner_type, product: row.product,
          game_name: row.game_name, place_id: row.place_id, universe_id: row.universe_id,
          players: row.player_count, max_players: row.max_players,
          mode: row.is_studio ? 'Studio' : row.is_private_server ? 'Private' : 'Public',
          system_version: row.system_version, first_seen_at: row.first_seen_at, last_seen_at: row.last_seen_at
        }))
        : kind === 'unauthorized'
          ? data.unauthorized.map(row => ({
            attempted_at: row.attempted_at || row.last_seen_at, owner_id: row.owner_id,
            owner_type: row.owner_type, product: row.product, game_name: row.game_name || row.place_name,
            place_id: row.place_id, universe_id: row.universe_id, reason: row.reason, ip_address: row.ip_address
          }))
          : data.audits.map(row => ({
            created_at: row.created_at, action: row.action, target_type: row.target_type,
            target_id: row.target_id, actor_label: row.actor_label, actor_ip: row.actor_ip
          }));

    const csv = toCsv(rows);
    if (!csv) {
      setNotice('Tidak ada data untuk diekspor.');
    } else {
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `naka-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice('File CSV berhasil diunduh.');
    }
    setExportOpen(false);
    setTimeout(() => setNotice(''), 3000);
  }

  function openCreate() {
    setSelected(null); setForm({ ...EMPTY_FORM }); setModal('create');
  }

  function openEdit(row: LicenseRow) {
    setSelected(row);
    setForm({
      ownerId: row.owner_id, ownerType: row.owner_type, product: row.product,
      licenseKey: '', status: row.status,
      expiresAt: row.expires_at ? row.expires_at.slice(0, 10) : ''
    });
    setModal('edit');
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        ownerId: form.ownerId.trim(), ownerType: form.ownerType,
        product: form.product.trim(), status: form.status
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
          <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}><ScrollText size={18} /> Audit Log <em>{data.audits.length}</em></button>
        </nav>
        <div className="sidebar-footer"><button onClick={logout}><LogOut size={18} /> Keluar</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">CONTROL CENTER</p><h1>{tabTitle[tab]}</h1></div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={loadData} disabled={loading} title="Muat ulang"><RefreshCw className={loading ? 'spin' : ''} size={18} /></button>
            <div className="action-menu">
              <button className="icon-button" aria-label="Notifikasi" aria-haspopup="dialog" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen(value => !value); setExportOpen(false); }}><Bell size={18} />{!!notifications.length && <span className="notification-count">{Math.min(99, notifications.length)}</span>}</button>
              {notificationsOpen && <div className="action-popover notification-popover" role="dialog" aria-label="Notifikasi">
                <div className="popover-head"><strong>Notifikasi</strong><span>{notifications.length}</span></div>
                <div className="notification-list">
                  {notifications.map((item, index) => <article className={item.level} key={`${item.title}:${index}`}><AlertTriangle size={16} /><div><strong>{item.title}</strong><small>{item.detail}</small></div></article>)}
                  {!notifications.length && <div className="popover-empty"><CheckCircle2 size={20} /><span>Semua aman.</span></div>}
                </div>
              </div>}
            </div>
            <div className="action-menu">
              <button className="icon-button" aria-label="Export CSV" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => { setExportOpen(value => !value); setNotificationsOpen(false); }}><Download size={18} /></button>
              {exportOpen && <div className="action-popover export-popover" role="menu">
                <div className="popover-head"><strong>Export CSV</strong></div>
                <button role="menuitem" onClick={() => exportCsv('licenses')}>Lisensi</button>
                <button role="menuitem" onClick={() => exportCsv('installations')}>Instalasi</button>
                <button role="menuitem" onClick={() => exportCsv('unauthorized')}>Akses ditolak</button>
                <button role="menuitem" onClick={() => exportCsv('audits')}>Audit log</button>
              </div>}
            </div>
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
            <LicenseTable rows={uniqueLicenses.slice(0, 6)} loading={loading} onDetail={setDetail} onEdit={openEdit} onDelete={remove} />
          </section>
        </>}

        {tab === 'licenses' && <section className="panel">
          <div className="toolbar">
            <div className="search-box"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari Owner ID, produk, game, Universe…" /></div>
            <select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Semua status</option><option value="active">Aktif</option><option value="pending">Menunggu</option><option value="suspended">Ditangguhkan</option><option value="revoked">Dicabut</option></select>
          </div>
          <LicenseTable rows={filtered} loading={loading} onDetail={setDetail} onEdit={openEdit} onDelete={remove} />
        </section>}

        {tab === 'unauthorized' && <section className="panel">
          <div className="panel-head"><div><h2>Aktivitas Tanpa Lisensi</h2><p>Upaya penggunaan sistem yang tidak memiliki lisensi valid.</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>Waktu</th><th>Owner</th><th>Produk</th><th>Game / Place</th><th>Universe</th><th>Alasan</th><th>IP</th></tr></thead><tbody>
            {data.unauthorized.map((row, i) => <tr key={`${row.owner_id}-${row.attempted_at}-${i}`}><td>{fmt(row.attempted_at || row.last_seen_at)}</td><td><strong>{row.owner_id || '—'}</strong><small>{row.owner_type || '—'}</small></td><td>{row.product || '—'}</td><td><strong>{row.game_name || row.place_name || '—'}</strong><small><RobloxId id={row.place_id} kind="place" /></small></td><td><RobloxId id={row.universe_id} kind="universe" /></td><td><span className="status revoked">{row.reason || 'UNAUTHORIZED'}</span></td><td>{row.ip_address || '—'}</td></tr>)}
            {!data.unauthorized.length && <EmptyRow cols={7} text="Belum ada aktivitas tanpa izin." />}
          </tbody></table></div>
        </section>}

        {tab === 'audit' && <section className="panel">
          <div className="panel-head"><div><h2>Riwayat Aktivitas Admin</h2><p>Login dan perubahan lisensi terbaru, maksimal 300 aktivitas.</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>Waktu</th><th>Aktivitas</th><th>Target</th><th>Admin</th><th>IP</th></tr></thead><tbody>
            {data.audits.map(row => <tr key={row.id}><td>{fmt(row.created_at)}</td><td><span className="status pending">{row.action}</span></td><td><strong>{row.target_id || '—'}</strong><small>{row.target_type || 'sistem'}</small></td><td>{row.actor_label || 'admin'}</td><td>{row.actor_ip || '—'}</td></tr>)}
            {!data.audits.length && !loading && <EmptyRow cols={5} text="Belum ada aktivitas admin." />}
            {loading && <tr><td colSpan={5}><div className="empty"><Loader2 className="spin" size={28} /><strong>Memuat audit log…</strong></div></td></tr>}
          </tbody></table></div>
        </section>}
      </section>

      {modal && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setModal(null)}>
        <form className="modal" onSubmit={submitForm}>
          <div className="modal-head"><div><p className="eyebrow">{modal === 'create' ? 'LISENSI BARU' : 'PERBARUI LISENSI'}</p><h2>{modal === 'create' ? 'Tambah Lisensi' : `${selected?.owner_id} · ${selected?.product}`}</h2></div><button type="button" className="icon-button" aria-label="Tutup formulir" onClick={() => setModal(null)}><X size={19} /></button></div>
          <div className="form-grid">
            <Field label="Owner ID"><input required pattern="[0-9]+" value={form.ownerId} disabled={modal === 'edit'} onChange={e => setForm({ ...form, ownerId: e.target.value })} placeholder="Contoh: 123456789" /></Field>
            <Field label="Owner Type"><select value={form.ownerType} disabled={modal === 'edit'} onChange={e => setForm({ ...form, ownerType: e.target.value as 'User' | 'Group' })}><option value="User">User</option><option value="Group">Group</option></select></Field>
            <Field label="Produk"><input required value={form.product} disabled={modal === 'edit'} onChange={e => setForm({ ...form, product: e.target.value })} placeholder="kit-naka" /></Field>
            <Field label="Status"><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as LicenseRow['status'] })}><option value="active">Aktif</option><option value="pending">Menunggu</option><option value="suspended">Ditangguhkan</option><option value="revoked">Dicabut</option></select></Field>
            {modal !== 'create' && <Field label="License Key Baru (opsional)" wide><div className="input-action"><input minLength={16} value={form.licenseKey} onChange={e => setForm({ ...form, licenseKey: e.target.value })} placeholder="Kosongkan untuk mempertahankan key" /><button type="button" onClick={() => setForm({ ...form, licenseKey: generateKey() })}>Generate</button></div></Field>}
            {modal === 'create' && <Field label="Kedaluwarsa (opsional)"><input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} /></Field>}
          </div>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Batal</button><button className="primary-button" disabled={saving}>{saving ? <><Loader2 className="spin" size={17} /> Menyimpan…</> : modal === 'create' ? 'Buat Lisensi' : 'Simpan Perubahan'}</button></div>
        </form>
      </div>}

      {detail && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setDetail(null)}>
        <section className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="license-detail-title">
          <div className="modal-head"><div><p className="eyebrow">DETAIL LISENSI</p><h2 id="license-detail-title">{detail.owner_id} · {detail.product}</h2></div><button type="button" className="icon-button" aria-label="Tutup detail" onClick={() => setDetail(null)}><X size={19} /></button></div>
          <div className="detail-summary">
            <article><span>Status</span><strong className={`status ${detail.status}`}>{statusLabel[detail.status]}</strong></article>
            <article><span>Total instalasi</span><strong>{detailInstallations.length}</strong></article>
            <article><span>Total universe</span><strong>{new Set(detailInstallations.map(row => row.universe_id).filter(Boolean)).size}</strong></article>
          </div>
          <div className="table-wrap detail-table"><table><thead><tr><th>Game / Place</th><th>Universe</th><th>Players</th><th>Mode</th><th>Versi</th><th>Terakhir Terlihat</th></tr></thead><tbody>
            {detailInstallations.map((row, index) => <tr key={`${row.place_id}:${row.universe_id}:${index}`}><td><strong>{row.game_name || row.place_name || 'Tanpa nama'}</strong><small><RobloxId id={row.place_id} kind="place" /></small></td><td><RobloxId id={row.universe_id} kind="universe" /></td><td>{row.player_count ?? '—'} / {row.max_players ?? '—'}</td><td>{row.is_studio ? 'Studio' : row.is_private_server ? 'Private' : 'Public'}</td><td>{row.system_version || '—'}</td><td>{fmt(row.last_seen_at)}</td></tr>)}
            {!detailInstallations.length && <EmptyRow cols={6} text="Belum ada instalasi untuk lisensi ini." />}
          </tbody></table></div>
        </section>
      </div>}
      <style jsx global>{`
        .detail-modal{width:min(1040px,100%)}
        .detail-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}
        .detail-summary article{padding:14px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.035)}
        .detail-summary span,.detail-summary strong{display:block}
        .detail-summary span{margin-bottom:7px;color:var(--muted);font-size:11px}
        .detail-summary strong:not(.status){font-size:20px}
        .detail-table{border:1px solid var(--line);border-radius:12px}
        .detail-table table{min-width:760px}
        .action-menu{position:relative}
        .notification-count{position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;display:grid;place-items:center;padding:0 5px;border:2px solid var(--panel);border-radius:999px;background:var(--danger);font-size:9px;font-weight:850}
        .action-popover{position:absolute;z-index:60;top:51px;right:0;width:min(360px,calc(100vw - 36px));overflow:hidden;border:1px solid var(--line);border-radius:14px;background:#0b1426;box-shadow:0 24px 70px rgba(0,0,0,.55)}
        .popover-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line)}
        .popover-head span{min-width:24px;padding:3px 7px;border-radius:999px;background:rgba(255,255,255,.08);font-size:10px;text-align:center}
        .notification-list{max-height:360px;overflow:auto}
        .notification-list article{display:flex;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line)}
        .notification-list article.warning{color:var(--warning)}
        .notification-list article.danger{color:var(--danger)}
        .notification-list article div{min-width:0}
        .notification-list article strong,.notification-list article small{display:block}
        .notification-list article strong{font-size:12px}
        .notification-list article small{margin-top:4px;color:var(--muted);font-size:10px}
        .popover-empty{display:flex;align-items:center;justify-content:center;gap:8px;padding:28px;color:var(--success);font-size:12px}
        .export-popover{width:210px;padding:7px}
        .export-popover .popover-head{margin:-7px -7px 5px}
        .export-popover>button{width:100%;padding:10px 11px;border-radius:8px;background:transparent;color:#cbd5e5;text-align:left}
        .export-popover>button:hover{background:rgba(79,140,255,.13);color:#fff}
        .id-link{color:#8fb5ff;text-decoration:none}
        .id-link:hover{text-decoration:underline}
        @media(max-width:760px){.sidebar nav{grid-template-columns:repeat(4,1fr)}}
        @media(max-width:480px){.detail-summary{grid-template-columns:1fr}.topbar{flex-wrap:wrap}.topbar-actions{width:100%;justify-content:flex-end}.action-popover{position:fixed;top:150px;right:18px}}
      `}</style>
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

function RobloxId({ id, kind }: { id?: string | null; kind: 'place' | 'universe' }) {
  if (!id) return <>—</>;
  const href = kind === 'place'
    ? `https://www.roblox.com/games/${id}`
    : `https://create.roblox.com/dashboard/creations/experiences/${id}/overview`;
  return <a className="id-link" href={href} target="_blank" rel="noreferrer" title={`Buka ${kind === 'place' ? 'Place' : 'Universe'} di Roblox`}>{id}</a>;
}

function LicenseTable({ rows, loading, onDetail, onEdit, onDelete }: { rows: LicenseRow[]; loading: boolean; onDetail: (r: LicenseRow) => void; onEdit: (r: LicenseRow) => void; onDelete: (r: LicenseRow) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Owner</th><th>Produk</th><th>Status</th><th>Universe</th><th>Instalasi</th><th>Terakhir Terlihat</th><th>Aksi</th></tr></thead><tbody>
    {rows.map(row => <tr key={`${row.owner_id}:${row.owner_type}:${row.product}`}><td><strong>{row.owner_id}</strong><small>{row.owner_type}</small></td><td><strong>{row.product}</strong><small>Dibuat {fmt(row.created_at)}</small></td><td><span className={`status ${row.status}`}>{statusLabel[row.status]}</span></td><td><strong><RobloxId id={row.universe_id} kind="universe" /></strong><small>Monitoring saja</small></td><td><strong>{row.ever_connected ? row.game_name || row.place_name || 'Terhubung' : 'Belum terhubung'}</strong><small>{row.place_id ? <RobloxId id={row.place_id} kind="place" /> : row.system_version || '—'}</small></td><td>{fmt(row.last_seen_at)}</td><td><div className="row-actions"><button aria-label={`Detail instalasi ${row.owner_id}`} title="Detail instalasi" onClick={() => onDetail(row)}><Eye size={16} /></button><button aria-label={`Edit lisensi ${row.owner_id}`} title="Edit" onClick={() => onEdit(row)}><Pencil size={16} /></button><button className="danger-action" aria-label={`Hapus lisensi ${row.owner_id}`} title="Hapus" onClick={() => onDelete(row)}><Trash2 size={16} /></button></div></td></tr>)}
    {!rows.length && !loading && <EmptyRow cols={7} text="Belum ada lisensi." />}
    {loading && <tr><td colSpan={7}><div className="empty"><Loader2 className="spin" size={28} /><strong>Memuat data…</strong></div></td></tr>}
  </tbody></table></div>;
}

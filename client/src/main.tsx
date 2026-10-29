import { Component, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import './index.css';
import { APP_NAME, Avatar, SocketProvider, api, useMe, useSocket } from './lib';
import { AuthPage, Landing } from './pages/Auth';
import { AvatarEditor } from './pages/AvatarEditor';
import { Dashboard } from './pages/Dashboard';
import { RoomsPage, CreateRoom, InvitePage } from './pages/Rooms';
import { RoomPage } from './pages/Room';
import { Leaderboard, SettingsPage } from './pages/Misc';
import { NotificationBell, NotificationsProvider } from './notify';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function applyTheme(theme?: string) {
  const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

function Shell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const { connected } = useSocket();
  const nav = useNavigate();
  const client = useQueryClient();
  useEffect(() => applyTheme(me?.settings?.theme), [me?.settings?.theme]);
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    client.clear();
    nav('/');
  };
  const link = ({ isActive }: { isActive: boolean }) => `rounded-lg px-3 py-1.5 font-bold ${isActive ? 'bg-brand/15 text-brand' : 'text-muted hover:text-ink'}`;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2" aria-label="Ana menü">
          <Link to="/app" className="mr-2 font-pixel text-xl text-brand">{APP_NAME}</Link>
          <NavLink to="/app" end className={link}>Panel</NavLink>
          <NavLink to="/rooms" className={link}>Odalar</NavLink>
          <NavLink to="/leaderboard" className={link}>Sıralama</NavLink>
          <NavLink to="/profile" className={link}>Karakter</NavLink>
          <NavLink to="/settings" className={link}>Ayarlar</NavLink>
          <span className="ml-auto flex items-center gap-3">
            {!connected && <span className="rounded bg-sun/30 px-2 py-0.5 text-xs font-bold" role="status">Bağlanıyor…</span>}
            {me && <NotificationBell />}
            {me && <Avatar config={me.avatar} size={32} />}
            <button className="btn-ghost py-1 text-sm" onClick={logout}>Çıkış</button>
          </span>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto mt-10 max-w-md p-6 text-center" role="alert">
        <p className="font-pixel text-2xl">Bir şeyler ters gitti</p>
        <p className="my-2 text-sm text-muted">{this.state.error.message}</p>
        <button className="btn-primary" onClick={() => location.reload()}>Sayfayı yenile</button>
      </div>
    );
  }
}

function Private({ children, needAvatar = true }: { children: ReactNode; needAvatar?: boolean }) {
  const { data: me, isLoading, error } = useMe();
  const loc = useLocation();
  if (isLoading) return <div className="grid min-h-screen place-items-center font-pixel text-2xl text-muted">Yükleniyor…</div>;
  if (error) return <div className="grid min-h-screen place-items-center">Sunucuya ulaşılamıyor. <button className="btn-ghost ml-2" onClick={() => location.reload()}>Tekrar dene</button></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (needAvatar && !me.avatar) return <Navigate to="/onboarding" replace />;
  return (
    <Shell>
      <ErrorBoundary key={loc.pathname}>{children}</ErrorBoundary>
    </Shell>
  );
}

function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <p className="font-pixel text-6xl text-brand">404</p>
        <p className="my-3 text-muted">Bu sayfa kütüphanede yok.</p>
        <Link to="/" className="btn-primary">Ana sayfa</Link>
      </div>
    </div>
  );
}

function App() {
  const { data: me } = useMe();
  return (
    <SocketProvider userId={me?.id ?? null}>
      <NotificationsProvider>
      <Routes>
        <Route path="/" element={me ? <Navigate to="/app" /> : <Landing />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/onboarding" element={<Private needAvatar={false}><AvatarEditor onboarding /></Private>} />
        <Route path="/app" element={<Private><Dashboard /></Private>} />
        <Route path="/rooms" element={<Private><RoomsPage /></Private>} />
        <Route path="/rooms/new" element={<Private><CreateRoom /></Private>} />
        <Route path="/rooms/:id" element={<Private><RoomPage /></Private>} />
        <Route path="/invite/:code" element={<Private><InvitePage /></Private>} />
        <Route path="/profile" element={<Private><AvatarEditor /></Private>} />
        <Route path="/leaderboard" element={<Private><Leaderboard /></Private>} />
        <Route path="/settings" element={<Private><SettingsPage /></Private>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </NotificationsProvider>
    </SocketProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

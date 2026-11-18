import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NavLink, useLocation, useNavigate } from '../lib/router.jsx';
import Icon from './Icon.jsx';
import AppLauncher from './AppLauncher.jsx';
import CommandPalette from './CommandPalette.jsx';
import NotificationCenter from './NotificationCenter.jsx';
import DayScene from './DayScene.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { canAccessPath, canCustomizeDashboard } from '../utils/permissions.js';
import { NAV_ITEMS, canOpenNavItem, navLabel } from '../utils/nav.js';
import { DataLoadingLayer } from './Loading.jsx';
import HrChatBot from './HrChatBot.jsx';
import { getLoadingSnapshot, subscribeLoading } from '../state/loadingStore.js';
import { prefetchRoute } from '../utils/routePrefetch.js';

function initials(name = 'User') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'U';
}

const ROLE_LABEL = { SUPER_ADMIN: 'Super Admin', HR_ADMIN: 'HR Admin', MANAGER: 'Manager', EMPLOYEE: 'Employee' };

// The few places people go every day sit in the top bar. Everything else is one
// click away in the 9-dot menu, the search box (Ctrl K) or the settings menu.
const PRIMARY = [
  { to: '/', icon: 'Home', end: true },
  { to: '/dashboard', icon: 'LayoutDashboard' },
  { to: '/employees', label: 'People', icon: 'Users', match: ['/employees', '/hierarchy', '/recruitment', '/probation', '/document-studio'] },
  { to: '/attendance', icon: 'CalendarCheck', match: ['/attendance', '/regularization'] },
  { to: '/leave', icon: 'Palmtree', match: ['/leave'] },
  { to: '/payroll', icon: 'Wallet', match: ['/payroll'] },
];

const SETTINGS_LINKS = [
  { to: '/account', label: 'My profile', icon: 'CircleUser' },
  { to: '/settings', label: 'Company settings', icon: 'Settings2' },
  { to: '/access', label: 'User access', icon: 'ShieldCheck' },
  { to: '/integrations', label: 'Email, WhatsApp & AI', icon: 'PlugZap' },
  { to: '/ai', label: 'AI assistant', icon: 'Sparkles' },
];

export default function Layout({ children }) {
  const { user, employee, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [launcher, setLauncher] = useState(false);
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const loadingTimer = useRef(null);
  const menuRef = useRef(null);
  const pendingDataLoads = useSyncExternalStore(subscribeLoading, getLoadingSnapshot, () => 0);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

  const path = location.pathname;
  const isHome = path === '/';
  const current = NAV_ITEMS.find((i) => i.to === path);
  const title = current ? navLabel(current, user) : '';
  const canAi = canCustomizeDashboard(user);

  const primary = useMemo(() => PRIMARY
    .map((p) => {
      const item = NAV_ITEMS.find((i) => i.to === p.to);
      return item && canOpenNavItem(user, item) ? { ...p, label: p.label || navLabel(item, user) } : null;
    })
    .filter(Boolean), [user]);
  const settingsLinks = useMemo(() => SETTINGS_LINKS.filter((l) => canAccessPath(user, l.to)), [user]);

  useEffect(() => {
    document.title = title && !isHome ? `${title} · JPK HRMS` : 'JPK HRMS';
  }, [title, isHome]);

  useEffect(() => { setMenu(false); setLauncher(false); }, [path]);

  // Skeleton for module data, delayed slightly so instant responses never flash.
  useEffect(() => {
    clearTimeout(loadingTimer.current);
    loadingTimer.current = setTimeout(() => setDataLoading(pendingDataLoads > 0), pendingDataLoads > 0 ? 140 : 90);
    return () => clearTimeout(loadingTimer.current);
  }, [pendingDataLoads]);

  // Ctrl+K / ⌘K opens search from anywhere.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onClick(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); }
    if (menu) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menu]);

  function openAi() { navigate('/dashboard?studio=1'); }

  const isActive = (p) => (p.end ? path === p.to : (p.match || [p.to]).includes(path));

  return (
    <div className="jpk-app">
      <header className="jpk-top">
        <div className="jpk-top-left">
          <button type="button" className="jpk-top-icon jpk-grid-btn" onClick={() => setLauncher(true)} aria-label="All modules" title="All modules">
            <Icon name="Grid3x3" size={20} />
          </button>
          <NavLink to="/" className="jpk-top-brand" aria-label="JPK Metallics home" onMouseEnter={() => prefetchRoute('/')}>
            <img src="/brand/jpk-logo.png" alt="JPK Metallics" />
          </NavLink>
        </div>

        <nav className="jpk-top-nav" aria-label="Main">
          {primary.map((p) => (
            <NavLink
              key={p.to}
              to={p.to}
              end={p.end}
              className={() => `jpk-top-link ${isActive(p) ? 'active' : ''}`}
              onMouseEnter={() => prefetchRoute(p.to)}
              onFocus={() => prefetchRoute(p.to)}
            >
              <Icon name={p.icon} size={15} />
              <span>{p.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="jpk-top-right">
          <button type="button" className="jpk-top-search" onClick={() => setPalette(true)} aria-label="Search">
            <Icon name="Search" size={16} />
            <span>Search</span>
            <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          <NotificationCenter />
          {canAi && (
            <button type="button" className="jpk-top-icon jpk-ai-btn" onClick={openAi} aria-label="Create with Gemini AI" title="Create with Gemini AI">
              <Icon name="Sparkles" size={18} />
            </button>
          )}
          <div className="jpk-top-settings" ref={menuRef}>
            <button type="button" className="jpk-settings-btn" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} aria-label="Settings" title="Settings">
              <Icon name="Settings" size={18} />
              <Icon name="ChevronDown" size={13} />
            </button>
            {menu && (
              <div className="jpk-menu" role="menu">
                <div className="jpk-menu-id">
                  <span className="jpk-avatar lg">{initials(user?.name)}</span>
                  <div><b>{user?.name || 'User'}</b><small>{ROLE_LABEL[user?.role] || user?.role}{employee?.employeeCode ? ` · ${employee.employeeCode}` : ''}</small></div>
                </div>
                {settingsLinks.map((l) => (
                  <NavLink key={l.to} to={l.to} className="jpk-menu-link" role="menuitem" onMouseEnter={() => prefetchRoute(l.to)}>
                    <Icon name={l.icon} size={16} /> {l.label}
                  </NavLink>
                ))}
                <button type="button" className="jpk-menu-link danger" role="menuitem" onClick={logout}><Icon name="LogOut" size={16} /> Sign out</button>
              </div>
            )}
          </div>
          <button type="button" className="jpk-top-icon jpk-power-btn" onClick={logout} aria-label="Sign out" title="Sign out">
            <Icon name="Power" size={18} />
          </button>
        </div>
      </header>

      {!isHome && title && (
        <DayScene variant="band" className="jpk-pagehead">
          <div className="jpk-pagehead-inner">
            <nav className="jpk-crumbs" aria-label="You are here">
              <NavLink to="/">Home</NavLink>
              {current?.group && <><Icon name="ChevronRight" size={13} /><span>{current.group}</span></>}
            </nav>
            <h1>{title}</h1>
          </div>
        </DayScene>
      )}

      <main className={`jpk-main ${isHome ? 'is-home' : ''} ${dataLoading ? 'is-data-loading' : ''}`}>
        <div className="route-content">{children}</div>
        {dataLoading && <DataLoadingLayer />}
      </main>

      <HrChatBot />
      {launcher && <AppLauncher user={user} onClose={() => setLauncher(false)} />}
      {palette && <CommandPalette user={user} onClose={() => setPalette(false)} onOpenAi={canAi ? openAi : null} />}
    </div>
  );
}

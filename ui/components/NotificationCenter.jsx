import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from '../lib/router.jsx';
import Icon from './Icon.jsx';
import { InlineSkeleton } from './Loading.jsx';
import { api, post } from '../api/client.js';

function relativeTime(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return 'Just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export default function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const initialized = useRef(false);
  const knownIds = useRef(new Set());
  const wrapRef = useRef(null);

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const data = await api('/notifications/inbox?limit=30');
      const next = data.notifications || [];
      if (initialized.current && typeof window !== 'undefined' && window.Notification?.permission === 'granted') {
        const fresh = next.filter((n) => !knownIds.current.has(String(n._id)) && !n.readAt);
        fresh.slice(0, 3).forEach((n) => {
          try {
            const notification = new window.Notification(n.title, { body: n.body || 'Open JPK PeopleOS to view details.', tag: `jpk-${n._id}` });
            notification.onclick = () => { window.focus(); if (n.link) navigate(n.link); };
          } catch (_) { /* Browser may suppress notifications in some contexts. */ }
        });
      }
      knownIds.current = new Set(next.map((n) => String(n._id)));
      initialized.current = true;
      setItems(next);
      setUnreadCount(Number(data.unreadCount || 0));
    } catch (_) {
      // Notification polling should never interrupt the rest of the HRMS.
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load({ silent: true });
    // Once a minute, and only while the tab is in front: every open tab used to
    // ask every 25 s, which kept the server busy for people who were not looking.
    let last = Date.now();
    const poll = () => { if (document.hidden) return; last = Date.now(); load({ silent: true }); };
    const timer = window.setInterval(poll, 60_000);
    const onBack = () => { if (!document.hidden && Date.now() - last > 15_000) poll(); };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onBack); document.removeEventListener('visibilitychange', onBack); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (event) => { if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  async function markRead(item) {
    if (!item.readAt) {
      await post(`/notifications/inbox/${item._id}/read`, {}, { toast: false });
      setItems((current) => current.map((n) => n._id === item._id ? { ...n, readAt: new Date().toISOString() } : n));
      setUnreadCount((value) => Math.max(0, value - 1));
    }
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  async function markAll() {
    await post('/notifications/inbox/read-all', {}, { toast: false });
    setItems((current) => current.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnreadCount(0);
  }

  async function enableBrowserAlerts() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const permission = await window.Notification.requestPermission();
    if (permission === 'granted') { toast.success('Browser alerts enabled'); load({ silent: true }); }
    else toast.error('Browser notifications were not enabled');
  }

  const canEnableBrowserAlerts = typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'default';

  return (
    <div className="notification-center" ref={wrapRef}>
      <button className={`notification-bell ${unreadCount ? 'has-unread' : ''}`} onClick={() => { setOpen((v) => !v); load({ silent: true }); }} aria-label="Notifications" title="Notifications">
        <Icon name="Bell" size={18} />
        {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-popover">
          <div className="notification-head">
            <div><small>ACTIVITY CENTER</small><strong>Notifications</strong></div>
            {unreadCount > 0 && <button onClick={markAll}>Mark all read</button>}
          </div>
          {canEnableBrowserAlerts && (
            <button className="enable-alerts" onClick={enableBrowserAlerts}><Icon name="Bell" size={15}/> Enable browser alerts</button>
          )}
          <div className="notification-list">
            {loading && !items.length && <InlineSkeleton label="Loading notifications" />}
            {!loading && !items.length && <div className="notification-empty"><Icon name="CheckCircle2" size={26}/><b>You're all caught up</b><span>New leave, payroll and HR activity will appear here.</span></div>}
            {items.map((item) => (
              <button key={item._id} className={`notification-item ${item.readAt ? '' : 'unread'} ${String(item.priority || '').toLowerCase()}`} onClick={() => markRead(item)}>
                <span className="notification-dot" />
                <span className="notification-copy"><b>{item.title}</b><span>{item.body}</span><small>{relativeTime(item.createdAt)}</small></span>
                {item.link && <Icon name="ChevronRight" size={15}/>} 
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

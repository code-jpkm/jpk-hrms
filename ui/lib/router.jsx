'use client';

/**
 * Next.js navigation with the small react-router style API the pages were
 * written against (Link to=…, NavLink, useNavigate, useLocation,
 * useSearchParams, Navigate). Routing itself is done by Next.js (app/ folder).
 */
import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation';

const HASH_EVENT = 'hrms:hashchange';

function subscribeHash(onChange) {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  window.addEventListener(HASH_EVENT, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(HASH_EVENT, onChange);
  };
}
const readHash = () => window.location.hash;
const serverHash = () => '';

// Next.js changes the address with pushState, which fires no hashchange event.
// Tell listeners a few times while the navigation settles.
function announceHash() {
  if (typeof window === 'undefined') return;
  for (const delay of [0, 120, 400]) setTimeout(() => window.dispatchEvent(new Event(HASH_EVENT)), delay);
}

export function useLocation() {
  const pathname = usePathname() || '/';
  const params = useNextSearchParams();
  const query = params ? params.toString() : '';
  const hash = useSyncExternalStore(subscribeHash, readHash, serverHash);
  return useMemo(() => ({
    pathname,
    search: query ? `?${query}` : '',
    hash,
    state: null,
    key: `${pathname}?${query}${hash}`
  }), [pathname, query, hash]);
}

export function useNavigate() {
  const router = useRouter();
  return useCallback((to, options = {}) => {
    if (typeof to === 'number') {
      if (to < 0) router.back();
      else router.forward();
      return;
    }
    const href = String(to || '/');
    if (options.replace) router.replace(href, { scroll: options.scroll !== false });
    else router.push(href, { scroll: options.scroll !== false });
    announceHash();
  }, [router]);
}

export function useSearchParams() {
  const params = useNextSearchParams();
  const router = useRouter();
  const pathname = usePathname() || '/';
  const current = useMemo(() => new URLSearchParams(params ? params.toString() : ''), [params]);
  const setSearchParams = useCallback((next, options = {}) => {
    const value = typeof next === 'function' ? next(new URLSearchParams(current.toString())) : next;
    const query = new URLSearchParams(value || {}).toString();
    const href = `${pathname}${query ? `?${query}` : ''}${typeof window !== 'undefined' ? window.location.hash : ''}`;
    if (options.replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }, [current, pathname, router]);
  return [current, setSearchParams];
}

export function Link({ to, href, replace, onClick, ref, ...rest }) {
  const target = to ?? href ?? '/';
  return (
    <NextLink
      ref={ref}
      href={target}
      replace={replace}
      onClick={(event) => {
        if (onClick) onClick(event);
        if (String(target).includes('#')) announceHash();
      }}
      {...rest}
    />
  );
}

export function NavLink({ to, end = false, className, style, children, ...rest }) {
  const pathname = usePathname() || '/';
  const target = String(to || '/').split(/[?#]/)[0] || '/';
  const isActive = end || target === '/'
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`);
  const state = { isActive, isPending: false, isTransitioning: false };
  const classes = typeof className === 'function'
    ? className(state)
    : [className, isActive ? 'active' : ''].filter(Boolean).join(' ');
  return (
    <Link
      to={to}
      className={classes || undefined}
      style={typeof style === 'function' ? style(state) : style}
      aria-current={isActive ? 'page' : undefined}
      {...rest}
    >
      {typeof children === 'function' ? children(state) : children}
    </Link>
  );
}

export function Navigate({ to, replace = false }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, to, replace]);
  return null;
}

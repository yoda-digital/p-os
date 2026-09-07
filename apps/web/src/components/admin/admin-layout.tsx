import { type ReactNode, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth-store';
import { FullPageSpinner } from '../common/spinner';
import {
  LayoutDashboard, Building2, Users, ScrollText, Package, ShieldCheck, Activity, ArrowLeft, ShieldAlert,
} from 'lucide-react';

/**
 * Guards its children behind `user.is_system`. Renders a spinner while the
 * profile is still loading, and a 404-style page for non-system users
 * (per spec 2.5: "Non-system users see 404").
 *
 * `/admin` is not nested under `AppLayout` (which normally triggers
 * `loadProfile()`), so this loads the profile itself when navigated to
 * directly (e.g. a hard refresh on `/admin`).
 */
export function SystemGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation('admin');
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const loadProfile = useAuthStore((s) => s.loadProfile);

  useEffect(() => {
    if (token && !user) loadProfile();
  }, [token, user, loadProfile]);

  if (token && !user) return <FullPageSpinner />;

  if (!user?.is_system) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 text-center px-4">
        <ShieldAlert className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-4" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">404</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('not_found')}</p>
      </div>
    );
  }

  return <>{children}</>;
}

const navItems: { path: string; end?: boolean; key: string; icon: typeof LayoutDashboard }[] = [
  { path: '', end: true, key: 'dashboard', icon: LayoutDashboard },
  { path: 'organizations', key: 'organizations', icon: Building2 },
  { path: 'users', key: 'users', icon: Users },
  { path: 'audit', key: 'audit', icon: ScrollText },
  { path: 'packs', key: 'packs', icon: Package },
  { path: 'policies', key: 'policies', icon: ShieldCheck },
  { path: 'health', key: 'health', icon: Activity },
];

export function AdminLayout() {
  const { t } = useTranslation('admin');
  const { t: tCommon } = useTranslation('common');

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
      <aside className="w-60 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full shrink-0">
        <div className="h-14 flex items-center gap-2 px-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <span className="text-base font-bold text-slate-900 dark:text-white">{t('title')}</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5 scrollbar-thin">
          {navItems.map(({ path, end, key, icon: Icon }) => (
            <NavLink
              key={key}
              to={path}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2 py-1.5 text-sm rounded-md transition-colors ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <NavLink
            to="/cases"
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md"
          >
            <ArrowLeft className="w-4 h-4" />
            {tCommon('nav.all_cases')}
          </NavLink>
        </div>
      </aside>
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}

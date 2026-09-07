import { NavLink, useParams } from 'react-router-dom';
import { useCases } from '../../hooks/use-case';
import {
  LayoutGrid, Bell, Clock, GitBranch, Shield, FileCheck,
  Users, Package, AlertTriangle, HelpCircle, History,
  FlaskConical, BarChart3, Plus, FolderOpen, Settings,
  Kanban, Scale, ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreateCaseDialog } from '../case/create-case-dialog';
import { useAuthStore } from '../../stores/auth-store';

const viewTabs = [
  { path: 'kanban', key: 'kanban', icon: Kanban },
  { path: 'attention', key: 'attention', icon: Bell },
  { path: 'timeline', key: 'timeline', icon: Clock },
  { path: 'dependencies', key: 'dependencies', icon: GitBranch },
  { path: 'evidence', key: 'evidence', icon: FileCheck },
  { path: 'decisions', key: 'decisions', icon: Scale },
  { path: 'compliance', key: 'compliance', icon: Shield },
  { path: 'actors', key: 'actors', icon: Users },
  { path: 'resources', key: 'resources', icon: Package },
  { path: 'risk', key: 'risk', icon: AlertTriangle },
  { path: 'why', key: 'why', icon: HelpCircle },
  { path: 'time-travel', key: 'time_travel', icon: History },
  { path: 'simulation', key: 'simulation', icon: FlaskConical },
  { path: 'intelligence', key: 'intelligence', icon: BarChart3 },
] as const;

export function Sidebar() {
  const { t } = useTranslation('common');
  const { caseId } = useParams();
  const { data: cases } = useCases();
  const [createOpen, setCreateOpen] = useState(false);
  const isSystem = useAuthStore((s) => s.user?.is_system);

  return (
    <>
      <aside className="w-60 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full shrink-0">
        {/* Cases Section */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider">{t('nav.cases')}</span>
            <button
              onClick={() => setCreateOpen(true)}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-0.5 max-h-48 overflow-y-auto scrollbar-thin">
            {cases?.map((c) => (
              <NavLink
                key={c.id}
                to={`/cases/${c.id}/kanban`}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ${
                    isActive || caseId === c.id
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`
                }
              >
                <FolderOpen className="w-4 h-4 shrink-0" />
                <span className="truncate">{c.title}</span>
              </NavLink>
            ))}
            {(!cases || cases.length === 0) && (
              <p className="text-xs text-slate-400 dark:text-slate-500 px-2 py-2">{t('actions.no_results')}</p>
            )}
          </div>
        </div>

        {/* View Tabs (when a case is selected) */}
        {caseId && (
          <nav className="flex-1 overflow-y-auto p-3 space-y-0.5 scrollbar-thin">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider px-2 mb-2 block">{t('nav.views')}</span>
            {viewTabs.map(({ path, key, icon: Icon }) => (
              <NavLink
                key={path}
                to={`/cases/${caseId}/${path}`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-2 py-1.5 text-sm rounded-md transition-colors ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                {t(`nav_tabs.${key}`)}
              </NavLink>
            ))}
          </nav>
        )}

        {/* Bottom */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-0.5">
          <NavLink
            to="/cases"
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md"
          >
            <FolderOpen className="w-4 h-4" />
            {t('nav.all_cases')}
          </NavLink>
          <NavLink
            to="/settings/profile"
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-1.5 text-sm rounded-md ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`
            }
          >
            <Settings className="w-4 h-4" />
            {t('nav.settings')}
          </NavLink>
          {isSystem && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex items-center gap-2 px-2 py-1.5 text-sm rounded-md ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`
              }
            >
              <ShieldCheck className="w-4 h-4" />
              {t('nav.admin')}
            </NavLink>
          )}
        </div>
      </aside>

      <CreateCaseDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

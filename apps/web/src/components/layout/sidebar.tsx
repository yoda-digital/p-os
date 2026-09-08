import { NavLink, useParams } from 'react-router-dom';
import { useCases } from '../../hooks/use-case';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  LayoutGrid, Bell, Clock, GitBranch, Shield, FileCheck,
  Users, Package, AlertTriangle, HelpCircle, History,
  FlaskConical, BarChart3, Plus, FolderOpen, Settings,
  Kanban, Scale, ShieldCheck, ArrowUpDown,
} from 'lucide-react';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CreateCaseDialog } from '../case/create-case-dialog';
import { useAuthStore } from '../../stores/auth-store';

const viewConfig: Record<string, { icon: typeof Bell }> = {
  kanban: { icon: Kanban },
  attention: { icon: Bell },
  timeline: { icon: Clock },
  dependencies: { icon: GitBranch },
  evidence: { icon: FileCheck },
  decisions: { icon: Scale },
  compliance: { icon: Shield },
  actors: { icon: Users },
  resources: { icon: Package },
  risk: { icon: AlertTriangle },
  why: { icon: HelpCircle },
  'time-travel': { icon: History },
  simulation: { icon: FlaskConical },
  intelligence: { icon: BarChart3 },
};

const defaultViewTabs = [
  'kanban', 'attention', 'timeline', 'dependencies', 'evidence',
  'decisions', 'compliance', 'actors', 'resources', 'risk',
  'why', 'time-travel', 'simulation', 'intelligence',
];

const viewKeyMap: Record<string, string> = {
  kanban: 'kanban',
  attention: 'attention',
  timeline: 'timeline',
  dependencies: 'dependencies',
  evidence: 'evidence',
  decisions: 'decisions',
  compliance: 'compliance',
  actors: 'actors',
  resources: 'resources',
  risk: 'risk',
  why: 'why',
  'time-travel': 'time_travel',
  simulation: 'simulation',
  intelligence: 'intelligence',
};

export function Sidebar() {
  const { t } = useTranslation('common');
  const { caseId } = useParams();
  const { data: cases } = useCases();
  const [createOpen, setCreateOpen] = useState(false);
  const [useAdaptiveOrder, setUseAdaptiveOrder] = useState(true);
  const isSystem = useAuthStore((s) => s.user?.is_system);

  // Fetch compiled view order when a case is selected
  const { data: compiledViews } = useQuery({
    queryKey: ['case-views', caseId],
    queryFn: () => api.getCaseViews(caseId!),
    enabled: !!caseId && useAdaptiveOrder,
    staleTime: 30_000, // recompute every 30s
  });

  // Determine view order
  const orderedViews = useMemo(() => {
    if (!useAdaptiveOrder || !compiledViews?.views) {
      return defaultViewTabs;
    }

    // Use compiled order, falling back to default for any missing views
    const compiledIds = compiledViews.views.map(v => v.id);
    const remaining = defaultViewTabs.filter(v => !compiledIds.includes(v));
    return [...compiledIds.filter(id => defaultViewTabs.includes(id)), ...remaining];
  }, [compiledViews, useAdaptiveOrder]);

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
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider">{t('nav.views')}</span>
              <button
                onClick={() => setUseAdaptiveOrder(!useAdaptiveOrder)}
                className={`p-0.5 rounded transition-colors ${
                  useAdaptiveOrder
                    ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'
                    : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={useAdaptiveOrder ? 'Adaptive order (click for default)' : 'Default order (click for adaptive)'}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
            </div>
            {orderedViews.map((path) => {
              const config = viewConfig[path];
              const key = viewKeyMap[path] ?? path;
              const Icon = config?.icon ?? LayoutGrid;

              return (
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
              );
            })}
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

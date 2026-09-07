import { NavLink, useParams } from 'react-router-dom';
import { useCases } from '../../hooks/use-case';
import {
  LayoutGrid, Bell, Clock, GitBranch, Shield, FileCheck,
  Users, Package, AlertTriangle, HelpCircle, History,
  FlaskConical, BarChart3, Plus, FolderOpen, Settings,
  Kanban, Scale,
} from 'lucide-react';
import { useState } from 'react';
import { CreateCaseDialog } from '../case/create-case-dialog';

const viewTabs = [
  { path: 'kanban', label: 'Kanban', icon: Kanban },
  { path: 'attention', label: 'Attention', icon: Bell },
  { path: 'timeline', label: 'Timeline', icon: Clock },
  { path: 'dependencies', label: 'Dependencies', icon: GitBranch },
  { path: 'evidence', label: 'Evidence', icon: FileCheck },
  { path: 'decisions', label: 'Decisions', icon: Scale },
  { path: 'compliance', label: 'Compliance', icon: Shield },
  { path: 'actors', label: 'Actors', icon: Users },
  { path: 'resources', label: 'Resources', icon: Package },
  { path: 'risk', label: 'Risk', icon: AlertTriangle },
  { path: 'why', label: 'WHY', icon: HelpCircle },
  { path: 'time-travel', label: 'Time Travel', icon: History },
  { path: 'simulation', label: 'Simulation', icon: FlaskConical },
  { path: 'intelligence', label: 'Intelligence', icon: BarChart3 },
];

export function Sidebar() {
  const { caseId } = useParams();
  const { data: cases } = useCases();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <aside className="w-60 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full shrink-0">
        {/* Cases Section */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider">Cases</span>
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
              <p className="text-xs text-slate-400 dark:text-slate-500 px-2 py-2">No cases yet</p>
            )}
          </div>
        </div>

        {/* View Tabs (when a case is selected) */}
        {caseId && (
          <nav className="flex-1 overflow-y-auto p-3 space-y-0.5 scrollbar-thin">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 tracking-wider px-2 mb-2 block">Views</span>
            {viewTabs.map(({ path, label, icon: Icon }) => (
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
                {label}
              </NavLink>
            ))}
          </nav>
        )}

        {/* Bottom */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <NavLink
            to="/cases"
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md"
          >
            <Settings className="w-4 h-4" />
            All Cases
          </NavLink>
        </div>
      </aside>

      <CreateCaseDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

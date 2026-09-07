import { Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth-store';
import { useRealtimeUpdates } from '../../lib/ws';
import { useParams } from 'react-router-dom';
import { Sidebar } from './sidebar';
import { Hexagon, LogOut, User } from 'lucide-react';
import { Dropdown, DropdownItem } from '../common/dropdown';
import { useEffect } from 'react';

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const loadProfile = useAuthStore((s) => s.loadProfile);
  const { caseId } = useParams();

  useRealtimeUpdates(caseId);

  useEffect(() => {
    if (!user) loadProfile();
  }, [user, loadProfile]);

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Nav */}
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <Hexagon className="w-6 h-6 text-emerald-600" />
            <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
              Universal Process OS
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Dropdown
              align="right"
              trigger={
                <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm">
                  <User className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-700 dark:text-slate-300">{user?.display_name || user?.email || 'User'}</span>
                </button>
              }
            >
              <DropdownItem onClick={logout}>
                <span className="flex items-center gap-2">
                  <LogOut className="w-4 h-4" /> Sign Out
                </span>
              </DropdownItem>
            </Dropdown>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

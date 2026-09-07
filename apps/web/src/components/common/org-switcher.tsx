import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import { useAuthStore } from '../../stores/auth-store';
import { api } from '../../lib/api';

export function OrgSwitcher() {
  const { t } = useTranslation('common');
  const user = useAuthStore((s) => s.user);
  const memberships = user?.memberships ?? [];

  // Only show the switcher when the user belongs to more than one organization.
  if (memberships.length <= 1) return null;

  const current =
    memberships.find((m) => m.organization_id === user?.organization_id) ?? memberships[0]!;

  const handleSwitch = async (orgId: string) => {
    if (orgId === current.organization_id) return;
    try {
      const res = await api.switchOrg(orgId);
      localStorage.setItem('pos_token', res.token);
      window.location.reload();
    } catch {
      /* switch failed — keep current org */
    }
  };

  return (
    <div className="relative group">
      <button
        title={t('user.switch_org')}
        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-sm max-w-[160px]"
      >
        <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
        <span className="hidden sm:inline truncate">{current.organization_name}</span>
      </button>
      <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg hidden group-hover:block z-50 min-w-[180px]">
        <div className="px-3 py-1.5 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500 tracking-wider">
          {t('user.switch_org')}
        </div>
        {memberships.map((m) => (
          <button
            key={m.organization_id}
            onClick={() => handleSwitch(m.organization_id)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 truncate ${
              m.organization_id === current.organization_id
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                : ''
            }`}
          >
            <span className="truncate">{m.organization_name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

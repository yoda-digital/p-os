import { Routes, Route, Navigate, Outlet, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from './stores/auth-store';
import { AppLayout } from './components/layout/app-layout';
import { LoginPage } from './components/auth/login-page';
import { RegisterPage } from './components/auth/register-page';
import { InvitationAccept } from './components/auth/invitation-accept';
import { CaseList } from './components/case/case-list';
import { CaseDetail } from './components/case/case-detail';
import { KanbanBoard } from './components/kanban/kanban-board';
import { AttentionView } from './components/views/attention-view';
import { TimelineView } from './components/views/timeline-view';
import { DependencyView } from './components/views/dependency-view';
import { EvidenceView } from './components/views/evidence-view';
import { DecisionsView } from './components/views/decisions-view';
import { ComplianceView } from './components/views/compliance-view';
import { ActorsView } from './components/views/actors-view';
import { ResourcesView } from './components/views/resources-view';
import { RiskView } from './components/views/risk-view';
import { WhyView } from './components/views/why-view';
import { TimeTravelView } from './components/views/time-travel-view';
import { SimulationView } from './components/views/simulation-view';
import { IntelligenceView } from './components/views/intelligence-view';

// Admin panel
import { AdminLayout, SystemGuard } from './components/admin/admin-layout';
import { AdminDashboard } from './components/admin/admin-dashboard';
import { AdminOrganizations } from './components/admin/admin-organizations';
import { AdminUsers } from './components/admin/admin-users';
import { AdminAudit } from './components/admin/admin-audit';
import { AdminPacks } from './components/admin/admin-packs';
import { AdminPolicies } from './components/admin/admin-policies';
import { AdminHealth } from './components/admin/admin-health';

// Settings
import { ProfileSettings } from './components/settings/profile-settings';
import { OrgSettings } from './components/settings/org-settings';
import { TeamManagement } from './components/settings/team-management';
import { MemberManagement } from './components/settings/member-management';
import { InvitationManagement } from './components/settings/invitation-management';
import { PolicyEditor } from './components/settings/policy-editor';

function AuthGuard() {
  const isAuthenticated = useAuthStore((s) => !!s.token);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const settingsTabs = ['profile', 'organization', 'teams', 'members', 'invitations', 'policies'] as const;

function SettingsLayout() {
  const { t } = useTranslation('settings');
  return (
    <div>
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {settingsTabs.map((tab) => (
            <NavLink
              key={tab}
              to={tab}
              className={({ isActive }) =>
                `px-3 py-3 text-sm border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-emerald-600 text-emerald-700 dark:text-emerald-300 font-medium'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`
              }
            >
              {t(`nav.${tab}`)}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/invite/:token" element={<InvitationAccept />} />
      <Route element={<AuthGuard />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/cases" replace />} />
          <Route path="/cases" element={<CaseList />} />
          <Route path="/cases/:caseId" element={<CaseDetail />}>
            <Route index element={<Navigate to="kanban" replace />} />
            <Route path="kanban" element={<KanbanBoard />} />
            <Route path="attention" element={<AttentionView />} />
            <Route path="timeline" element={<TimelineView />} />
            <Route path="dependencies" element={<DependencyView />} />
            <Route path="evidence" element={<EvidenceView />} />
            <Route path="decisions" element={<DecisionsView />} />
            <Route path="compliance" element={<ComplianceView />} />
            <Route path="actors" element={<ActorsView />} />
            <Route path="resources" element={<ResourcesView />} />
            <Route path="risk" element={<RiskView />} />
            <Route path="why" element={<WhyView />} />
            <Route path="time-travel" element={<TimeTravelView />} />
            <Route path="simulation" element={<SimulationView />} />
            <Route path="intelligence" element={<IntelligenceView />} />
          </Route>

          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfileSettings />} />
            <Route path="organization" element={<OrgSettings />} />
            <Route path="teams" element={<TeamManagement />} />
            <Route path="members" element={<MemberManagement />} />
            <Route path="invitations" element={<InvitationManagement />} />
            <Route path="policies" element={<PolicyEditor />} />
          </Route>
        </Route>

        <Route
          path="/admin"
          element={
            <SystemGuard>
              <AdminLayout />
            </SystemGuard>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="organizations" element={<AdminOrganizations />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="audit" element={<AdminAudit />} />
          <Route path="packs" element={<AdminPacks />} />
          <Route path="policies" element={<AdminPolicies />} />
          <Route path="health" element={<AdminHealth />} />
        </Route>
      </Route>
    </Routes>
  );
}

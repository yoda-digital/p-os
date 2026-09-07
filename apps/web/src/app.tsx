import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from './stores/auth-store';
import { AppLayout } from './components/layout/app-layout';
import { LoginPage } from './components/auth/login-page';
import { RegisterPage } from './components/auth/register-page';
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

function AuthGuard() {
  const isAuthenticated = useAuthStore((s) => !!s.token);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
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
        </Route>
      </Route>
    </Routes>
  );
}

import { Navigate, Route, Routes, useLocation } from 'react-router';
import { TemplatesPage } from '@/features/templates/TemplatesPage';
import { AdminPage } from '@/features/admin/AdminPage';
import { AiAccessPage } from '@/features/account/AiAccessPage';
import { AgentsPage } from '@/features/agents/AgentsPage';
import { SchedulingPage } from '@/features/scheduling/SchedulingPage';
import { CatalogPage } from '@/features/catalog/CatalogPage';
import { PlaylistPage } from '@/features/playlist/PlaylistPage';
import { ContractPage } from '@/features/orders/ContractPage';
import { OrderPage } from '@/features/orders/OrderPage';
import { OrdersPage } from '@/features/orders/OrdersPage';
import { SignInPage } from '@/features/auth/SignInPage';
import { Placeholder } from '@/pages/Placeholder';
import { AppShell } from './AppShell';
import { ErrorBoundary } from './ErrorBoundary';
import { RequireSignIn } from './session';

const LATER = 'This module is not built yet. Layouts is the first one.';

export function App() {
  const { pathname } = useLocation();
  if (pathname === '/sign-in') return <SignInPage />;
  return (
    <RequireSignIn>
      <AppShell>
        <ErrorBoundary key={pathname}>
          <Routes>
            <Route path="/" element={<Navigate to="/templates" replace />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/scheduling" element={<SchedulingPage />} />
            <Route path="/scheduling/:orderId" element={<SchedulingPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/playlist" element={<PlaylistPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/clients" element={<OrdersPage />} />
            <Route path="/orders/contracts/:contractId" element={<ContractPage />} />
            <Route path="/orders/:orderId" element={<OrderPage />} />
            <Route path="/as-run" element={<Placeholder title="As-run" text={LATER} />} />
            <Route path="/reports" element={<Placeholder title="Reports" text={LATER} />} />
            <Route path="/admin" element={<Navigate to="/admin/channels" replace />} />
            <Route path="/admin/:section" element={<AdminPage />} />
            <Route path="/admin/channels/:channelId" element={<AdminPage />} />
            <Route path="/account/ai-access" element={<AiAccessPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/waiting" element={<AgentsPage />} />
            <Route path="/agents/rooms/:roomId" element={<AgentsPage />} />
            <Route path="/agents/:agentId" element={<AgentsPage />} />
            <Route path="/agents/:agentId/:tab" element={<AgentsPage />} />
            <Route path="/ui-kit" element={<Placeholder title="UI kit" text="The components are in apps/web/src/ui; a gallery page comes later." />} />
            <Route path="*" element={<Placeholder title="Not found" text="This page does not exist." />} />
          </Routes>
        </ErrorBoundary>
      </AppShell>
    </RequireSignIn>
  );
}

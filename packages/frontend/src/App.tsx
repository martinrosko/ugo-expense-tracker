import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider } from 'antd'
import AppLayout from './components/AppLayout'
import RequireAuth from './components/RequireAuth'
import ReviewPage from './pages/ReviewPage'
import PlansOverviewPage from './pages/PlansOverviewPage'
import PlanEditPage from './pages/PlanEditPage'
import PlanDetailPage from './pages/PlanDetailPage'
import TransactionsPage from './pages/TransactionsPage'
import PartnerBalancePage from './pages/PartnerBalancePage'
import BudgetChartPage from './pages/BudgetChartPage'
import ExecutionChartPage from './pages/ExecutionChartPage'
import AccountBalancePage from './pages/AccountBalancePage'
import SettingsTagsPage from './pages/SettingsTagsPage'
import SettingsPartnersPage from './pages/SettingsPartnersPage'

// Dev-only import tool; its Resco credentials must not ship in production bundles
const RescoTestPage = import.meta.env.DEV ? lazy(() => import('./pages/RescoTestPage')) : null

export default function App() {
  return (
    <ConfigProvider>
      <AntApp>
        <BrowserRouter>
          <RequireAuth>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/plans" replace />} />
                <Route path="/plans" element={<PlansOverviewPage />} />
                <Route path="/plans/:id" element={<PlanDetailPage />} />
                <Route path="/plans/:id/edit" element={<PlanEditPage />} />
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/partners" element={<PartnerBalancePage />} />
                <Route path="/budget-chart" element={<BudgetChartPage />} />
                <Route path="/execution-chart" element={<ExecutionChartPage />} />
                <Route path="/account-balance" element={<AccountBalancePage />} />
                <Route path="/upload" element={<Navigate to="/review" replace />} />
                <Route path="/review" element={<ReviewPage />} />
                {RescoTestPage && (
                  <Route path="/resco-test" element={<Suspense fallback={null}><RescoTestPage /></Suspense>} />
                )}
                <Route path="/settings" element={<Navigate to="/settings/tags" replace />} />
                <Route path="/settings/tags" element={<SettingsTagsPage />} />
                <Route path="/settings/partners" element={<SettingsPartnersPage />} />
              </Routes>
            </AppLayout>
          </RequireAuth>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  )
}



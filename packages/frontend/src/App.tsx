import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider } from 'antd'
import AppLayout from './components/AppLayout'
import RequireAuth from './components/RequireAuth'
import ReviewPage from './pages/ReviewPage'
import RescoTestPage from './pages/RescoTestPage'
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
                <Route path="/resco-test" element={<RescoTestPage />} />
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



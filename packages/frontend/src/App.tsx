import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider } from 'antd'
import AppLayout from './components/AppLayout'
import RequireAuth from './components/RequireAuth'
import UploadPage from './pages/UploadPage'
import ReviewPage from './pages/ReviewPage'
import RescoTestPage from './pages/RescoTestPage'
import PlansOverviewPage from './pages/PlansOverviewPage'
import TransactionsPage from './pages/TransactionsPage'
import PartnerBalancePage from './pages/PartnerBalancePage'
import BudgetChartPage from './pages/BudgetChartPage'

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
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/partners" element={<PartnerBalancePage />} />
                <Route path="/budget-chart" element={<BudgetChartPage />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/review" element={<ReviewPage />} />
                <Route path="/resco-test" element={<RescoTestPage />} />
              </Routes>
            </AppLayout>
          </RequireAuth>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  )
}



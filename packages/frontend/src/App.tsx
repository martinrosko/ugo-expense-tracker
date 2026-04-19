import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider } from 'antd'
import AppLayout from './components/AppLayout'
import RequireAuth from './components/RequireAuth'
import UploadPage from './pages/UploadPage'
import ReviewPage from './pages/ReviewPage'
import RescoTestPage from './pages/RescoTestPage'

export default function App() {
  return (
    <ConfigProvider>
      <AntApp>
        <BrowserRouter>
          <RequireAuth>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/upload" replace />} />
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



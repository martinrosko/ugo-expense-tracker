import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider } from 'antd'
import AppLayout from './components/AppLayout'
import UploadPage from './pages/UploadPage'
import ReviewPage from './pages/ReviewPage'

export default function App() {
  return (
    <ConfigProvider>
      <AntApp>
        <BrowserRouter>
          <AppLayout>
            <Routes>
              <Route path="/" element={<Navigate to="/upload" replace />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/review" element={<ReviewPage />} />
            </Routes>
          </AppLayout>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  )
}



import { Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'

export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

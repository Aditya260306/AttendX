import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Attendance from './pages/Attendance';
import Employees from './pages/Employees';
import Devices from './pages/Devices';
import SyncHistory from './pages/SyncHistory';
import Settings from './pages/Settings';
import GatekeeperGuard from './components/GatekeeperGuard';
import './index.css';

function AppShell() {
  const location = useLocation();
  const isFixed = location.pathname === '/attendance';
  return (
    <div className="app-layout">
      <Sidebar />
      <main className={`main-content${isFixed ? ' layout-fixed' : ''}`}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/sync-history" element={<SyncHistory />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <GatekeeperGuard>
      <AppShell />
      </GatekeeperGuard>
    </BrowserRouter>
  );
}

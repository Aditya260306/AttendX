import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Users, Clock, Monitor,
  Settings, History, Fingerprint
} from 'lucide-react';
import { supabase } from '../lib/supabase';

const navSections = [
  { title: 'Overview', items: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/attendance', icon: Clock, label: 'Attendance' },
    { to: '/employees', icon: Users, label: 'Employees' },
  ]},
  { title: 'Devices', items: [
    { to: '/devices', icon: Monitor, label: 'Machines' },
    { to: '/sync-history', icon: History, label: 'Sync Log' },
  ]},
  { title: 'System', items: [
    { to: '/settings', icon: Settings, label: 'Settings' },
  ]},
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="logo-icon"><Fingerprint size={15} /></div>
          <div>
            <h1>AttendX</h1>
            <span>K30 Pro</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navSections.map(s => (
          <div className="nav-section" key={s.title}>
            <div className="nav-section-title">{s.title}</div>
            {s.items.map(item => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                {({ isActive }) => (
                  <motion.div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}
                    whileHover={{ x: 2 }} transition={{ duration: 0.15 }}>
                    <item.icon className="nav-icon" size={15} />
                    <span>{item.label}</span>
                  </motion.div>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

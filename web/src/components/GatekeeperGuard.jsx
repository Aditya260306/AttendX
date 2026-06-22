import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Fingerprint, Loader, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * GatekeeperGuard — wraps the app and shows a lockout screen until
 * the designated HR gatekeeper employee punches in for the day.
 *
 * Logic:
 * 1. Fetch attendance_rules to check if gatekeeper_enabled and who the gatekeeper is.
 * 2. If disabled or no gatekeeper set → render children normally.
 * 3. If enabled → check raw_punches for today for that enroll_number.
 * 4. If found → unlocked, auto-trigger sync of all devices.
 * 5. If not found → show lockout screen, subscribe to realtime for that punch.
 */
export default function GatekeeperGuard({ children }) {
  // The attendance_rules table has been removed from the schema.
  // Gatekeeper is disabled by default to prevent lockout.
  return children;
}

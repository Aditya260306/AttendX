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
  const [status, setStatus] = useState('loading'); // loading | unlocked | locked
  const [gkName, setGkName] = useState('');
  const [syncing, setSyncing] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    checkGatekeeper();
  }, []);

  async function checkGatekeeper() {
    const { data: rules } = await supabase
      .from('attendance_rules')
      .select('gatekeeper_enabled, gatekeeper_enroll_number')
      .single();

    // If gatekeeper not configured or disabled → pass through
    if (!rules?.gatekeeper_enabled || !rules?.gatekeeper_enroll_number) {
      setStatus('unlocked');
      return;
    }

    const enrollNum = rules.gatekeeper_enroll_number;

    // Fetch gatekeeper name
    const { data: emp } = await supabase
      .from('employees')
      .select('name')
      .eq('enroll_number', enrollNum)
      .single();
    setGkName(emp?.name || `Employee #${enrollNum}`);

    // Check if already punched in today
    const { data: punch } = await supabase
      .from('raw_punches')
      .select('id')
      .eq('enroll_number', enrollNum)
      .gte('punch_time', `${today} 00:00:00`)
      .lte('punch_time', `${today} 23:59:59`)
      .limit(1)
      .maybeSingle();

    if (punch) {
      setStatus('unlocked');
      return;
    }

    setStatus('locked');

    // Subscribe to realtime — unlock the moment the punch arrives
    const channel = supabase
      .channel('gatekeeper_punch')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'raw_punches',
        filter: `enroll_number=eq.${enrollNum}`,
      }, (payload) => {
        const punchTime = payload.new?.punch_time || '';
        if (punchTime >= `${today} 00:00:00`) {
          supabase.removeChannel(channel);
          handleUnlock();
        }
      })
      .subscribe();
  }

  async function handleUnlock() {
    setStatus('unlocking');
    setSyncing(true);

    // Auto-sync all devices on unlock
    try {
      const { data: devices } = await supabase
        .from('devices')
        .select('id')
        .eq('is_active', true);

      if (devices) {
        await Promise.all(devices.map(d =>
          supabase.from('device_commands').insert({
            device_id: d.id,
            command_type: 'sync_attendance',
            created_by: 'gatekeeper',
          })
        ));
      }
    } catch (_) {}

    setSyncing(false);
    setStatus('unlocked');
  }

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <Loader size={24} className="spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (status === 'unlocked') return children;

  // Locked screen
  return (
    <AnimatePresence mode="wait">
      {(status === 'locked' || status === 'unlocking') && (
        <motion.div
          key="lockout"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.4 }}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100vh',
            background: 'var(--bg)', gap: 24,
          }}
        >
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--accent), var(--accent-2, #7c3aed))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 0 8px var(--accent-bg)',
            }}
          >
            <Fingerprint size={32} color="#fff" />
          </motion.div>

          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            style={{ textAlign: 'center' }}
          >
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              AttendX is Locked
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-2)', maxWidth: 340 }}>
              Waiting for <strong style={{ color: 'var(--text)' }}>{gkName}</strong> to punch in for today.
              The system will unlock automatically.
            </p>
          </motion.div>

          {/* Pulse animation */}
          <motion.div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                style={{
                  position: 'absolute', borderRadius: '50%',
                  border: '2px solid var(--accent)', opacity: 0,
                }}
                animate={{ width: [20, 80], height: [20, 80], opacity: [0.6, 0] }}
                transition={{ repeat: Infinity, duration: 2, delay: i * 0.6, ease: 'easeOut' }}
              />
            ))}
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)' }} />
          </motion.div>

          {syncing && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: 'var(--accent)' }}
            >
              <RefreshCw size={13} className="spin" /> Syncing devices...
            </motion.div>
          )}

          <motion.button
            className="btn btn-secondary"
            style={{ marginTop: 8, fontSize: '0.78rem' }}
            onClick={checkGatekeeper}
            whileTap={{ scale: 0.96 }}
          >
            Check Again
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

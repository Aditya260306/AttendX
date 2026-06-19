require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const config = {
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  machines: [],
  sync: {
    intervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES) || 5,
    heartbeatSeconds: parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS) || 60,
    commandPollSeconds: parseInt(process.env.COMMAND_POLL_INTERVAL_SECONDS) || 10,
  },
  agentId: `attendx-agent-${require('os').hostname()}`,
};

// Dynamically load machine configs from env
for (let i = 1; i <= 10; i++) {
  const name = process.env[`MACHINE_${i}_NAME`];
  const ip = process.env[`MACHINE_${i}_IP`];
  if (!name || !ip) break;

  config.machines.push({
    name,
    ip,
    port: parseInt(process.env[`MACHINE_${i}_PORT`]) || 4370,
    commKey: parseInt(process.env[`MACHINE_${i}_COMM_KEY`]) || 0,
    machineId: parseInt(process.env[`MACHINE_${i}_ID`]) || i,
  });
}

// Validate
if (!config.supabase.url || !config.supabase.serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (config.machines.length === 0) {
  console.error('❌ No machines configured in .env (need MACHINE_1_NAME, MACHINE_1_IP, etc.)');
  process.exit(1);
}

module.exports = config;

/**
 * AttendX — Connection Test Script v2
 * Better error handling for node-zklib quirks
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const ZKLib = require('node-zklib');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const machines = [
  { name: process.env.MACHINE_1_NAME, ip: process.env.MACHINE_1_IP, port: parseInt(process.env.MACHINE_1_PORT) || 4370, commKey: parseInt(process.env.MACHINE_1_COMM_KEY) || 0 },
  { name: process.env.MACHINE_2_NAME, ip: process.env.MACHINE_2_IP, port: parseInt(process.env.MACHINE_2_PORT) || 4370, commKey: parseInt(process.env.MACHINE_2_COMM_KEY) || 0 },
];

async function testSupabase() {
  console.log('\n━━━ TEST 1: Supabase Connection ━━━');
  console.log(`  URL: ${SUPABASE_URL}`);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await supabase.from('devices').select('id, name, ip_address, port').order('id');

    if (error) {
      console.log(`  ❌ FAILED: ${error.message}`);
      return false;
    }

    console.log(`  ✅ Connected to Supabase!`);
    console.log(`  📋 Devices in database: ${data.length}`);
    data.forEach(d => console.log(`     • ${d.name} — ${d.ip_address}:${d.port} (DB ID: ${d.id})`));
    return true;
  } catch (err) {
    console.log(`  ❌ FAILED: ${err.message}`);
    return false;
  }
}

async function testMachine(machine) {
  console.log(`\n━━━ TEST: Machine "${machine.name}" (${machine.ip}:${machine.port}) ━━━`);

  const zk = new ZKLib(machine.ip, machine.port, 5000, 4000, machine.commKey);

  try {
    await zk.createSocket();
    console.log(`  ✅ TCP Connected!`);
  } catch (err) {
    console.log(`  ❌ TCP Connection FAILED: ${err.message}`);
    console.log(`  💡 Check: Is the machine powered on? Is ${machine.ip} reachable on your network?`);
    return false;
  }

  // Test getInfo (wrapped safely)
  try {
    const info = await zk.getInfo();
    if (info) {
      console.log(`  📟 Device Info:`);
      Object.entries(info).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') console.log(`     • ${key}: ${val}`);
      });
    } else {
      console.log(`  ℹ️  getInfo returned empty (normal for some firmware)`);
    }
  } catch (e) {
    console.log(`  ℹ️  getInfo: ${e.message || 'not supported by firmware'}`);
  }

  // Test getUsers (wrapped safely)
  try {
    const users = await zk.getUsers();
    const userList = users?.data || users || [];
    console.log(`  👤 Users registered: ${userList.length}`);
    if (userList.length > 0) {
      const show = userList.slice(0, 5);
      show.forEach(u => console.log(`     • UID:${u.uid} — ${u.name || 'No name'} (ID: ${u.userId || u.userid || '-'})`));
      if (userList.length > 5) console.log(`     ... and ${userList.length - 5} more`);
    }
  } catch (e) {
    console.log(`  ℹ️  getUsers: ${e.message || 'not supported'}`);
  }

  // Test getAttendances (wrapped safely — this is where it crashed before)
  try {
    const att = await zk.getAttendances();
    const attList = att?.data || att || [];
    console.log(`  📊 Attendance records on device: ${attList.length}`);
    if (attList.length > 0) {
      const sample = attList[0];
      console.log(`  📎 Sample record: ${JSON.stringify(sample)}`);
    }
  } catch (e) {
    console.log(`  ℹ️  getAttendances: ${e.message || 'not supported / empty'}`);
  }

  // Disconnect
  try {
    await zk.disconnect();
    console.log(`  ✅ Disconnected cleanly.`);
  } catch (_) {
    console.log(`  ℹ️  Disconnect: already closed`);
  }

  return true;
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   AttendX — Connection Test v2                   ║');
  console.log('╚══════════════════════════════════════════════════╝');

  const supabaseOk = await testSupabase();

  let machineResults = [];
  for (const m of machines) {
    if (m.name && m.ip) {
      let ok = false;
      try {
        ok = await testMachine(m);
      } catch (err) {
        console.log(`  ❌ Unexpected error: ${err.message}`);
      }
      machineResults.push({ name: m.name, ok });
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Supabase:  ${supabaseOk ? '✅ OK' : '❌ FAILED'}`);
  machineResults.forEach(r => console.log(`  ${r.name.padEnd(10)} ${r.ok ? '✅ Connected' : '❌ Failed'}`));
  console.log('');

  process.exit(0);
}

run();

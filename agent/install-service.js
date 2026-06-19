/**
 * One-click Windows Service installer for AttendX Agent.
 * Run: node install-service.js
 */
const path = require('path');
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'AttendX Agent',
  description: 'ESSL K30 Pro Attendance Machine Sync Agent — syncs attendance data to Supabase cloud.',
  script: path.join(__dirname, 'src', 'index.js'),
  nodeOptions: [],
  workingDirectory: __dirname,
  // Auto restart on failure
  wait: 2,          // 2 seconds between restarts
  grow: 0.5,        // 50% growth in wait time per retry
  maxRestarts: 999,  // practically unlimited
});

svc.on('install', () => {
  console.log('\n  ✅ AttendX Agent installed as Windows Service!');
  console.log('  ℹ️  Starting the service...\n');
  svc.start();
});

svc.on('start', () => {
  console.log('  ✅ Service started successfully!');
  console.log('  ℹ️  The agent will now run in the background and survive reboots.');
  console.log('  ℹ️  Check Windows Services (services.msc) for "AttendX Agent"\n');
});

svc.on('alreadyinstalled', () => {
  console.log('  ⚠️  Service is already installed. Run uninstall-service.js first to reinstall.\n');
});

svc.on('error', (err) => {
  console.error('  ❌ Error:', err);
});

console.log('\n  🔧 Installing AttendX Agent as Windows Service...\n');
svc.install();

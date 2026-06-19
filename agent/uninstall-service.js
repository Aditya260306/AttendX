/**
 * Uninstall the AttendX Agent Windows Service.
 * Run: node uninstall-service.js
 */
const path = require('path');
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'AttendX Agent',
  script: path.join(__dirname, 'src', 'index.js'),
});

svc.on('uninstall', () => {
  console.log('\n  ✅ AttendX Agent service uninstalled successfully.\n');
});

svc.on('error', (err) => {
  console.error('  ❌ Error:', err);
});

console.log('\n  🔧 Uninstalling AttendX Agent service...\n');
svc.uninstall();

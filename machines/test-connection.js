require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const net = require('net');

const devices = [
  { name: process.env.MACHINE_1_NAME, ip: process.env.MACHINE_1_IP, port: process.env.MACHINE_1_PORT || 4370 },
  { name: process.env.MACHINE_2_NAME, ip: process.env.MACHINE_2_IP, port: process.env.MACHINE_2_PORT || 4370 }
];

console.log('Testing network connectivity to devices on port 4370...\n');

devices.forEach(device => {
  if (!device.ip) return;
  const socket = new net.Socket();
  socket.setTimeout(3000); // 3 seconds timeout

  console.log(`Pinging [${device.name}] at ${device.ip}:${device.port}...`);

  socket.connect(device.port, device.ip, () => {
    console.log(`✅ SUCCESS: [${device.name}] is online and reachable at ${device.ip}:${device.port}!`);
    socket.destroy();
  });

  socket.on('timeout', () => {
    console.log(`❌ TIMEOUT: [${device.name}] did not respond at ${device.ip}:${device.port}.`);
    socket.destroy();
  });

  socket.on('error', (err) => {
    console.log(`❌ ERROR: [${device.name}] connection failed at ${device.ip}:${device.port} (${err.message})`);
    socket.destroy();
  });
});

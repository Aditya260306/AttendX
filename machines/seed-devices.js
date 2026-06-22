require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function seed() {
  const devices = [
    {
      name: process.env.MACHINE_1_NAME,
      ip_address: process.env.MACHINE_1_IP,
      port: parseInt(process.env.MACHINE_1_PORT),
      comm_key: parseInt(process.env.MACHINE_1_COMM_KEY),
      machine_id: parseInt(process.env.MACHINE_1_ID),
      serial_number: 'SN_OFFICE_1', // Dummy SN until real ADMS connection
      status: 'disconnected'
    },
    {
      name: process.env.MACHINE_2_NAME,
      ip_address: process.env.MACHINE_2_IP,
      port: parseInt(process.env.MACHINE_2_PORT),
      comm_key: parseInt(process.env.MACHINE_2_COMM_KEY),
      machine_id: parseInt(process.env.MACHINE_2_ID),
      serial_number: 'SN_FACTORY_2', // Dummy SN until real ADMS connection
      status: 'disconnected'
    }
  ];

  for (const device of devices) {
    const { data, error } = await supabase
      .from('devices')
      .upsert(device, { onConflict: 'serial_number' });
    
    if (error) {
      console.error('Error seeding device:', device.name, error);
    } else {
      console.log('Seeded device:', device.name);
    }
  }
}

seed();

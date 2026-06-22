require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data: devices } = await supabase.from('devices').select('*');
    console.log('--- DEVICES IN DATABASE ---');
    console.table(devices);

    const { data: commands } = await supabase.from('device_commands').select('*').order('created_at', { ascending: false }).limit(5);
    console.log('--- LATEST DEVICE COMMANDS ---');
    console.table(commands);

    const { data: queue } = await supabase.from('adms_queue').select('*').order('created_at', { ascending: false }).limit(5);
    console.log('--- LATEST ADMS QUEUE ---');
    console.table(queue);
}
check();

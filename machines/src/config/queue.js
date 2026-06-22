const { supabase } = require('./supabase');
const crypto = require('crypto');

const WORKER_ID = `worker-${crypto.randomUUID()}`;

/**
 * Pushes a new payload into the Supabase message queue
 */
async function enqueueMessage(deviceSn, tableName, payload, priority = 10) {
    const { error } = await supabase.from('message_queue').insert({
        device_sn: deviceSn,
        table_name: tableName,
        payload: payload,
        priority: priority,
        status: 'pending'
    });

    if (error) {
        console.error(`[QUEUE] Failed to enqueue message for SN: ${deviceSn}`, error);
        throw error;
    }
}

/**
 * Atomically dequeues a single message using the safe SKIP LOCKED RPC
 */
async function dequeueMessage() {
    const { data, error } = await supabase.rpc('dequeue_message', { p_worker_id: WORKER_ID });
    
    if (error) {
        console.error('[QUEUE] Error dequeuing message', error);
        return null;
    }

    if (data && data.length > 0) {
        return data[0]; // Returns { id, device_sn, table_name, payload, priority }
    }
    
    return null;
}

/**
 * Marks a message as completed
 */
async function completeMessage(messageId) {
    const { error } = await supabase.from('message_queue').update({
        status: 'completed',
        updated_at: new Date().toISOString()
    }).eq('id', messageId);

    if (error) console.error(`[QUEUE] Failed to complete message ${messageId}`, error);
}

/**
 * Marks a message as failed. If it fails too many times, it stays in failed state (DLQ).
 */
async function failMessage(messageId, errorMessage) {
    // Increment retry count
    const { data } = await supabase.from('message_queue').select('retry_count').eq('id', messageId).single();
    const retries = (data?.retry_count || 0) + 1;
    
    const newStatus = retries >= 3 ? 'failed' : 'pending'; // DLQ after 3 fails

    const { error } = await supabase.from('message_queue').update({
        status: newStatus,
        retry_count: retries,
        error_message: errorMessage,
        locked_at: null, // Release lock so it can be retried if pending
        locked_by: null,
        updated_at: new Date().toISOString()
    }).eq('id', messageId);

    if (error) console.error(`[QUEUE] Failed to fail message ${messageId}`, error);
}

module.exports = {
    WORKER_ID,
    enqueueMessage,
    dequeueMessage,
    completeMessage,
    failMessage
};

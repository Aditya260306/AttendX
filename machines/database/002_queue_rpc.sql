-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SUPABASE SQL EDITOR NAME: 002_queue_rpc
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Description: Stored procedure for safely dequeuing messages 
-- using row-level locking (SKIP LOCKED) to prevent race 
-- conditions among multiple background workers.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION public.dequeue_message(p_worker_id TEXT)
RETURNS TABLE (
    id BIGINT,
    device_sn VARCHAR,
    table_name VARCHAR,
    payload TEXT,
    priority INTEGER
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH next_message AS (
        SELECT mq.id
        FROM public.message_queue mq
        WHERE mq.status = 'pending'
           OR (mq.status = 'processing' AND mq.locked_at < NOW() - INTERVAL '5 minutes') -- Recover stalled
        ORDER BY mq.priority ASC, mq.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    UPDATE public.message_queue
    SET status = 'processing',
        locked_at = NOW(),
        locked_by = p_worker_id,
        updated_at = NOW()
    FROM next_message
    WHERE public.message_queue.id = next_message.id
    RETURNING 
        public.message_queue.id,
        public.message_queue.device_sn,
        public.message_queue.table_name,
        public.message_queue.payload,
        public.message_queue.priority;
END;
$$;

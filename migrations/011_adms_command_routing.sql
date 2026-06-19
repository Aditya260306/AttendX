-- Migration: ADMS command routing and cleanup
-- Device-management commands now use payload.transport = 'adms' so the ADMS
-- HTTP server owns them and the legacy LAN agent does not consume them.

UPDATE public.device_commands
SET status = 'pending'
WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_device_commands_transport
ON public.device_commands ((payload->>'transport'))
WHERE status = 'pending';

COMMENT ON COLUMN public.device_commands.payload IS
  'Command options. Use payload.transport = adms for ADMS/iclock HTTP devices, or lan for legacy direct TCP agent commands.';

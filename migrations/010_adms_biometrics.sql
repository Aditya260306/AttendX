-- Migration: Create biometrics table for ADMS fingerprint templates
-- This allows us to securely store base64 encoded fingerprint templates and sync them across machines.

CREATE TABLE IF NOT EXISTS public.biometrics (
    id SERIAL PRIMARY KEY,
    enroll_number INTEGER NOT NULL REFERENCES public.employees(enroll_number) ON DELETE CASCADE,
    finger_index INTEGER NOT NULL, -- 0-9 for fingerprints, sometimes 10+ for face/palm
    template_type INTEGER NOT NULL DEFAULT 1, -- Usually 1 for fingerprint, sometimes 10 for ZK10.0
    template_data TEXT NOT NULL, -- Base64 encoded raw template blob
    valid INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(enroll_number, finger_index)
);

-- Index for fast lookup when syncing users to a new device
CREATE INDEX idx_biometrics_enroll_number ON public.biometrics(enroll_number);

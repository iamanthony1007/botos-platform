import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://rydkwsjwlgnivlwlvqku.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5ZGt3c2p3bGduaXZsd2x2cWt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDA1ODEsImV4cCI6MjA5MTA3NjU4MX0.8Th4ObB8I22BgbedX8_S1CAdSlAAZ3nXk8ScA7164G4'
)
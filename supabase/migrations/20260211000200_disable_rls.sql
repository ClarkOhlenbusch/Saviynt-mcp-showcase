-- Disable RLS to simplify the setup for the user
-- This will allow anyone with the URL and Anon Key to perform operations
alter table api_keys disable row level security;

-- Drop previous policies just to be clean
drop policy if exists "Allow anonymous select" on api_keys;
drop policy if exists "Allow anonymous insert" on api_keys;

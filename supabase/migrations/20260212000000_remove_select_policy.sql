-- Remove the select policy so API keys cannot be read back from the database.
-- Keys are write-only: stored for record-keeping but never surfaced to clients.
drop policy if exists "Allow anonymous select" on api_keys;

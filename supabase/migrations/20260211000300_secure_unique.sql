-- Clean up existing duplicates before adding the constraint
delete from api_keys a
using api_keys b
where a.ctid < b.ctid
  and a.key_value = b.key_value;

-- Add unique constraint to prevent duplicate keys
alter table api_keys add constraint api_keys_key_value_key unique (key_value);

-- Re-enable RLS
alter table api_keys enable row level security;

-- Create policies to allow anonymous insert and select
create policy "Allow anonymous select" on api_keys for select to anon using (true);
create policy "Allow anonymous insert" on api_keys for insert to anon with check (true);

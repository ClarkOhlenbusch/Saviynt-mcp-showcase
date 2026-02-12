-- Enable RLS
alter table api_keys enable row level security;

-- Create policies to allow anonymous access (for simple free database use case)
create policy "Allow anonymous select" on api_keys for select to anon using (true);
create policy "Allow anonymous insert" on api_keys for insert to anon with check (true);

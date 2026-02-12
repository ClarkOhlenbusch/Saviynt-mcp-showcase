-- Create api_keys table
create table if not exists api_keys (
  id uuid default gen_random_uuid() primary key,
  key_value text not null,
  label text,
  created_at timestamptz default now()
);

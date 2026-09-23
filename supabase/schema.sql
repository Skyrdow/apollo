create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 160),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists documents_user_updated on public.documents(user_id, updated_at desc);
alter table public.documents enable row level security;
drop policy if exists "Users manage their own documents" on public.documents;
create policy "Users manage their own documents" on public.documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;

create table if not exists public.banks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 160),
  questions jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.banks enable row level security;
drop policy if exists "Owners manage their banks" on public.banks;
create policy "Owners manage their banks" on public.banks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "Shared banks are readable by link" on public.banks;
create policy "Shared banks are readable by link" on public.banks for select
  using (
    id::text = coalesce(
      current_setting('request.headers', true)::jsonb ->> 'x-share-token',
      ''
    )
  );
revoke all on public.banks from anon;
grant select on public.banks to anon, authenticated;
grant insert, update, delete on public.banks to authenticated;

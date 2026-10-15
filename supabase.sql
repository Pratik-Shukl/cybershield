-- CyberShield database for Supabase. Paste this whole file into Supabase > SQL Editor > Run.
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '', email text, role text not null default 'user', attempts int not null default 0,
  pct_sum int not null default 0, created_at timestamptz default now());
create table if not exists public.topics (id text primary key, position int, icon text, title text not null, intro text, tip text, points jsonb not null default '[]');
create table if not exists public.questions (id bigint generated always as identity primary key, topic_id text not null references public.topics(id) on delete cascade,
  position int, question text not null, options jsonb not null, answer int not null, explanation text);
create table if not exists public.progress (user_id uuid not null references auth.users(id) on delete cascade, topic_id text not null,
  is_read boolean default false, best_score int, primary key (user_id, topic_id));

-- create a profile row automatically for every new account
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles(id, name, email) values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), new.email); return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

-- admin-only helpers (replace all content in one go / delete a user)
create or replace function public.admin_save_content(t jsonb) returns void language plpgsql security definer set search_path = public as $$
declare x jsonb; q jsonb; i int := 0; j int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  delete from public.topics;
  for x in select * from jsonb_array_elements(t) loop
    i := i + 1;
    insert into public.topics(id, position, icon, title, intro, tip, points) values (x->>'id', i, x->>'icon', x->>'title', x->>'intro', x->>'tip', coalesce(x->'points', '[]'::jsonb));
    j := 0;
    for q in select * from jsonb_array_elements(coalesce(x->'quiz', '[]'::jsonb)) loop
      j := j + 1;
      insert into public.questions(topic_id, position, question, options, answer, explanation) values (x->>'id', j, q->>0, q->1, (q->>2)::int, nullif(q->>3, ''));
    end loop;
  end loop;
end $$;
create or replace function public.admin_delete_user(uid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  delete from auth.users where id = uid and id in (select id from public.profiles where role <> 'admin');
end $$;
grant execute on function public.admin_save_content(jsonb), public.admin_delete_user(uuid) to authenticated;

-- security rules (Row Level Security)
alter table public.profiles enable row level security;
alter table public.topics enable row level security;
alter table public.questions enable row level security;
alter table public.progress enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant update (name, attempts, pct_sum) on public.profiles to authenticated;  -- users can never change their own role
drop policy if exists "topics read" on public.topics;
create policy "topics read" on public.topics for select using (true);
drop policy if exists "questions read" on public.questions;
create policy "questions read" on public.questions for select using (true);
drop policy if exists "progress read" on public.progress;
create policy "progress read" on public.progress for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "progress insert" on public.progress;
create policy "progress insert" on public.progress for insert with check (user_id = auth.uid());
drop policy if exists "progress delete" on public.progress;
create policy "progress delete" on public.progress for delete using (user_id = auth.uid());

-- AFTER you register your own account on the site, make it the admin (replace the email, run this line once):
-- update public.profiles set role = 'admin' where email = 'YOUR_EMAIL@example.com';

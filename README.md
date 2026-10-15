# CyberShield - Cyber Security Awareness Website (Supabase version)

Frontend (HTML/CSS/JS) + Supabase (PostgreSQL database + login). No server of your own is needed, so it deploys on GitHub Pages.
Login/Register -> 5 learning modules -> quizzes (10 questions each) -> resources, certificate, profile, admin panel.

## Setup (about 10 minutes, one time)
1. Create a free account and a **New project** on https://supabase.com (remember the database password; wait until the project is ready).
2. **SQL Editor -> New query**: paste the whole file `supabase.sql` -> **Run**. This creates all tables and security rules.
3. **Authentication -> Providers -> Email**: turn **Confirm email OFF** (so students can log in right after registering) -> Save.
4. **Project Settings -> API**: copy the **Project URL** and the **anon public** key into `config.js`.
5. Open the website, **register your own account**. Then in the SQL Editor run this once (use your email) to make yourself the admin:
   `update public.profiles set role = 'admin' where email = 'YOUR_EMAIL@example.com';`
6. Log out and log in again. The Admin panel appears, and the default 5 topics and 50 questions are loaded into the database on your first admin visit.

## Run locally
Use the VS Code *Live Server* extension on `index.html`, or in the folder run `python -m http.server 8000` and open http://localhost:8000. Internet is required.

## Upload to GitHub and deploy (GitHub Pages)
1. Create a repo and upload all files in this folder (`index.html` must be in the repo root).
2. **Settings -> Pages -> Source: Deploy from a branch -> `main` / root -> Save.**
3. After a minute the site is live at `https://<username>.github.io/<repo>/`.

## Database tables
`profiles`, `topics`, `questions`, `progress` (plus Supabase's built-in `auth.users`). Row Level Security makes sure users can only read and
write their own progress, nobody can change their own role, and only the admin can edit topics, questions and delete users.

## Notes
- The anon key in `config.js` is meant to be public; the security rules protect the data. **Never** put the `service_role` key in this project.
- Free Supabase projects pause after about a week of no use. Open the dashboard and click Restore before a demo if that happens.
- `data.js` holds the default content that is loaded into the database; after that the admin panel manages it.

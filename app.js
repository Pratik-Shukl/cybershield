// CyberShield - single page app (hash routing). No backend, so it deploys anywhere.
const app = document.getElementById('app');
const navEl = document.getElementById('nav');

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// demo-level hash (a real project would hash with bcrypt on the server)
const hash = s => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return 'h' + h; };

const DEFAULT_TOPICS = JSON.parse(JSON.stringify(TOPICS)); // fallback until the admin content is saved
const configured = typeof supabase !== 'undefined' && window.CONFIG && !String(CONFIG.SUPABASE_URL).startsWith('YOUR_');
const sb = configured ? supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;
const need = t => Math.ceil(t.quiz.length * 0.7); // pass mark is 70%
const passed = (t, p) => t.quiz.length > 0 && (p.score[t.id] || 0) >= need(t);

let session = null, user = null, prog = { read: {}, score: {} }, adminUsersList = [];
const me = () => user;
const isAdmin = () => !!(user && user.role === 'admin');
const getProg = () => prog;
const progFrom = (rows, prof) => {
  const p = { read: {}, score: {}, att: prof ? prof.attempts : 0, pct: prof ? prof.pct_sum : 0 };
  (rows || []).forEach(x => { if (x.is_read) p.read[x.topic_id] = true; if (x.best_score !== null) p.score[x.topic_id] = x.best_score; });
  return p;
};
// progress writes are queued so they never overlap
let queue = Promise.resolve();
const setProg = p => { prog = p; queue = queue.then(() => pushProg(p)).catch(() => {}); };
async function pushProg(p) {
  if (!user) return;
  const ids = [...new Set([...Object.keys(p.read), ...Object.keys(p.score)])];
  await sb.from('progress').delete().eq('user_id', user.id);
  if (ids.length) await sb.from('progress').insert(ids.map(t => ({ user_id: user.id, topic_id: t, is_read: !!p.read[t], best_score: p.score[t] === undefined ? null : p.score[t] })));
  await sb.from('profiles').update({ attempts: p.att || 0, pct_sum: p.pct || 0 }).eq('id', user.id);
}
const saveContent = async (list = TOPICS) => { const r = await sb.rpc('admin_save_content', { t: list }); if (r.error) alert(r.error.message); };

async function loadAll() {
  const t = await sb.from('topics').select('*').order('position'), q = await sb.from('questions').select('*').order('position');
  if (t.error) throw t.error;
  const rows = t.data.map(r => ({ id: r.id, icon: r.icon, title: r.title, intro: r.intro, tip: r.tip, points: r.points,
    quiz: (q.data || []).filter(x => x.topic_id === r.id).map(x => [x.question, x.options, x.answer, x.explanation || '']) }));
  TOPICS = rows.length ? rows : JSON.parse(JSON.stringify(DEFAULT_TOPICS));
  const s = (await sb.auth.getSession()).data.session;
  if (!s) { user = null; session = null; return; }
  const prof = (await sb.from('profiles').select('*').eq('id', s.user.id).single()).data;
  user = { id: s.user.id, email: s.user.email, name: prof ? prof.name : s.user.email, role: prof ? prof.role : 'user', joined: Date.parse(s.user.created_at) };
  session = user.email;
  prog = progFrom((await sb.from('progress').select('*').eq('user_id', user.id)).data, prof);
  if (isAdmin() && !rows.length) saveContent(); // first admin visit loads the default content into the database
}
async function loadAdminUsers() {
  if (!isAdmin()) { adminUsersList = []; return; }
  const pr = await sb.from('profiles').select('*'), pg = await sb.from('progress').select('*');
  adminUsersList = (pr.data || []).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, progress: progFrom((pg.data || []).filter(x => x.user_id === u.id), u) }));
}

document.body.classList.toggle('light', store.get('cs_theme', 'dark') === 'light');

function overall(p = getProg()) {
  let done = 0, total = 0;
  TOPICS.forEach(t => {
    total++; if (p.read[t.id]) done++;
    if (t.quiz.length) { total++; if (passed(t, p)) done++; }
  });
  return total ? Math.round(done / total * 100) : 0;
}

function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

/* ---------- navbar ---------- */
function renderNav(page) {
  if (!session) { navEl.innerHTML = ''; return; }
  const l = (h, t) => `<a class="lnk ${page === h ? 'on' : ''}" href="#/${h}">${t}</a>`;
  navEl.innerHTML = `<a class="brand" href="#/home">🛡️ Cyber<span>Shield</span></a>
    ${l('home', 'Learn')}${l('resources', 'Resources')}${l('profile', 'Profile')}${isAdmin() ? l('admin', '⚙ Admin') : ''}
    <button id="theme" title="Theme">🌗</button><button id="out">Logout</button>`;
  document.getElementById('theme').onclick = () => {
    const light = !document.body.classList.contains('light');
    document.body.classList.toggle('light', light);
    store.set('cs_theme', light ? 'light' : 'dark');
  };
  document.getElementById('out').onclick = () => {
    sb.auth.signOut();
    session = null; user = null; prog = { read: {}, score: {} }; location.hash = '#/login';
  };
}

/* ---------- auth ---------- */
function authView(mode) {
  const reg = mode === 'register';
  app.innerHTML = `<div class="card auth">
    <h1>🛡️ Cyber<span style="color:var(--acc)">Shield</span></h1>
    <p>${reg ? 'Create an account and start learning.' : 'Log in to learn cyber safety.'}</p>
    ${reg ? '<label>Full name</label><input id="nm" placeholder="Pratik Shukla" autocomplete="name">' : ''}
    <label>Email</label><input id="em" type="email" placeholder="you@example.com" autocomplete="email">
    <label>Password</label><input id="pw" type="password" placeholder="Min 8 characters" autocomplete="${reg ? 'new-password' : 'current-password'}">
    ${reg ? '<div class="meter"><i id="mt"></i></div><p id="ml" style="font-size:13px;margin:0 0 10px"></p>' : ''}
    <div class="err" id="er"></div>
    <button class="btn" id="go" style="width:100%">${reg ? 'Create account' : 'Login'}</button>
    <p style="text-align:center;font-size:14px">${reg ? 'Already have an account? <a href="#/login">Login</a>' : 'New here? <a href="#/register">Register</a>'}</p>
  </div>`;
  const $ = id => document.getElementById(id);
  if (reg) $('pw').oninput = e => {
    const s = strength(e.target.value), c = ['#ff5d73', '#ff5d73', '#ffb347', '#e6d94a', '#22d3a6', '#22d3a6'][s];
    $('mt').style.width = s * 20 + '%'; $('mt').style.background = c;
    $('ml').textContent = e.target.value ? ['Very weak', 'Weak', 'Okay', 'Good', 'Strong', 'Excellent'][s] : '';
  };
  const submit = async () => {
    const email = $('em').value.trim().toLowerCase(), pw = $('pw').value, name = reg ? $('nm').value.trim() : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) return $('er').textContent = 'Enter a valid email.';
    if (reg && name.length < 2) return $('er').textContent = 'Enter your name.';
    if (reg && pw.length < 8) return $('er').textContent = 'Password must be at least 8 characters.';
    try {
      const r = reg ? await sb.auth.signUp({ email, password: pw, options: { data: { name } } }) : await sb.auth.signInWithPassword({ email, password: pw });
      if (r.error) throw r.error;
      if (!r.data.session) { $('er').style.color = 'var(--ok)'; return $('er').textContent = 'Account created. Confirm your email, then log in.'; }
      await loadAll();
      location.hash = isAdmin() ? '#/admin' : '#/home';
    } catch (e) { $('er').style.color = ''; $('er').textContent = e.message; }
  };
  $('go').onclick = submit;
  app.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
}

/* ---------- home ---------- */
function homeView() {
  const p = getProg(), pct = overall();
  app.innerHTML = `<div class="card hero">
      <div class="ring" style="--p:${pct}"><b>${pct}%</b></div>
      <div><h1>Welcome, ${esc(me().name.split(' ')[0])} 👋</h1>
      <p>Read each topic, then take its quiz. Score 70% or more to complete a topic.</p></div></div>
    <h2>Learning modules</h2>
    <div class="grid">${TOPICS.map(t => {
      const best = p.score[t.id];
      return `<a class="card tcard" href="#/topic/${t.id}"><div class="ic">${t.icon}</div><h3>${t.title}</h3>
        <p style="font-size:14px">${t.intro.slice(0, 95)}...</p>
        <span class="tag ${p.read[t.id] ? 'g' : ''}">${p.read[t.id] ? '✓ Read' : 'Not read'}</span>
        <span class="tag ${best >= need(t) ? 'g' : ''}">${!t.quiz.length ? 'No quiz yet' : best === undefined ? 'Quiz pending' : 'Best: ' + best + '/' + t.quiz.length}</span></a>`;
    }).join('')}</div>`;
}

/* ---------- topic ---------- */
function topicView(id) {
  const t = TOPICS.find(x => x.id === id);
  if (!t) return (location.hash = '#/home');
  const done = getProg().read[id];
  app.innerHTML = `<div class="crumb"><a href="#/home">Learn</a> / ${t.title}</div>
    <div class="card"><h1>${t.icon} ${t.title}</h1><p>${t.intro}</p></div>
    <div class="card">${t.points.map((pt, i) => `<div class="pt"><div class="n">${i + 1}</div>
      <div><h3>${pt[0]}</h3><p>${pt[1]}</p></div></div>${i < t.points.length - 1 ? '<hr style="border:0;border-top:1px solid var(--bd);margin:14px 0">' : ''}`).join('')}
      <div class="tip">💡 <b>Remember:</b> ${t.tip}</div></div>
    <div class="row"><button class="btn ghost" id="rd">${done ? '✓ Marked as read' : 'Mark as read'}</button>
    ${t.quiz.length ? `<a class="btn" href="#/quiz/${id}">Take the quiz →</a>` : ''}</div>`;
  document.getElementById('rd').onclick = e => {
    const p = getProg(); p.read[id] = true; setProg(p); e.target.textContent = '✓ Marked as read';
  };
}

/* ---------- quiz ---------- */
function quizView(id) {
  const t = TOPICS.find(x => x.id === id);
  if (!t || !t.quiz.length) return (location.hash = '#/home');
  let i = 0, picked = [];
  // questions and options are shuffled on every attempt
  const mk = () => t.quiz.map(x => { const o = [0, 1, 2, 3].sort(() => Math.random() - .5); return [x[0], o.map(n => x[1][n]), o.indexOf(x[2]), x[3]]; }).sort(() => Math.random() - .5);
  let qs = mk();
  const draw = () => {
    const q = qs[i];
    app.innerHTML = `<div class="crumb"><a href="#/home">Learn</a> / <a href="#/topic/${id}">${t.title}</a> / Quiz</div>
      <div class="card"><div class="bar"><i style="width:${i / qs.length * 100}%"></i></div>
      <p style="margin:0">Question ${i + 1} of ${qs.length}</p><h2>${esc(q[0])}</h2>
      ${q[1].map((o, k) => `<button class="opt ${picked[i] === k ? 'sel' : ''}" data-k="${k}">${esc(o)}</button>`).join('')}
      <div class="row" style="margin-top:14px"><button class="btn ghost" id="pv" ${i === 0 ? 'disabled style="opacity:.4"' : ''}>← Back</button>
      <button class="btn" id="nx" ${picked[i] === undefined ? 'disabled style="opacity:.5"' : ''}>${i === qs.length - 1 ? 'Submit' : 'Next →'}</button></div></div>`;
    app.querySelectorAll('.opt').forEach(b => b.onclick = () => { picked[i] = +b.dataset.k; draw(); });
    document.getElementById('pv').onclick = () => { if (i > 0) { i--; draw(); } };
    document.getElementById('nx').onclick = () => { if (picked[i] === undefined) return; i === qs.length - 1 ? result() : (i++, draw()); };
  };
  const result = () => {
    const score = qs.reduce((s, q, k) => s + (picked[k] === q[2] ? 1 : 0), 0), p = getProg();
    p.score[id] = Math.max(score, p.score[id] || 0);
    p.att = (p.att || 0) + 1; p.pct = (p.pct || 0) + Math.round(score / qs.length * 100); setProg(p);
    const ok = score >= need(t);
    app.innerHTML = `<div class="card" style="text-align:center"><div style="font-size:54px">${ok ? '🏆' : '📚'}</div>
      <h1>${score} / ${qs.length}</h1><p>${ok ? 'Great job! You passed this module.' : `You need ${need(t)} to pass. Re-read the topic and try again.`}</p>
      <a class="btn" href="#/home">Dashboard</a> <a class="btn ghost" href="#/topic/${id}">Re-read</a> <button class="btn ghost" id="rt">Retry</button></div>
      <h2>Answer review</h2>${qs.map((q, k) => `<div class="card"><b>${k + 1}. ${esc(q[0])}</b>
      ${q[1].map((o, j) => `<div class="opt ${j === q[2] ? 'right' : (j === picked[k] ? 'wrong' : '')}">${esc(o)}</div>`).join('')}${q[3] ? `<p>💡 ${esc(q[3])}</p>` : ''}</div>`).join('')}`;
    document.getElementById('rt').onclick = () => { i = 0; picked = []; qs = mk(); draw(); window.scrollTo(0, 0); };
    window.scrollTo(0, 0);
  };
  draw();
}

/* ---------- resources ---------- */
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
// simple heuristic link checker (for awareness only, not 100% accurate)
function checkLink(raw) {
  const flags = []; let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw); } catch (e) { return ['This does not look like a valid URL.']; }
  const h = u.hostname;
  if (u.protocol !== 'https:') flags.push('Not using HTTPS.');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) flags.push('Uses an IP address instead of a domain name.');
  if (h.includes('xn--')) flags.push('Punycode domain (may contain look-alike characters).');
  if (h.split('.').length > 4) flags.push('Too many subdomains.');
  if ((h.match(/-/g) || []).length >= 2) flags.push('Too many hyphens in the domain.');
  if (/(login|verify|secure|update|account|kyc|bank)/i.test(h)) flags.push('Domain contains sensitive keywords (login/verify/kyc...).');
  if (/[01]/.test(h.split('.')[0]) && /[a-z]/i.test(h.split('.')[0])) flags.push('Letters may be swapped with numbers (like paypa1).');
  if (/\.(zip|xyz|top|click|tk)$/i.test(h)) flags.push('Risky domain extension.');
  if (u.href.includes('@')) flags.push('The URL contains "@", which can hide the real destination.');
  return flags;
}
function resourcesView() {
  app.innerHTML = `<h1>📚 Resources</h1>
    <div class="card"><h2>Downloadable checklists</h2><p>Print them or keep them on your phone.</p>
      <div class="row" style="justify-content:flex-start">${TOPICS.map(t => `<button class="btn ghost dl" data-id="${t.id}">⬇ ${t.title}</button>`).join('')}</div></div>
    <div class="card"><h2>🔎 Link checker</h2><p>Paste a suspicious link to check it. The link is not opened; only its pattern is checked.</p>
      <input id="lk" placeholder="http://sbi-kyc-update.xyz/login"><button class="btn" id="ck">Check</button><div id="lr" style="margin-top:12px"></div></div>
    <div class="card"><h2>Trusted links</h2>${RESOURCES.map(r => `<p><a href="${r.url}" target="_blank" rel="noopener noreferrer"><b>${r.name}</b></a><br>${r.desc}</p>`).join('')}</div>`;
  app.querySelectorAll('.dl').forEach(b => b.onclick = () => {
    const t = TOPICS.find(x => x.id === b.dataset.id);
    download(t.id + '-checklist.txt', `${t.title.toUpperCase()} - CHECKLIST\n\n` + t.points.map(p => `[ ] ${p[0]}\n    ${p[1]}`).join('\n\n') + `\n\nTip: ${t.tip}\n\nCyberShield`);
  });
  document.getElementById('ck').onclick = () => {
    const v = document.getElementById('lk').value.trim(); if (!v) return;
    const f = checkLink(v);
    document.getElementById('lr').innerHTML = f.length
      ? `<div class="tip" style="border-color:var(--bad)">⚠️ <b>${f.length} warning(s):</b><br>${f.map(x => '• ' + esc(x)).join('<br>')}</div>`
      : '<div class="tip">✅ No major red flag found, but stay cautious.</div>';
  };
}

/* ---------- profile ---------- */
function profileView() {
  const u = me(), p = getProg();
  const nPassed = TOPICS.filter(t => passed(t, p)).length;
  app.innerHTML = `<h1>👤 Profile</h1><div class="card"><h2>${esc(u.name)}</h2><p>${esc(session)}<br>Joined: ${new Date(u.joined).toLocaleDateString()}</p>
    <span class="tag g">Overall ${overall()}%</span><span class="tag">Topics read: ${Object.keys(p.read).length}/${TOPICS.length}</span><span class="tag">Quizzes passed: ${nPassed}/${TOPICS.filter(t => t.quiz.length).length}</span></div>
    <div class="card"><h3>Quiz scores</h3>${TOPICS.map(t => `<p>${t.icon} ${t.title}: <b>${p.score[t.id] === undefined ? '-' : p.score[t.id] + '/' + t.quiz.length}</b></p>`).join('')}
    <button class="btn ghost" id="rs">Reset my progress</button></div>
    <div class="card"><h3>Edit profile</h3><label>Name</label><input id="en" value="${esc(u.name)}">
    <label>New password (leave blank to keep the current one)</label><input id="ep" type="password"><div class="err" id="pe"></div>
    <button class="btn" id="sp">Save changes</button></div>
    ${nPassed > 0 && nPassed === TOPICS.filter(t => t.quiz.length).length ? '<div class="card"><h3>🎓 Certificate</h3><p>You passed every module. Download your certificate.</p><button class="btn" id="cert">Download certificate</button></div>' : ''}`;
  document.getElementById('sp').onclick = async () => {
    const nm = document.getElementById('en').value.trim(), pw = document.getElementById('ep').value, er = document.getElementById('pe');
    if (nm.length < 2) return er.textContent = 'Enter your name.';
    if (pw && pw.length < 8) return er.textContent = 'Password must be at least 8 characters.';
    try {
      const r = await sb.auth.updateUser(pw ? { password: pw, data: { name: nm } } : { data: { name: nm } });
      if (r.error) throw r.error;
      await sb.from('profiles').update({ name: nm }).eq('id', user.id);
      if (!session) return; user.name = nm; renderNav('profile'); profileView();
    }
    catch (e) { er.textContent = e.message; }
  };
  const cb = document.getElementById('cert'); if (cb) cb.onclick = () => certificate(u.name);
  document.getElementById('rs').onclick = () => { if (confirm('All your progress will be deleted. Are you sure?')) { setProg({ read: {}, score: {} }); profileView(); } };
}

/* ---------- admin panel ---------- */
let aTab = 'stats', aTopic = null, aEdit = -1;
function adminView() {
  if (!TOPICS.find(t => t.id === aTopic)) aTopic = TOPICS.length ? TOPICS[0].id : null;
  const tabs = [['stats', 'Overview'], ['quiz', 'Quizzes'], ['topics', 'Topics'], ['users', 'Users']];
  app.innerHTML = `<h1>⚙ Admin Panel</h1>
    <div class="row" style="justify-content:flex-start;margin-bottom:14px">${tabs.map(t => `<button class="btn ${aTab === t[0] ? '' : 'ghost'}" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div><div id="ab"></div>`;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { aTab = b.dataset.tab; aEdit = -1; adminView(); });
  loadAdminUsers().then(() => ({ stats: adminStats, quiz: adminQuiz, topics: adminTopics, users: adminUsers }[aTab])());
}

function adminQuiz() {
  const box = document.getElementById('ab'), t = TOPICS.find(x => x.id === aTopic);
  if (!t) { box.innerHTML = '<div class="card"><p>Create a topic in the Topics tab first.</p></div>'; return; }
  const q = aEdit >= 0 ? t.quiz[aEdit] : ['', ['', '', '', ''], 0];
  box.innerHTML = `<div class="card"><label>Topic</label><select id="tp">${TOPICS.map(x => `<option value="${x.id}" ${x.id === aTopic ? 'selected' : ''}>${esc(x.title)} (${x.quiz.length} questions)</option>`).join('')}</select></div>
    <div class="card"><h3>${aEdit >= 0 ? 'Edit question ' + (aEdit + 1) : 'Add new question'}</h3>
      <label>Question</label><input id="qq" value="${esc(q[0])}">
      ${q[1].map((o, i) => `<label>Option ${i + 1}</label><input class="qo" value="${esc(o)}">`).join('')}
      <label>Correct option</label><select id="qa">${[0, 1, 2, 3].map(i => `<option value="${i}" ${q[2] === i ? 'selected' : ''}>Option ${i + 1}</option>`).join('')}</select>
      <label>Explanation (optional, shown in the answer review)</label><input id="qx" value="${esc(q[3] || '')}">
      <div class="err" id="er"></div>
      <button class="btn" id="sv">${aEdit >= 0 ? 'Update question' : 'Add question'}</button> ${aEdit >= 0 ? '<button class="btn ghost" id="cn">Cancel</button>' : ''}</div>
    <div class="card"><h3>Questions (${t.quiz.length})</h3>${t.quiz.map((x, i) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--bd)">
      <span style="flex:1;min-width:200px">${i + 1}. ${esc(x[0])}</span><span><button class="btn ghost" data-e="${i}">Edit</button> <button class="btn ghost" data-d="${i}">Delete</button></span></div>`).join('') || '<p>There are no questions yet.</p>'}</div>`;
  document.getElementById('tp').onchange = e => { aTopic = e.target.value; aEdit = -1; adminView(); };
  document.getElementById('sv').onclick = () => {
    const text = document.getElementById('qq').value.trim();
    const opts = [...box.querySelectorAll('.qo')].map(i => i.value.trim());
    if (!text || opts.some(o => !o)) return document.getElementById('er').textContent = 'Fill in the question and all four options.';
    const item = [text, opts, +document.getElementById('qa').value, document.getElementById('qx').value.trim()];
    if (aEdit >= 0) t.quiz[aEdit] = item; else t.quiz.push(item);
    aEdit = -1; saveContent(); adminView();
  };
  const cn = document.getElementById('cn'); if (cn) cn.onclick = () => { aEdit = -1; adminView(); };
  box.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { aEdit = +b.dataset.e; adminView(); window.scrollTo(0, 0); });
  box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
    if (confirm('Delete this question?')) { t.quiz.splice(+b.dataset.d, 1); aEdit = -1; saveContent(); adminView(); }
  });
}

function adminTopics() {
  const box = document.getElementById('ab');
  box.innerHTML = `<div class="card"><h3>Add new topic</h3>
    <label>Title</label><input id="tt" placeholder="Public Wi-Fi Safety">
    <label>Emoji icon</label><input id="ti" value="📌" maxlength="4">
    <label>Introduction</label><textarea id="tin" rows="2"></textarea>
    <label>Points (one per line: Heading | Description)</label>
    <textarea id="tpts" rows="5" placeholder="Use a VPN | Use a VPN on public Wi-Fi."></textarea>
    <label>Tip</label><input id="ttip"><div class="err" id="er"></div><button class="btn" id="ad">Add topic</button></div>
    <div class="card"><h3>Existing topics</h3>${TOPICS.map(t => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--bd)">
      <span>${t.icon} ${esc(t.title)} · ${t.points.length} points · ${t.quiz.length} questions</span><button class="btn ghost" data-x="${t.id}">Delete</button></div>`).join('')}
    <button class="btn ghost" id="rc" style="margin-top:14px">Reset all content to default</button></div>`;
  document.getElementById('ad').onclick = () => {
    const title = document.getElementById('tt').value.trim(), intro = document.getElementById('tin').value.trim();
    const points = document.getElementById('tpts').value.split('\n').map(l => l.split('|').map(s => s.trim())).filter(a => a[0] && a[1]);
    if (!title || !intro || !points.length) return document.getElementById('er').textContent = 'A title, an introduction and at least one point (Heading | Description) are required.';
    TOPICS.push({ id: 't' + Date.now().toString(36), icon: document.getElementById('ti').value || '📌', title, intro, points, tip: document.getElementById('ttip').value.trim() || 'Stay alert and stay safe.', quiz: [] });
    aTopic = TOPICS[TOPICS.length - 1].id; saveContent(); adminView();
  };
  box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
    if (confirm('The topic and all its quiz questions will be deleted. Are you sure?')) { TOPICS = TOPICS.filter(t => t.id !== b.dataset.x); saveContent(); adminView(); }
  });
  document.getElementById('rc').onclick = () => {
    if (confirm('All changes will be removed and the original content restored. Are you sure?')) { saveContent(DEFAULT_TOPICS).then(() => location.reload()); }
  };
}

function adminUsers() {
  const list = adminUsersList.filter(u => u.role !== 'admin'), box = document.getElementById('ab');
  box.innerHTML = `<div class="card"><h3>Registered users (${list.length})</h3>${list.map(u => `<div class="row" style="padding:10px 0;border-bottom:1px solid var(--bd)">
    <span><b>${esc(u.name)}</b><br><small>${esc(u.email)}</small></span><span class="tag g">Progress ${overall(u.progress)}%</span>
    <span class="tag">Quizzes passed: ${TOPICS.filter(t => passed(t, u.progress)).length}</span><button class="btn ghost" data-u="${u.id}">Delete</button></div>`).join('') || '<p>No users have registered yet.</p>'}</div>`;
  box.querySelectorAll('[data-u]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this user?')) return;
    await sb.rpc('admin_delete_user', { uid: b.dataset.u }); adminView();
  });
}

/* ---------- certificate and admin overview ---------- */
function certificate(name) {
  const c = document.createElement('canvas'); c.width = 1100; c.height = 780;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1100, 780);
  x.strokeStyle = '#1e3a8a'; x.lineWidth = 10; x.strokeRect(30, 30, 1040, 720);
  x.strokeStyle = '#22d3a6'; x.lineWidth = 3; x.strokeRect(50, 50, 1000, 680);
  x.textAlign = 'center'; x.fillStyle = '#1e3a8a'; x.font = 'bold 56px Georgia';
  x.fillText('Certificate of Completion', 550, 190);
  x.fillStyle = '#444'; x.font = '26px Georgia'; x.fillText('This certifies that', 550, 275);
  x.fillStyle = '#0f172a'; x.font = 'italic bold 64px Georgia'; x.fillText(name, 550, 375);
  x.fillStyle = '#444'; x.font = '26px Georgia'; x.fillText('has successfully completed all modules and quizzes of', 550, 455);
  x.fillStyle = '#1e3a8a'; x.font = 'bold 34px Georgia'; x.fillText('CyberShield - Cyber Security Awareness', 550, 515);
  x.fillStyle = '#444'; x.font = '22px Georgia'; x.fillText(new Date().toLocaleDateString(), 550, 640);
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'cybershield-certificate.png'; a.click();
}

function adminStats() {
  const list = adminUsersList.filter(u => u.role !== 'admin');
  let att = 0, pct = 0, done = 0;
  list.forEach(u => { att += u.progress.att || 0; pct += u.progress.pct || 0; if (overall(u.progress) === 100) done++; });
  const emails = list;
  const cards = [['Users', emails.length], ['Topics', TOPICS.length], ['Questions', TOPICS.reduce((s, t) => s + t.quiz.length, 0)],
    ['Quiz attempts', att], ['Average score', att ? Math.round(pct / att) + '%' : '-'], ['Fully completed', done]];
  document.getElementById('ab').innerHTML = `<div class="grid">${cards.map(c => `<div class="card"><p style="margin:0">${c[0]}</p><h1>${c[1]}</h1></div>`).join('')}</div>`;
}

/* ---------- router ---------- */
function route() {
  const [, page = '', id] = location.hash.split('/');
  window.scrollTo(0, 0);
  if (!session || !me()) { session = null; renderNav(); return authView(page === 'register' ? 'register' : 'login'); }
  renderNav(page);
  ({ topic: () => topicView(id), quiz: () => quizView(id), resources: resourcesView, profile: profileView, admin: () => isAdmin() ? adminView() : homeView() }[page] || homeView)();
}
window.addEventListener('hashchange', route);
const showMsg = (h, m) => { app.innerHTML = `<div class="card"><h2>${h}</h2><p>${m}</p></div>`; };
if (!configured) showMsg('Supabase is not connected yet', 'Open <b>config.js</b> and paste your Supabase URL and anon key (see README), then refresh.');
else loadAll().then(route).catch(e => showMsg('Could not connect to Supabase', 'Check <b>config.js</b> and make sure you ran <b>supabase.sql</b>. ' + esc(e.message || '')));

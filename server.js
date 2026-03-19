/**
 * AI BuildCon 2026 — Lead Capture Server
 * ════════════════════════════════════════
 * Uses @libsql/client for database (Turso cloud or local SQLite file).
 *
 * ROUTES
 * ──────
 *  GET  /                          Landing page
 *  POST /api/leads                 Submit a lead (JSON body)
 *  GET  /admin?key=ADMIN_KEY       HTML dashboard
 *  GET  /api/leads?key=ADMIN_KEY   All leads as JSON
 *  GET  /api/leads/export?key=...  Download as CSV
 *  GET  /health                    Health check
 *
 * ENV VARIABLES
 * ─────────────
 *  PORT           Server port              (default: 3000)
 *  ADMIN_KEY      Password for /admin      (default: aibuildcon2026)
 *  SLACK_WEBHOOK  Slack Incoming Webhook   (optional)
 *  TURSO_URL      libsql DB URL            (default: file:data/leads.db)
 *  TURSO_TOKEN    Turso auth token         (required for cloud)
 */

'use strict';

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');
const { createClient } = require('@libsql/client');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT          = parseInt(process.env.PORT || '3000', 10);
const ADMIN_KEY     = process.env.ADMIN_KEY     || 'aibuildcon2026';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK || '';
const TURSO_URL     = process.env.TURSO_URL     || 'file:data/leads.db';
const PUBLIC_DIR    = path.join(__dirname, 'public');

// ─── DATABASE ─────────────────────────────────────────────────────────────────

let _db;
function getDB() {
  if (!_db) {
    _db = createClient({ url: TURSO_URL, authToken: process.env.TURSO_TOKEN });
  }
  return _db;
}

async function dbExec(sql, params = []) {
  try {
    const result = await getDB().execute({ sql, args: params });
    return { ok: true, lastrowid: Number(result.lastInsertRowid) };
  } catch (e) {
    console.error('[DB Error]', e.message);
    return null;
  }
}

async function dbAll(sql, params = []) {
  try {
    const result = await getDB().execute({ sql, args: params });
    return result.rows.map(row => ({ ...row }));
  } catch (e) {
    console.error('[DB Error]', e.message);
    return [];
  }
}

async function initDB() {
  if (TURSO_URL.startsWith('file:')) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  }
  await dbExec(`
    CREATE TABLE IF NOT EXISTS leads (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      email      TEXT    NOT NULL,
      company    TEXT    NOT NULL,
      role       TEXT    DEFAULT '',
      message    TEXT    DEFAULT '',
      source     TEXT    DEFAULT '',
      page_url   TEXT    DEFAULT '',
      referrer   TEXT    DEFAULT '',
      ip         TEXT    DEFAULT '',
      created_at TEXT    DEFAULT (datetime('now'))
    )
  `);
  console.log('✓ Database ready →', TURSO_URL);
}

// ─── SLACK ────────────────────────────────────────────────────────────────────

function sendSlack(lead) {
  if (!SLACK_WEBHOOK) return Promise.resolve();

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🚀 New Booth Enquiry — AI BuildCon 2026', emoji: true }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Name*\n${lead.name}` },
        { type: 'mrkdwn', text: `*Email*\n${lead.email}` },
        { type: 'mrkdwn', text: `*Company*\n${lead.company}` },
        { type: 'mrkdwn', text: `*Role*\n${lead.role || '—'}` },
      ]
    },
    lead.message
      ? { type: 'section', text: { type: 'mrkdwn', text: `*Message*\n>${lead.message}` } }
      : null,
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Source: \`${lead.source || 'unknown'}\` · ${new Date().toUTCString()}`
        }
      ]
    }
  ].filter(Boolean);

  const body = JSON.stringify({ text: `New booth enquiry from ${lead.name} at ${lead.company}`, blocks });

  return new Promise((resolve) => {
    try {
      const wh = new URL(SLACK_WEBHOOK);
      const req = https.request(
        {
          hostname: wh.hostname,
          path: wh.pathname + (wh.search || ''),
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        },
        (res) => { res.resume(); res.on('end', resolve); }
      );
      req.on('error', (e) => { console.error('[Slack]', e.message); resolve(); });
      req.write(body);
      req.end();
    } catch (e) {
      console.error('[Slack]', e.message);
      resolve();
    }
  });
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.ico':  'image/x-icon',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
  }[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) { json(res, 404, { error: 'Not found' }); return; }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────

function buildAdminHTML(leads) {
  const total  = leads.length;
  const today  = leads.filter(l => l.created_at?.startsWith(new Date().toISOString().slice(0,10))).length;
  const sources = [...new Set(leads.map(l => l.source).filter(Boolean))];

  const rows = leads.map(l => `
    <tr>
      <td class="num">${l.id}</td>
      <td><strong>${esc(l.name)}</strong></td>
      <td><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></td>
      <td>${esc(l.company)}</td>
      <td>${esc(l.role || '—')}</td>
      <td class="msg">${esc(l.message || '—')}</td>
      <td><span class="badge">${esc(l.source || '—')}</span></td>
      <td class="date">${esc(l.created_at?.replace('T',' ').slice(0,16) || '—')}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leads — AI BuildCon 2026</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#080612;color:#EDE8F8;font-family:system-ui,-apple-system,sans-serif;padding:32px 40px;min-height:100vh;}
  h1{font-size:20px;font-weight:800;color:#fff;letter-spacing:-.03em;}
  .subtitle{font-size:13px;color:#7A6E9A;margin-top:4px;}
  .header{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:28px;}
  .stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;}
  .stat{background:#110E22;border:1px solid #1E1A38;border-radius:10px;padding:14px 20px;}
  .stat-n{font-size:24px;font-weight:900;color:#9D5FF5;letter-spacing:-.04em;line-height:1;}
  .stat-l{font-size:11px;color:#7A6E9A;font-weight:500;margin-top:3px;text-transform:uppercase;letter-spacing:.06em;}
  .actions{display:flex;gap:8px;}
  .btn{background:#17132E;border:1px solid #2A2448;color:#B8ADCC;border-radius:7px;padding:8px 16px;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:border-color .15s,color .15s;}
  .btn:hover{border-color:#7C3AED;color:#C4A0FA;}
  .btn.primary{background:#7C3AED;border-color:#7C3AED;color:#fff;}
  .btn.primary:hover{background:#8B47F5;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  thead th{text-align:left;padding:10px 14px;background:#110E22;color:#9D5FF5;font-size:10px;letter-spacing:.1em;text-transform:uppercase;border-bottom:1px solid #1E1A38;white-space:nowrap;}
  tbody td{padding:12px 14px;border-bottom:1px solid #1E1A38;color:#B8ADCC;vertical-align:top;}
  tbody tr:hover td{background:rgba(124,58,237,.04);}
  td.num{color:#4A4268;font-size:12px;}
  td strong{color:#fff;}
  td a{color:#9D5FF5;text-decoration:none;}
  td a:hover{text-decoration:underline;}
  td.msg{max-width:200px;white-space:pre-wrap;color:#7A6E9A;font-size:12px;}
  td.date{white-space:nowrap;font-size:11px;color:#4A4268;}
  .badge{background:#17132E;border:1px solid #2A2448;border-radius:100px;padding:2px 9px;font-size:10px;font-weight:600;color:#C4A0FA;letter-spacing:.04em;}
  .empty{text-align:center;padding:64px 20px;color:#4A4268;}
  .empty-icon{font-size:40px;margin-bottom:12px;}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>AI BuildCon 2026 — Booth Leads</h1>
    <p class="subtitle">Experience Booth Partnership enquiries · 9 May 2026 · Bangalore</p>
  </div>
  <div class="actions">
    <a class="btn" href="/api/leads/export?key=${ADMIN_KEY}">⬇ Export CSV</a>
    <a class="btn" href="/api/leads?key=${ADMIN_KEY}" target="_blank">{ } JSON</a>
    <a class="btn primary" href="/" target="_blank">↗ View Page</a>
  </div>
</div>

<div class="stats">
  <div class="stat"><div class="stat-n">${total}</div><div class="stat-l">Total Leads</div></div>
  <div class="stat"><div class="stat-n">${today}</div><div class="stat-l">Today</div></div>
  <div class="stat"><div class="stat-n">${sources.length || 0}</div><div class="stat-l">CTA Sources</div></div>
</div>

${total === 0
  ? `<div class="empty"><div class="empty-icon">📭</div><p>No leads yet. Share the landing page to start collecting!</p></div>`
  : `<table>
      <thead>
        <tr>
          <th>#</th><th>Name</th><th>Email</th><th>Company</th>
          <th>Role</th><th>Message</th><th>Source</th><th>Date (UTC)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`}
</body>
</html>`;
}

function buildCSV(leads) {
  const cols = ['id','name','email','company','role','message','source','page_url','ip','created_at'];
  const lines = [cols.join(',')];
  for (const l of leads) {
    lines.push(cols.map(c => `"${String(l[c]??'').replace(/"/g,'""')}"`).join(','));
  }
  return lines.join('\r\n');
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

async function router(req, res) {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const method   = req.method.toUpperCase();
  const query    = parsed.query;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── Health check
  if (method === 'GET' && pathname === '/health') {
    const count = (await dbAll('SELECT COUNT(*) as c FROM leads'))[0]?.c ?? 0;
    json(res, 200, { ok: true, leads: count, uptime: process.uptime() });
    return;
  }

  // ── POST /api/leads — submit a lead
  if (method === 'POST' && pathname === '/api/leads') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
      return;
    }

    const { name, email, company, role='', message='', source='', page_url='', referrer='' } = body;

    if (!name?.trim())    { json(res, 400, { ok: false, error: 'name is required' }); return; }
    if (!email?.trim())   { json(res, 400, { ok: false, error: 'email is required' }); return; }
    if (!company?.trim()) { json(res, 400, { ok: false, error: 'company is required' }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      json(res, 400, { ok: false, error: 'Invalid email address' }); return;
    }

    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

    const result = await dbExec(
      `INSERT INTO leads (name, email, company, role, message, source, page_url, referrer, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        company.trim(),
        (role || '').trim(),
        (message || '').trim(),
        source || '',
        page_url || '',
        referrer || '',
        ip
      ]
    );

    if (!result?.ok) {
      json(res, 500, { ok: false, error: 'Database error. Please try again.' });
      return;
    }

    sendSlack({ name, email, company, role, message, source })
      .catch(e => console.error('[Slack]', e.message));

    console.log(`[LEAD] ${name} <${email}> · ${company} · source:${source}`);
    json(res, 200, { ok: true, message: "Got it! We'll be in touch within 48 hours." });
    return;
  }

  // ── GET /api/leads — JSON (protected)
  if (method === 'GET' && pathname === '/api/leads') {
    if (query.key !== ADMIN_KEY) { json(res, 401, { error: 'Unauthorized' }); return; }
    const leads = await dbAll('SELECT * FROM leads ORDER BY id DESC');
    json(res, 200, leads);
    return;
  }

  // ── GET /api/leads/export — CSV download (protected)
  if (method === 'GET' && pathname === '/api/leads/export') {
    if (query.key !== ADMIN_KEY) { json(res, 401, { error: 'Unauthorized' }); return; }
    const leads = await dbAll('SELECT * FROM leads ORDER BY id DESC');
    const csv   = buildCSV(leads);
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="aibuildcon_leads_${Date.now()}.csv"`
    });
    res.end(csv);
    return;
  }

  // ── GET /admin — HTML dashboard (protected)
  if (method === 'GET' && pathname === '/admin') {
    if (query.key !== ADMIN_KEY) {
      html(res, 401, `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#080612;color:#EDE8F8">
        <h2>Unauthorized</h2>
        <p style="color:#7A6E9A;margin-top:8px">Add <code>?key=YOUR_ADMIN_KEY</code> to the URL.</p>
      </body></html>`);
      return;
    }
    const leads = await dbAll('SELECT * FROM leads ORDER BY id DESC');
    html(res, 200, buildAdminHTML(leads));
    return;
  }

  // ── GET / and static files
  if (method === 'GET') {
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(PUBLIC_DIR, requestedPath);

    // Security: prevent path traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      json(res, 403, { error: 'Forbidden' }); return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStatic(res, filePath);
    } else {
      serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
    }
    return;
  }

  json(res, 405, { error: 'Method not allowed' });
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────

const handler = async (req, res) => {
  try {
    await router(req, res);
  } catch (e) {
    console.error('[Unhandled]', e);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
  }
};

if (require.main === module) {
  // Local dev: start HTTP server
  initDB().then(() => {
    http.createServer(handler).listen(PORT, () => {
      const line = '─'.repeat(54);
      console.log(`\n${line}`);
      console.log(`  🚀  AI BuildCon 2026 Lead Server`);
      console.log(line);
      console.log(`  Landing page  →  http://localhost:${PORT}/`);
      console.log(`  Admin panel   →  http://localhost:${PORT}/admin?key=${ADMIN_KEY}`);
      console.log(`  Leads JSON    →  http://localhost:${PORT}/api/leads?key=${ADMIN_KEY}`);
      console.log(`  Export CSV    →  http://localhost:${PORT}/api/leads/export?key=${ADMIN_KEY}`);
      console.log(`  Health        →  http://localhost:${PORT}/health`);
      console.log(line);
      console.log(`  Slack webhook →  ${SLACK_WEBHOOK ? '✓ configured' : '✗ not set (set SLACK_WEBHOOK env var)'}`);
      console.log(`  Database      →  ${TURSO_URL}`);
      console.log(`${line}\n`);
    });
  });
} else {
  // Vercel serverless: export handler, init DB on first request
  let initPromise = null;
  module.exports = async (req, res) => {
    if (!initPromise) initPromise = initDB();
    await initPromise;
    return handler(req, res);
  };
}

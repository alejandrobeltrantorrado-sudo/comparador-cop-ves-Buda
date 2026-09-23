// ============================================================================
//  Comparador de remesas COP -> VES (Colombia a Venezuela) — UN SOLO ARCHIVO, SIN DEPENDENCIAS.
//  Referencia = tu tasa de Buda. Competidores = Vita Wallet, Retorna, Global66, Western Union, Cambios App.
//  Captura manual (siempre) + conectores web opcionales (VES_WEB_JSON) + referencia MontosVE (opcional).
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const TIMEOUT = 9000;
const STALE_HOURS = 12;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Proveedores conocidos (buda = tu referencia).
const KNOWN = {
  buda: 'Buda (tu tasa)', vita: 'Vita Wallet', retorna: 'Retorna',
  global66: 'Global66', wu: 'Western Union', cambios: 'Cambios App',
};

// ---- Almacén de tasas capturadas a mano (ves-rates.json) --------------------
// Estructura: { provider: { rate(VES por 1 COP), copSent, vesReceived, observedAt, observer } }
const FILE = path.join(__dirname, 'ves-rates.json');
function readStore() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { return {}; } }
function writeStore(s) { fs.writeFileSync(FILE, JSON.stringify(s, null, 2)); }
function record({ provider, copSent, vesReceived, rate, observer }) {
  const p = String(provider || '').toLowerCase();
  if (!p) throw new Error('provider requerido');
  let r = num(rate);
  const cs = num(copSent), vr = num(vesReceived);
  if (r === null && cs && vr) r = vr / cs;         // tasa efectiva = VES recibidos / COP enviados
  if (r === null || !(r > 0)) throw new Error('ingresa (COP enviados y VES recibidos) o una tasa VES/COP');
  const s = readStore();
  s[p] = { rate: r, copSent: cs, vesReceived: vr, observedAt: Date.now(), observer: observer || null };
  writeStore(s); return s[p];
}
function manualRows() {
  const s = readStore(), out = [];
  for (const [provider, e] of Object.entries(s)) {
    if (!e || !(num(e.rate) > 0)) continue;
    const ageHours = e.observedAt ? +((Date.now() - e.observedAt) / 3.6e6).toFixed(1) : null;
    out.push({ provider, source: 'manual', rate: num(e.rate), copSent: num(e.copSent), vesReceived: num(e.vesReceived),
      observedAt: e.observedAt || null, observer: e.observer || null, ageHours,
      stale: ageHours != null ? ageHours > STALE_HOURS : true });
  }
  return out;
}

async function getJSON(url, opts = {}) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
function pick(obj, dotted) { return dotted ? String(dotted).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj) : undefined; }

// ---- Conectores web opcionales (config por variable de entorno) -------------
// VES_WEB_JSON = [ { "provider":"global66", "url":"...", "method":"GET",
//    "query":{...} | "body":{...}, "headers":{...}, "ratePath":"data.rate" } ]
// ratePath debe apuntar a la tasa VES por 1 COP. Si en vez de tasa hay montos,
// usa "vesPath" + "copPath" y se calcula la tasa. Sin config, no hace nada.
function webConfigs() { try { return JSON.parse(process.env.VES_WEB_JSON || '[]'); } catch { return []; } }
async function fetchWeb(cfg) {
  let url = cfg.url;
  if ((cfg.method || 'GET') !== 'POST' && cfg.query) { const u = new URL(cfg.url); for (const [k, v] of Object.entries(cfg.query)) u.searchParams.set(k, String(v)); url = u.toString(); }
  const opts = { method: cfg.method || 'GET', headers: cfg.headers || {} };
  if ((cfg.method || 'GET') === 'POST' && cfg.body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(cfg.body); }
  const j = await getJSON(url, opts);
  let rate = num(pick(j, cfg.ratePath));
  if (rate === null && cfg.vesPath && cfg.copPath) { const ves = num(pick(j, cfg.vesPath)), cop = num(pick(j, cfg.copPath)); if (ves && cop) rate = ves / cop; }
  if (rate === null || !(rate > 0)) throw new Error(`sin tasa (${cfg.provider}) — revisar ratePath`);
  return { provider: String(cfg.provider || 'web').toLowerCase(), source: 'web', rate, time: Date.now() / 1000 | 0 };
}
async function webRows() {
  const cfgs = webConfigs(); if (!cfgs.length) return { rows: [], errors: [] };
  const settled = await Promise.allSettled(cfgs.map(fetchWeb));
  const rows = [], errors = [];
  settled.forEach((r, i) => { if (r.status === 'fulfilled') rows.push(r.value);
    else errors.push({ provider: (cfgs[i] || {}).provider || 'web', error: String(r.reason && r.reason.message || r.reason) }); });
  return { rows, errors };
}

// ---- Buda Cross-Border Payments (tasa AUTOMÁTICA de referencia, API privada) ----
// Auth Buda (verificado): HMAC-SHA384 hex. Headers X-SBTC-APIKEY/NONCE/SIGNATURE.
// String firmado POST: "POST {path} {body_base64} {nonce}"  (nonce = microsegundos, creciente).
// Requiere variables: BUDA_API_KEY, BUDA_API_SECRET y BUDA_CBP_QUOTE_BODY (el JSON exacto del
// quote COP->VES que espera Buda, con su recipient_data). Path configurable por si difiere.
function budaAuthHeaders(method, fullPath, bodyStr, KEY, SECRET) {
  const nonce = String(Date.now() * 1000); // microsegundos aprox., entero creciente
  let msg;
  if (bodyStr) {
    const b64 = Buffer.from(bodyStr).toString('base64');
    msg = `${method} ${fullPath} ${b64} ${nonce}`;
  } else {
    msg = `${method} ${fullPath} ${nonce}`;
  }
  const sig = crypto.createHmac('sha384', SECRET).update(msg).digest('hex');
  return { 'X-SBTC-APIKEY': KEY, 'X-SBTC-NONCE': nonce, 'X-SBTC-SIGNATURE': sig };
}
async function budaCBP() {
  const KEY = process.env.BUDA_API_KEY, SECRET = process.env.BUDA_API_SECRET;
  if (!KEY || !SECRET) return { configured: false, note: 'define BUDA_API_KEY y BUDA_API_SECRET' };
  let body; try { body = JSON.parse(process.env.BUDA_CBP_QUOTE_BODY || 'null'); } catch { body = null; }
  if (!body) return { configured: false, note: 'define BUDA_CBP_QUOTE_BODY (JSON del quote COP->VES con recipient_data)' };
  const base = process.env.BUDA_API_BASE || 'https://www.buda.com';
  const p = process.env.BUDA_CBP_QUOTE_PATH || '/api/v2/cross_border_payments/quotations';
  const bodyStr = JSON.stringify(body);
  const headers = { ...budaAuthHeaders('POST', p, bodyStr, KEY, SECRET), 'Content-Type': 'application/json', Accept: 'application/json' };
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(base + p, { method: 'POST', headers, body: bodyStr, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Buda CBP HTTP ${res.status}`);
    const j = await res.json();
    const q = j.quotation || j.data || j;
    const src = num(q.amount_in_source_currency) || num(body.amount);
    const dst = num(q.amount_in_destination_currency);
    let rate = null;
    if (src && dst) rate = dst / src;              // tasa efectiva VES por COP (all-in)
    if (!(rate > 0)) rate = num(q.exchange_rate);  // fallback al campo directo
    if (!(rate > 0)) throw new Error('Buda CBP sin tasa utilizable en la respuesta');
    return { configured: true, row: { provider: 'buda', source: 'buda-cbp', rate, time: Date.now() / 1000 | 0 } };
  } finally { clearTimeout(t); }
}

// ---- Referencia MontosVE (tasa de calle del VES: BCV / Binance / Bybit) -----
// API con key (plan gratis). No es COP->VES ni las apps; es el ancla del bolívar.
async function montosve() {
  const KEY = process.env.MONTOSVE_API_KEY;
  if (!KEY) return { enabled: false, note: 'define MONTOSVE_API_KEY para la referencia BCV/paralelo del VES' };
  const BASE = process.env.MONTOSVE_API_BASE || 'https://api.montosve.com';
  try {
    const j = await getJSON(`${BASE}/v1/fx/rates`, { headers: { 'x-api-key': KEY, Authorization: `Bearer ${KEY}` } });
    return { enabled: true, raw: j };
  } catch (e) { return { enabled: true, error: String(e.message || e) }; }
}

// ---- combinar (web pisa a manual para el mismo proveedor) -------------------
function combine(manual, web) {
  const byProv = {};
  for (const r of manual) byProv[r.provider] = r;
  for (const r of web) byProv[r.provider] = r; // web es más fresco
  return Object.values(byProv);
}
function withVerdict(rows) {
  const buda = rows.find((r) => r.provider === 'buda') || null;
  return rows.map((r) => {
    const o = { ...r };
    if (buda && r.provider !== 'buda' && buda.rate && r.rate) {
      // Más VES por COP = mejor para el cliente. Buda mejor si su tasa es MAYOR.
      o.deltaRate = +(r.rate - buda.rate).toFixed(6);
      o.deltaPct = +(((r.rate - buda.rate) / buda.rate) * 100).toFixed(2);
      o.budaMejor = buda.rate > r.rate; // true = Buda da más VES
    }
    return o;
  });
}

// ---- HTTP -------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };
function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => r(d)); }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  try {
    if (p === '/health') return sendJSON(res, 200, { ok: true });

    if (p === '/api/rates') {
      const web = await webRows();
      let rows = combine(manualRows(), web.rows);
      // Buda automático vía API CBP (si está configurado) pisa cualquier 'buda' manual.
      let budaAuto = { configured: false }, budaError = null;
      try {
        const b = await budaCBP();
        budaAuto = b;
        if (b.configured && b.row) { rows = rows.filter((r) => r.provider !== 'buda'); rows.push(b.row); }
      } catch (e) { budaError = String(e.message || e); }
      rows = withVerdict(rows);
      const ref = await montosve();
      return sendJSON(res, 200, {
        generatedAt: Date.now(), known: KNOWN,
        reference: rows.find((r) => r.provider === 'buda') || null,
        budaAuto: budaAuto.configured === true, budaNote: budaAuto.note || null, budaError,
        rows, webErrors: web.errors, montosve: ref,
      });
    }

    if (p === '/api/manual' && req.method === 'POST') {
      const body = await readBody(req); let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { return sendJSON(res, 400, { ok: false, error: 'JSON inválido' }); }
      try { return sendJSON(res, 200, { ok: true, saved: record(parsed) }); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
    }

    let file = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    file = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
    const abs = path.join(__dirname, file);
    if (!abs.startsWith(__dirname)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(abs, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' }); res.end(buf);
    });
  } catch (err) { sendJSON(res, 502, { error: 'Error interno', detail: String(err && err.message || err) }); }
});
server.listen(PORT, () => console.log(`Comparador COP->VES escuchando en :${PORT}`));

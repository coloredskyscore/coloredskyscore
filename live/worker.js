// coloredsky Live collector (all measurable chains)
// Cloudflare Worker. Presentation data only: nothing here feeds a score.
//
// This file is the master copy of the code deployed to the Cloudflare Worker
// `coloredsky-live` (pasted into Cloudflare's editor, which reformats it). It is not
// run by GitHub Pages. Deployed version as of November 28, 2026: 5ed13019.
// Full record: claude/Live_Monitor.md in the project.
//
// Bindings: LIVE (KV namespace). Cron: */3 * * * * (one KV write per run, 480 a day of the free 1,000).
// Routes:
//   /live.json  the data the Live page reads (?window=600 or 3600 seconds)
//   /debug      reads sources right now, no writes (?chains=bnb,mon  &all=1 tries every source)
//   /           a short plain-text pointer

const WINDOW_DEFAULT_S = 600;
const KEEP_S = 3600;            // history kept for the 1-hour view
const STALE_S = 420;            // no good read for 7 minutes => "data unavailable"
const TIMEOUT_MS = 9000;
const BUDGET = 44;              // outside requests per run (free plan allows 50)
const PARALLEL = 6;             // free plan allows 6 open connections at once
const UA = 'coloredsky-live/0.2 (+https://coloredskyscore.com)';
const RIPPLE_EPOCH = 946684800; // XRPL times count from 2000-01-01
const BATCH_LIMIT = { 'https://eth.drpc.org': 3, 'https://solana.drpc.org': 3 };

// finality mirrors each chain's AI Deterministic Finality gate: pass, partial or fail.
// mode: ticks (every block drawn), count (blocks counted per interval), samples (Solana).
// halt_after_s: proof-of-work and Cardano use the Poisson rule. Bitcoin and Bitcoin Cash
// use 2 hours (a 96-minute Bitcoin gap on November 28, 2026 tripped the old 69-minute limit).
// Ticks-mode history keeps at least the last 12 blocks so slow chains get a real rhythm.
// Each source is "reader|url". every_s: read less often (Blockchair's free tier is small).
const CHAINS = {
  btc:  { name: 'Bitcoin', finality: 'fail', mode: 'ticks', target_s: 600, halt_after_s: 7200,
          sources: ['esplora|https://mempool.space/api/v1/blocks', 'esplora|https://blockstream.info/api/blocks'] },
  eth:  { name: 'Ethereum', finality: 'partial', mode: 'ticks', target_s: 12, halt_after_s: 240,
          sources: ['eth|https://ethereum-rpc.publicnode.com', 'eth|https://eth.drpc.org', 'eth|https://ethereum.publicnode.com'] },
  sol:  { name: 'Solana', finality: 'pass', mode: 'samples', target_s: 0.2, halt_after_s: 60,
          sources: ['sol|https://solana-rpc.publicnode.com', 'sol|https://solana.drpc.org', 'sol|https://api.mainnet-beta.solana.com'] },
  xrp:  { name: 'XRP Ledger', finality: 'partial', mode: 'count', poll_time: true, target_s: 3.9, halt_after_s: 60,
          sources: ['xrp|https://s1.ripple.com:51234/', 'xrp|https://s2.ripple.com:51234/', 'xrp|https://xrplcluster.com/'] },
  sui:  { name: 'Sui', finality: 'pass', mode: 'count', target_s: 0.25, halt_after_s: 60,
          sources: ['suigql|https://graphql.mainnet.sui.io/graphql'] },
  bnb:  { name: 'BNB Chain', finality: 'partial', mode: 'count', target_s: 0.45, halt_after_s: 60,
          sources: ['evm|https://bsc-rpc.publicnode.com', 'evm|https://bsc-dataseed.bnbchain.org', 'evm|https://bsc.drpc.org'] },
  hype: { name: 'Hyperliquid', finality: 'pass', mode: 'count', target_s: 1, halt_after_s: 120,
          sources: ['evm|https://rpc.hyperliquid.xyz/evm', 'evm|https://hyperliquid.drpc.org'] },
  avax: { name: 'Avalanche', finality: 'partial', mode: 'count', target_s: 2, halt_after_s: 120,
          sources: ['evm|https://avalanche-c-chain-rpc.publicnode.com', 'evm|https://api.avax.network/ext/bc/C/rpc', 'evm|https://avalanche.drpc.org'] },
  mon:  { name: 'Monad', finality: 'pass', mode: 'count', target_s: 0.4, halt_after_s: 60,
          sources: ['evm|https://rpc.monad.xyz', 'evm|https://rpc3.monad.xyz', 'evm|https://rpc2.monad.xyz'] },
  tron: { name: 'TRON', finality: 'partial', mode: 'count', target_s: 3, halt_after_s: 60,
          sources: ['tron|https://api.trongrid.io', 'tron|https://tron-rpc.publicnode.com', 'evm|https://api.trongrid.io/jsonrpc'] },
  ada:  { name: 'Cardano', finality: 'fail', mode: 'ticks', target_s: 20, halt_after_s: 300,
          sources: ['koios|https://api.koios.rest/api/v1', 'bcstats|https://api.blockchair.com/cardano/stats'] },
  doge: { name: 'Dogecoin', finality: 'fail', mode: 'ticks', target_s: 60, halt_after_s: 720, every_s: 360,
          sources: ['blockchair|https://api.blockchair.com/dogecoin/blocks?limit=10'] },
  zec:  { name: 'Zcash', finality: 'fail', mode: 'ticks', target_s: 75, halt_after_s: 900, every_s: 360,
          sources: ['blockchair|https://api.blockchair.com/zcash/blocks?limit=10'] },
  xlm:  { name: 'Stellar', finality: 'partial', mode: 'count', target_s: 5.5, halt_after_s: 60,
          sources: ['horizon|https://horizon.stellar.org/', 'horizon|https://horizon.stellar.lobstr.co/'] },
  bch:  { name: 'Bitcoin Cash', finality: 'fail', mode: 'ticks', target_s: 600, halt_after_s: 7200, every_s: 360,
          sources: ['blockchair|https://api.blockchair.com/bitcoin-cash/blocks?limit=10'] },
  arc:  { name: 'Arc', finality: 'pass', mode: 'count', target_s: 0.5, halt_after_s: 60,
          sources: ['evm|https://rpc.mainnet.arc.io', 'evm|https://rpc.drpc.mainnet.arc.io', 'evm|https://arc.drpc.org'] },
  ltc:  { name: 'Litecoin', finality: 'fail', mode: 'ticks', target_s: 150, halt_after_s: 1800,
          sources: ['esplora|https://litecoinspace.org/api/v1/blocks', 'blockchair|https://api.blockchair.com/litecoin/blocks?limit=10'] },
};

// Rated chains with no public, keyless way to read them. Shown on the page as such.
const NOT_MEASURABLE = {
  cc: 'No public node endpoint',
  night: 'Public node needs a paid key',
};

// ---------- small helpers ----------

const nowS = () => Math.floor(Date.now() / 1000);

function spend(io) {
  if (io.left <= 0) throw new Error('request budget used up this run');
  io.left--;
}

async function getJSON(io, url) {
  spend(io);
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function post(io, url, body) {
  spend(io);
  const r = await fetch(url, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const rpc1 = (method, params = []) => ({ jsonrpc: '2.0', id: 1, method, params });
const hex = (n) => '0x' + n.toString(16);
const toS = (iso) => Math.floor(Date.parse(iso) / 1000);
const bcTime = (s) => toS(String(s).replace(' ', 'T') + 'Z'); // Blockchair: "2026-11-27 20:00:00" UTC
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const num = (x) => { const n = Number(x); if (!Number.isFinite(n)) throw new Error('bad number'); return n; };
const tip = (height, time, extra = {}) => ({ head: { height: num(height), time: num(time) }, ...extra });
function fromList(blocks) {
  blocks = blocks.filter((b) => Number.isFinite(b.h) && Number.isFinite(b.t)).sort((a, b) => a.h - b.h);
  if (!blocks.length) throw new Error('empty block list');
  const top = blocks[blocks.length - 1];
  return { head: { height: top.h, time: top.t }, blocks };
}

// ---------- readers: each returns { head: {height, time}, blocks?, samples?, partial? } ----------

const READERS = {
  async esplora(io, url) {
    const arr = await getJSON(io, url);
    return fromList(arr.map((b) => ({ h: b.height, t: b.timestamp })));
  },

  async blockchair(io, url) {
    const res = await getJSON(io, url);
    return fromList((res.data || []).map((b) => ({ h: b.id, t: bcTime(b.time) })));
  },

  async bcstats(io, url) {
    const d = (await getJSON(io, url)).data || {};
    return tip(d.best_block_height, bcTime(d.best_block_time));
  },

  async blockbook(io, url) {
    const res = await getJSON(io, url + '/api/v2');
    const b = res.blockbook || {};
    return tip(b.bestHeight, toS(b.lastBlockTime));
  },

  async koios(io, url) {
    const arr = await getJSON(io, url + '/blocks?select=block_height,block_time&block_height=not.is.null&order=block_height.desc&limit=10');
    return fromList(arr.map((b) => ({ h: b.block_height, t: b.block_time })));
  },

  async evm(io, url) {
    const res = await post(io, url, rpc1('eth_getBlockByNumber', ['latest', false]));
    const b = res.result;
    if (!b) throw new Error('no block');
    return tip(parseInt(b.number, 16), parseInt(b.timestamp, 16));
  },

  async tron(io, url) {
    const res = await post(io, url + '/wallet/getnowblock', {});
    const raw = res && res.block_header && res.block_header.raw_data;
    if (!raw) throw new Error('no block header');
    return tip(raw.number, Math.floor(raw.timestamp / 1000));
  },

  async horizon(io, url) {
    const res = await getJSON(io, url);
    return tip(res.history_latest_ledger, toS(res.history_latest_ledger_closed_at));
  },

  async suigql(io, url) {
    const res = await post(io, url, { query: '{ checkpoint { sequenceNumber timestamp } }' });
    const c = res && res.data && res.data.checkpoint;
    if (!c) throw new Error('no checkpoint');
    return tip(c.sequenceNumber, toS(c.timestamp));
  },

  async sui(io, url) {
    const seq = (await post(io, url, rpc1('sui_getLatestCheckpointSequenceNumber'))).result;
    const c = (await post(io, url, rpc1('sui_getCheckpoint', [String(seq)]))).result;
    if (!c) throw new Error('no checkpoint');
    return tip(c.sequenceNumber, Math.floor(Number(c.timestampMs) / 1000));
  },

  async xrp(io, url) {
    const res = await post(io, url, { method: 'ledger', params: [{ ledger_index: 'validated' }] });
    const L = res && res.result && res.result.ledger;
    if (!L) throw new Error('bad ledger response');
    // close_time is rounded to ~10 s by design, so it is only good for "last ledger" age.
    return tip(res.result.ledger_index ?? L.ledger_index, Number(L.close_time) + RIPPLE_EPOCH);
  },

  async eth(io, url, prev) {
    const head = parseInt((await post(io, url, rpc1('eth_blockNumber'))).result, 16);
    if (!Number.isFinite(head)) throw new Error('bad eth_blockNumber');
    // Fetch what's new since the last poll (at most 20 blocks, about four minutes).
    const from = Math.min(head, Math.max(prev && prev.head ? prev.head.height + 1 : 0, head - 19));
    const want = [];
    for (let h = from; h <= head; h++) want.push(h);
    const blocks = [];
    try {
      const size = BATCH_LIMIT[url] || 20;
      for (let i = 0; i < want.length; i += size) {
        const batch = want.slice(i, i + size).map((h, j) => ({ jsonrpc: '2.0', id: j + 1, method: 'eth_getBlockByNumber', params: [hex(h), false] }));
        const res = await post(io, url, batch);
        if (!Array.isArray(res)) throw new Error('batch refused');
        for (const x of res) if (x && x.result) blocks.push({ h: parseInt(x.result.number, 16), t: parseInt(x.result.timestamp, 16) });
      }
    } catch (e) {
      if (!blocks.some((b) => b.h === head)) {
        const one = await post(io, url, rpc1('eth_getBlockByNumber', [hex(head), false]));
        blocks.push({ h: head, t: parseInt(one.result.timestamp, 16) });
      }
    }
    const out = fromList(blocks);
    out.partial = blocks.length < want.length; // another source may do better
    return out;
  },

  async sol(io, url) {
    const res = await post(io, url, [
      { jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'confirmed' }] },
      { jsonrpc: '2.0', id: 2, method: 'getRecentPerformanceSamples', params: [12] },
    ]);
    if (!Array.isArray(res)) throw new Error('batch not supported');
    const slot = (res.find((x) => x.id === 1) || {}).result;
    const samples = (res.find((x) => x.id === 2) || {}).result || [];
    if (!Number.isFinite(slot)) throw new Error('bad getSlot');
    // getBlockTime can fail on a skipped slot; step back a slot or two if needed.
    let time = null;
    for (let s = slot; s > slot - 3 && time == null; s--) {
      const bt = await post(io, url, { jsonrpc: '2.0', id: 3, method: 'getBlockTime', params: [s] });
      if (Number.isFinite(bt.result)) time = bt.result;
    }
    if (time == null) throw new Error('no block time near head');
    // Samples carry slots, not timestamps: anchor the newest to the head's time, step back.
    let end = time - Math.max(0, slot - ((samples[0] && samples[0].slot) || slot)) * CHAINS.sol.target_s;
    const out = [];
    for (const s of samples) {
      out.push({ slot: s.slot, end: Math.round(end), count: s.numSlots, period: s.samplePeriodSecs });
      end -= s.samplePeriodSecs;
    }
    return { head: { height: slot, time }, samples: out };
  },
};

// Try sources in order; stop at the first healthy, complete answer.
// A possible halt is only declared when two sources answered and both look stalled.
async function observe(io, id, prev, tryAll) {
  const c = CHAINS[id];
  const t = nowS();
  const attempts = [];
  let best = null;
  for (const src of c.sources) {
    const [kind, url] = src.split('|');
    try {
      const obs = await READERS[kind](io, url, prev);
      obs.source = url;
      attempts.push({ url, ok: true, height: obs.head.height, lag_s: t - obs.head.time, partial: !!obs.partial });
      if (!best || obs.head.height > best.head.height || (best.partial && !obs.partial && obs.head.height >= best.head.height)) best = obs;
      if (!tryAll && t - obs.head.time <= c.halt_after_s && !obs.partial) break;
    } catch (e) {
      attempts.push({ url, ok: false, error: String(e.message || e).slice(0, 120) });
    }
  }
  return { at: t, best, attempts };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function lane() { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
  return out;
}

// ---------- state update (cron) ----------

function merge(id, prev, o) {
  const c = CHAINS[id];
  const s = prev || { history: [] };
  s.attempts = o.attempts;
  // A failed read keeps the last status; the view marks the chain "data unavailable"
  // only after STALE_S with no good read.
  if (!o.best) return s;
  const b = o.best;
  s.last_ok = o.at;
  s.source = b.source;
  s.head = b.head;
  s.lag_s = Math.max(0, o.at - b.head.time);
  const answered = o.attempts.filter((a) => a.ok).length;
  s.status = s.lag_s > c.halt_after_s ? (answered >= 2 ? 'possible_halt' : 'checking') : 'ok';
  if (s.status !== s.prev_status) { s.status_since = o.at; s.prev_status = s.status; }

  const cutoff = o.at - KEEP_S;
  let h = s.history || [];
  if (c.mode === 'ticks') {
    const byH = new Map(h.map((x) => [x.h, x]));
    for (const x of b.blocks || [{ h: b.head.height, t: b.head.time }]) byH.set(x.h, x);
    h = [...byH.values()].sort((x, y) => x.h - y.h); h = h.filter((x, i) => x.t >= cutoff || i >= h.length - 12);
  } else if (c.mode === 'samples') {
    const lastEnd = h.reduce((m, x) => Math.max(m, x.end), 0);
    const bySlot = new Map(h.map((x) => [x.slot, x]));
    for (const x of b.samples) if (x.end > lastEnd + 30) bySlot.set(x.slot, x);
    h = [...bySlot.values()].filter((x) => x.end >= cutoff).sort((x, y) => x.end - y.end);
  } else {
    const t = c.poll_time ? o.at : b.head.time;
    const last = h[h.length - 1];
    h = h.filter((x) => x.t >= cutoff && x.n != null); // drops entries in an older format
    if (!last || !(b.head.height <= last.n)) h.push({ t, n: b.head.height });
  }
  s.history = h;
  return s;
}

async function collect(env) {
  const raw = await env.LIVE.get('state');
  const state = raw ? JSON.parse(raw) : { chains: {} };
  const io = { left: BUDGET };
  const ids = Object.keys(CHAINS);
  const obs = await pool(ids, PARALLEL, (id) => {
    const prev = state.chains[id], every = CHAINS[id].every_s;
    if (every && prev && prev.last_ok && nowS() - prev.last_ok < every - 30) return { at: nowS(), best: null, attempts: prev.attempts || [] };
    return observe(io, id, prev);
  });
  ids.forEach((id, i) => { state.chains[id] = merge(id, state.chains[id], obs[i]); });
  for (const id of Object.keys(state.chains)) if (!CHAINS[id]) delete state.chains[id];
  state.updated = nowS();
  await env.LIVE.put('state', JSON.stringify(state));
  return state;
}

// ---------- public view (fetch) ----------

function view(state, windowS) {
  const t = nowS();
  const out = { updated: state.updated || null, window_s: windowS,
    note: 'Presentation data from public node endpoints. Not scored.', chains: [],
    not_measurable: Object.entries(NOT_MEASURABLE).map(([id, reason]) => ({ id, reason })) };
  for (const id of Object.keys(CHAINS)) {
    const c = CHAINS[id];
    const s = (state.chains || {})[id] || {};
    const asOf = s.last_ok || null;
    let status = s.status || 'data_unavailable';
    if (!asOf || t - asOf > STALE_S) status = 'data_unavailable';
    const from = (asOf || t) - windowS;
    const row = { id, name: c.name, finality: c.finality, target_s: c.target_s, halt_after_s: c.halt_after_s, status,
      status_since: s.status_since || null, as_of: asOf, lag_s: s.lag_s ?? null,
      height: s.head ? s.head.height : null, source: s.source || null };
    const h = s.history || [];
    if (c.mode === 'ticks') {
      // Blocks between two known ones (missed by a tip-only source) are spaced evenly.
      const ticks = [];
      for (let i = 0; i < h.length; i++) {
        if (i > 0) {
          const k = h[i].h - h[i - 1].h, span = h[i].t - h[i - 1].t;
          if (k > 1 && k <= 60) for (let j = 1; j < k; j++) ticks.push(h[i - 1].t + span * j / k);
        }
        ticks.push(h[i].t);
      }
      row.ticks = ticks.filter((x) => x >= from).map((x) => Math.round(x));
      row.cadence_s = h.length > 1 ? (h[h.length - 1].t - h[0].t) / (h[h.length - 1].h - h[0].h) : null;
    } else if (c.mode === 'samples') {
      row.segments = h.filter((x) => x.end > from).map((x) => ({ from: x.end - x.period, to: x.end, count: x.count }));
      const n = row.segments.reduce((a, x) => a + x.count, 0), d = row.segments.reduce((a, x) => a + (x.to - x.from), 0);
      row.cadence_s = n ? d / n : null;
    } else {
      const seg = [];
      for (let i = 1; i < h.length; i++) {
        if (h[i].t <= from) continue;
        seg.push({ from: h[i - 1].t, to: h[i].t, count: Math.max(0, h[i].n - h[i - 1].n) });
      }
      row.segments = seg;
      const n = seg.reduce((a, x) => a + x.count, 0), d = seg.reduce((a, x) => a + (x.to - x.from), 0);
      row.cadence_s = n ? d / n : null;
    }
    out.chains.push(row);
  }
  return out;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };

function json(obj, extra = {}) {
  return new Response(JSON.stringify(obj, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra } });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(collect(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/live.json') {
      const windowS = Number(url.searchParams.get('window')) === 3600 ? 3600 : WINDOW_DEFAULT_S;
      const raw = await env.LIVE.get('state');
      return json(view(raw ? JSON.parse(raw) : {}, windowS), { 'cache-control': 'public, max-age=20' });
    }

    if (url.pathname === '/debug') {
      const pick = (url.searchParams.get('chains') || '').split(',').filter((x) => CHAINS[x]);
      const ids = pick.length ? pick : Object.keys(CHAINS);
      const io = { left: BUDGET };
      const res = await pool(ids, PARALLEL, (id) => observe(io, id, null, url.searchParams.get('all') === '1'));
      return json(Object.fromEntries(ids.map((id, i) => [id, {
        attempts: res[i].attempts, head: res[i].best ? res[i].best.head : null }])), { 'cache-control': 'no-store' });
    }

    return new Response('coloredsky Live collector. Data: /live.json  ·  Source check: /debug?chains=btc,eth&all=1\n',
      { headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } });
  },
};

// Exported for local tests only.
export { CHAINS, READERS, observe, merge, collect, view, NOT_MEASURABLE };

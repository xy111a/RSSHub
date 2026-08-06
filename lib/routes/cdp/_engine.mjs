// CDP engine for high-restriction platforms (Twitter/X, Reddit), driven by the
// already-logged-in chrome2 browser over its CDP bridge.
//
// This module is imported by RSSHub custom route files under lib/routes/cdp/.
// It contains NO HTTP server and NO RSS rendering — RSSHub's renderer does that.
// A route handler simply calls `withPage(url, fetchFn, arg)` and turns the
// returned plain object into a RSSHub `Data` object.
//
// IMPORTANT: `redditFetch` / `twitterFetch` are BROWSER-side functions. They are
// passed to `withPage` and stringified into the page context (via Runtime.evaluate),
// so they run inside chrome2 and inherit its logged-in cookies. They must not
// reference Node-only globals. twitterFetch keeps its bearer/features inline so
// they survive stringification.

import { WebSocket as WS } from 'ws';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CDP_BASE = (process.env.PLAYWRIGHT_CDP_ENDPOINT || 'http://192.168.88.247:19999').replace(/\/$/, '');

async function getBrowserWs() {
  const res = await fetch(CDP_BASE + '/json/version');
  if (!res.ok) throw new Error('CDP /json/version http ' + res.status);
  const j = await res.json();
  if (!j.webSocketDebuggerUrl) throw new Error('CDP returned no webSocketDebuggerUrl');
  return j.webSocketDebuggerUrl;
}

function makeApi(ws) {
  const pending = new Map();
  let msgId = 0;
  const api = {
    send(method, params = {}) {
      const id = ++msgId;
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        try { ws.send(JSON.stringify({ id, method, params })); }
        catch (e) { pending.delete(id); rej(e); }
      });
    },
    close() { try { ws.close(); } catch {} },
  };
  ws.on('message', (d) => {
    let msg; try { msg = JSON.parse(d.toString()); } catch { return; }
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.rej(new Error('CDP ' + (msg.method || '') + ': ' + (msg.error.message || JSON.stringify(msg.error))));
      else p.res(msg.result);
    }
  });
  ws.on('error', (e) => { for (const p of pending.values()) p.rej(e); pending.clear(); });
  return api;
}

async function openPageCDP(url) {
  const browserWsUrl = await getBrowserWs();
  const bws = new WS(browserWsUrl);
  await new Promise((res, rej) => { bws.on('open', res); bws.on('error', rej); });
  const bpending = new Map(); let bid = 0;
  const bsend = (method, params = {}) => new Promise((res, rej) => {
    const id = ++bid; bpending.set(id, { res, rej });
    bws.send(JSON.stringify({ id, method, params }));
  });
  bws.on('message', (d) => {
    let msg; try { msg = JSON.parse(d.toString()); } catch { return; }
    if (msg.id != null && bpending.has(msg.id)) {
      const p = bpending.get(msg.id); bpending.delete(msg.id);
      if (msg.error) p.rej(new Error('CDP ' + (msg.method || '') + ': ' + (msg.error.message || JSON.stringify(msg.error))));
      else p.res(msg.result);
    }
  });
  const { targetId } = await bsend('Target.createTarget', { url });
  let t = null;
  for (let attempt = 0; attempt < 10 && !t; attempt++) {
    const list = await (await fetch(CDP_BASE + '/json/list')).json();
    t = (Array.isArray(list) ? list : []).find((x) => x.id === targetId);
    if (!t) await sleep(300);
  }
  if (!t || !t.webSocketDebuggerUrl) { bws.close(); throw new Error('could not resolve target webSocketDebuggerUrl'); }
  const ws = new WS(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const api = makeApi(ws);
  await api.send('Page.enable');
  await api.send('Runtime.enable');
  return {
    api,
    ws,
    closeTarget: async () => { try { await bsend('Target.closeTarget', { targetId }); } catch {} try { bws.close(); } catch {} },
  };
}

async function waitLoad(api, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = await api.send('Runtime.evaluate', {
      expression: 'document.readyState + "|" + (location.protocol.startsWith("http") ? location.href : "")',
      returnByValue: true,
    });
    const val = r?.result?.value || '';
    const [rs, href] = val.split('|');
    if (rs === 'complete' && href) return href;
    await sleep(500);
  }
  throw new Error('navigation timeout');
}

async function evalPage(api, fn, arg) {
  const expr = `(${fn.toString()})(${arg !== undefined ? JSON.stringify(arg) : ''})`;
  const r = await api.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r?.exceptionDetails) {
    const ex = r.exceptionDetails.exception || {};
    throw new Error('page error: ' + (ex.description || ex.value || r.exceptionDetails.text));
  }
  if (r?.result?.subtype === 'error') throw new Error('page error: ' + (r.result.description || r.result.value));
  if (r?.result?.value == null) {
    console.error('EVAL_EMPTY', JSON.stringify(r).slice(0, 800));
  }
  return r?.result?.value;
}

export async function withPage(url, fn, arg) {
  const { api, ws, closeTarget } = await openPageCDP(url);
  try {
    await waitLoad(api);
    return await evalPage(api, fn, arg);
  } finally {
    try { await closeTarget(); } catch {}
    ws.close();
  }
}

// ---------- Reddit in-page logic ----------
export async function redditFetch({ sub, limit }) {
  function decodeHtml(s) {
    if (typeof s !== 'string' || !s) return '';
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#x27;/gi, "'").replace(/&#39;/g, "'");
  }
  function extractRedditMedia(d) {
    const post_hint = d?.post_hint || '';
    const url_overridden_by_dest = d?.url_overridden_by_dest || '';
    const preview_image_url = decodeHtml(d?.preview?.images?.[0]?.source?.url || '');
    const gallery_urls = [];
    const items = d?.gallery_data?.items;
    const meta = d?.media_metadata;
    if (Array.isArray(items) && meta) {
      for (const it of items) {
        const m = it && meta[it.media_id];
        const u = m?.s?.u;
        if (u) gallery_urls.push(decodeHtml(u));
      }
    }
    return { post_hint, url_overridden_by_dest, preview_image_url, gallery_urls };
  }
  const path = sub ? `/r/${sub}/hot.json` : `/hot.json`;
  const res = await fetch(`https://www.reddit.com${path}?limit=${limit}&raw_json=1`, { credentials: 'include' });
  if (!res.ok) throw new Error('reddit json http ' + res.status);
  const j = await res.json();
  return (j?.data?.children || []).map((c) => {
    const d = c.data;
    const media = extractRedditMedia(d);
    return { title: d.title, author: d.author, score: d.score, comments: d.num_comments,
      link: 'https://www.reddit.com' + d.permalink, selftext: d.selftext || '', created_utc: d.created_utc, media };
  });
}

export async function redditSortFetch({ sub, sort, limit, time }) {
  function decodeHtml(s) {
    if (typeof s !== 'string' || !s) return '';
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#x27;/gi, "'").replace(/&#39;/g, "'");
  }
  function extractRedditMedia(d) {
    const post_hint = d?.post_hint || '';
    const url_overridden_by_dest = d?.url_overridden_by_dest || '';
    const preview_image_url = decodeHtml(d?.preview?.images?.[0]?.source?.url || '');
    const gallery_urls = [];
    const items = d?.gallery_data?.items;
    const meta = d?.media_metadata;
    if (Array.isArray(items) && meta) {
      for (const it of items) {
        const m = it && meta[it.media_id];
        const u = m?.s?.u;
        if (u) gallery_urls.push(decodeHtml(u));
      }
    }
    return { post_hint, url_overridden_by_dest, preview_image_url, gallery_urls };
  }
  let url = `https://www.reddit.com/r/${sub}/${sort}.json?limit=${limit}&raw_json=1`;
  if ((sort === 'top' || sort === 'controversial') && time) url += `&t=${time}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('reddit json http ' + res.status);
  const j = await res.json();
  return (j?.data?.children || []).map((c) => {
    const d = c.data;
    const media = extractRedditMedia(d);
    return { title: d.title, author: d.author, score: d.score, comments: d.num_comments,
      link: 'https://www.reddit.com' + d.permalink, selftext: d.selftext || '', created_utc: d.created_utc, media };
  });
}

export function redditToItems(posts) {
  return posts.map((p) => ({
    title: p.title,
    description: p.selftext ? p.selftext.slice(0, 2000) : (p.media.preview_image_url || p.media.url_overridden_by_dest || ''),
    link: p.link,
    author: p.author,
    pubDate: new Date(p.created_utc * 1000).toUTCString(),
  }));
}

// ---------- Twitter in-page logic (OpenCLI-derived query-id resolver) ----------
export async function twitterFetch({ screenName, limit, withReplies, bearer, features }) {
  // Inline so these survive stringification into the page context.
  const TWITTER_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRwQAAAAAAqWnK0zYifRSpE0g8r2hnH3AUSOM%3D9oEUOBP2cUeMRRk6OFsUZlWqH';
  const FEATURES = {
    rweb_video_screen_enabled: false, profile_label_improvements_pcf_label_in_post_enabled: true,
    rweb_tipjar_consumption_enabled: true, verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true, c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false, responsive_web_grok_analyze_post_followups_enabled: true,
    responsive_web_jetfuel_frame: false, responsive_web_grok_share_attachment_enabled: true, articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true, graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true, longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true, tweet_awards_web_tipping_enabled: false,
    responsive_web_grok_show_grok_translated_post: false, responsive_web_grok_analysis_button_from_backend: false,
    creator_subscriptions_quote_tweet_preview_enabled: false, freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true, tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true, longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true, responsive_web_enhance_cards_enabled: false,
  };
  function parseOperationFromBundleText(text, operationName) {
    if (!text || !operationName) return null;
    const esc = operationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reA = new RegExp('queryId:"([A-Za-z0-9_-]+)"[^}]{0,400}operationName:"' + esc + '"');
    const reB = new RegExp('operationName:"' + esc + '"[^}]{0,400}queryId:"([A-Za-z0-9_-]+)"');
    let queryId = null, matchIndex = -1;
    const mA = text.match(reA);
    if (mA && typeof mA.index === 'number') { queryId = mA[1]; matchIndex = mA.index; }
    else { const mB = text.match(reB); if (mB && typeof mB.index === 'number') { queryId = mB[1]; matchIndex = mB.index; } }
    if (!queryId) return null;
    const win = text.slice(Math.max(0, matchIndex - 500), Math.min(text.length, matchIndex + 1500));
    const qk = (s) => s ? Array.from(s.matchAll(/"([^"]+)"/g)).map((m) => m[1]) : [];
    const flags = (ks) => Object.fromEntries((ks || []).map((k) => [k, true]));
    return { queryId, features: flags(qk(win.match(/featureSwitches:\[([^\]]*)\]/)?.[1])), fieldToggles: flags(qk(win.match(/fieldToggles:\[([^\]]*)\]/)?.[1])) };
  }
  async function resolveBearer() {
    try {
      const cached = JSON.parse(localStorage.getItem('cdp_tw_bearer') || 'null');
      if (cached && cached.v && Date.now() - cached.t < 30 * 60 * 1000) return cached.v;
    } catch {}
    const getScripts = () => Array.from(document.scripts).map((s) => s.src).filter(Boolean)
      .concat(performance.getEntriesByType('resource').map((r) => r.name).filter((r) => r.includes('client-web') && r.endsWith('.js')));
    for (let i = 0; i < 20; i++) {
      if (getScripts().length) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const scripts = Array.from(new Set(getScripts())).slice(-20);
    for (const url of scripts) {
      try {
        const txt = await (await fetch(url)).text();
        const m = txt.match(/AAAAAAAAAAAAAAAAAAAA[A-Za-z0-9_%-]{20,}/);
        if (m) { try { localStorage.setItem('cdp_tw_bearer', JSON.stringify({ v: m[0], t: Date.now() })); } catch {} return m[0]; }
      } catch {}
    }
    return null;
  }
  async function resolveOp(operationName, fallbackId) {
    const getScripts = () => Array.from(document.scripts).map((s) => s.src).filter(Boolean)
      .concat(performance.getEntriesByType('resource').map((r) => r.name).filter((r) => r.includes('client-web') && r.endsWith('.js')));
    for (let i = 0; i < 15; i++) {
      if (getScripts().length) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const seen = new Set(getScripts());
    const cands = Array.from(seen).slice(-25);
    for (const url of cands) {
      try { const txt = await (await fetch(url)).text(); const op = parseOperationFromBundleText(txt, operationName); if (op) return op; } catch {}
    }
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 5000);
      const r = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json', { signal: c.signal });
      clearTimeout(t);
      if (r.ok) { const d = await r.json(); const e = d && d[operationName]; if (e && e.queryId) return { queryId: e.queryId, features: e.features || {}, fieldToggles: e.fieldToggles || {} }; }
    } catch {}
    return fallbackId ? { queryId: fallbackId, features: {}, fieldToggles: {} } : null;
  }
  const ct0 = (document.cookie.match(/ct0=([^;]+)/) || [])[1];
  if (!ct0) throw new Error('no ct0 cookie — twitter session missing in browser');
  const liveBearer = await resolveBearer();
  if (liveBearer) bearer = liveBearer; else if (!bearer) bearer = TWITTER_BEARER;
  async function run() {
    const op = withReplies ? 'UserTweetsAndReplies' : 'UserTweets';
    const meta = await resolveOp(op, null);
    if (!meta) throw new Error('failed to resolve Twitter query-id for ' + op);
    async function gql(queryId, opName, vars, opFeatures, opToggles) {
      let url = 'https://x.com/i/api/graphql/' + queryId + '/' + opName +
        '?variables=' + encodeURIComponent(JSON.stringify(vars)) +
        '&features=' + encodeURIComponent(JSON.stringify(opFeatures || features));
      if (opToggles) url += '&fieldToggles=' + encodeURIComponent(JSON.stringify(opToggles));
      const res = await fetch(url, { credentials: 'include', headers: { Authorization: 'Bearer ' + bearer, 'x-csrf-token': ct0, 'x-twitter-auth-type': 'OAuth2Session' } });
      if (!res.ok) throw new Error('gql ' + opName + ' http ' + res.status);
      return res.json();
    }
    const byNameMeta = await resolveOp('UserByScreenName', 'Gb-d6r0vxPOADdG62OEBpQ');
    const byName = await gql(byNameMeta.queryId, 'UserByScreenName', { screen_name: screenName, withHighlightedLabel: true }, byNameMeta.features, byNameMeta.fieldToggles);
    const user = byName?.data?.user?.result;
    const userId = user?.rest_id;
    const name = user?.legacy?.name || user?.core?.name;
    if (!userId) throw new Error('user not found: ' + screenName);
    const tweets = await gql(meta.queryId, op, { userId, count: limit, cursor: null, includePromotedContent: false, withQuickPromoteEligibilityTweetFields: true, withVoice: true, withV2Timeline: true }, meta.features, meta.fieldToggles);
    const items = [];
    const userResult = tweets?.data?.user?.result;
    const tl = userResult?.timeline_v2?.timeline || userResult?.timeline?.timeline || userResult?.timeline;
    const instr = tl?.instructions || [];
    for (const ins of instr) {
      const entries = ins?.entries || [];
      for (const e of entries) {
        const tw = e?.content?.itemContent?.tweet_results?.result || e?.content?.tweet_results?.result;
        const legacy = tw?.legacy || tw?.tweet?.legacy;
        if (!legacy) continue;
        const id = legacy.id_str || tw?.rest_id;
        const text = legacy.full_text || '';
        items.push({ id, title: (text.split('\n')[0] || '').slice(0, 120), text, link: 'https://x.com/' + screenName + '/status/' + id, author: screenName, created: legacy.created_at });
        if (items.length >= limit) break;
      }
      if (items.length >= limit) break;
    }
    return { name, profileUrl: 'https://x.com/' + screenName, items };
  }
  try {
    return await run();
  } catch (e) {
    if (String((e && e.message) || '').includes('http 401')) {
      try { localStorage.removeItem('cdp_tw_bearer'); } catch {}
      const b2 = await resolveBearer();
      if (b2) bearer = b2;
      return await run();
    }
    throw e;
  }
}

export function twitterToItems(result) {
  if (!result || !Array.isArray(result.items)) {
    console.error('TWITTER_BAD_RESULT', JSON.stringify(result).slice(0, 800));
    return [];
  }
  return result.items.map((it) => ({
    title: it.title || it.text.slice(0, 120),
    description: it.text,
    link: it.link,
    author: it.author,
    pubDate: it.created ? new Date(it.created).toUTCString() : new Date().toUTCString(),
    guid: it.link,
  }));
}

'use strict';

/**
 * 工作室面试打分系统
 * 启动：node server.js        换端口：PORT=8080 node server.js
 *
 * 组和面试官：首次启动会按下面的 SEED 生成 data/config.json，之后在 App 右上角「管理」里改。
 * 面试者（班级 + 姓名，所有组共用）：在 App 首页「面试者名单」里添加、批量导入、删除。
 */

/* ============ 初始名单（只在 data/config.json 不存在时使用） ============ */
const SEED = {
  title: '工作室面试打分系统',

  // 表达能力：偏弱 60 / 良好 75 / 优秀 90
  expressLevels: [
    { key: 'weak',      label: '偏弱', score: 60 },
    { key: 'good',      label: '良好', score: 75 },
    { key: 'excellent', label: '优秀', score: 90 }
  ],

  // 是否常来工作室：意愿弱 65 / 意愿一般 80 / 意愿强 90
  willingLevels: [
    { key: 'low',  label: '意愿弱',   score: 65 },
    { key: 'mid',  label: '意愿一般', score: 80 },
    { key: 'high', label: '意愿强',   score: 90 }
  ],

  // 所有组共用的面试者名单：[{ id, name, cls }]，在首页「面试者名单」里维护
  candidates: [],

  groups: [
    { id: 'g1', name: '第1组', interviewers: ['张洪涛', '张加美', '田丹', '冉娟'] },
    { id: 'g2', name: '第2组', interviewers: ['申宇轩', '黄红强', '付博'] },
    { id: 'g3', name: '第3组', interviewers: ['陈英开', '陈明峰', '骆丹'] },
    { id: 'g4', name: '第4组', interviewers: ['马运福', '刘院明', '谌艳'] }
  ]
};

const PORT = Number(process.env.PORT || 3000);
/* ====================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

function uid() { return 'c_' + crypto.randomBytes(4).toString('hex'); }
function str(v) { return typeof v === 'string' ? v.trim() : ''; }

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* ---------- 名单：首次启动用 SEED 生成，之后由 App 维护 ---------- */

/* 统一成规范结构：面试官是字符串数组；面试者是全局共用的 { id, name, cls }，
   id 用于关联打分记录，改班级/姓名不会丢分 */
function normalize(cfg) {
  const cd = [];
  const seenCd = Object.create(null);
  function takeCd(c) {
    const o = typeof c === 'string' ? { id: '', name: str(c), cls: '' }
      : { id: str(c && c.id), name: str(c && c.name), cls: str(c && c.cls) };
    if (!o.name) return;
    const key = o.cls + '\u0000' + o.name;
    if (seenCd[key]) return;
    seenCd[key] = 1;
    cd.push({ id: o.id || uid(), name: o.name, cls: o.cls });
  }

  // 旧版把面试者挂在各个组里，这里并入全局名单
  (cfg.groups || []).forEach(function (g) {
    const iv = [], seenIv = Object.create(null);
    (Array.isArray(g.interviewers) ? g.interviewers : []).forEach(function (n) {
      const v = str(n);
      if (v && !seenIv[v]) { seenIv[v] = 1; iv.push(v); }
    });
    g.interviewers = iv;

    (Array.isArray(g.candidates) ? g.candidates : []).forEach(takeCd);
    delete g.candidates;
  });
  (Array.isArray(cfg.candidates) ? cfg.candidates : []).forEach(takeCd);
  cfg.candidates = cd;
  return cfg;
}

let CONFIG = readJSON(CONFIG_FILE, null);
if (!CONFIG || !Array.isArray(CONFIG.groups)) {
  CONFIG = normalize(JSON.parse(JSON.stringify(SEED)));
  writeJSON(CONFIG_FILE, CONFIG);
} else {
  const before = JSON.stringify(CONFIG);
  normalize(CONFIG);
  if (JSON.stringify(CONFIG) !== before) writeJSON(CONFIG_FILE, CONFIG);
}

/* ---------- 打分数据：{ g:组, c:面试者id, i:面试官, e:表达等级, w:意愿等级 } ---------- */
let scores = readJSON(SCORES_FILE, []);
if (!Array.isArray(scores)) scores = [];

/* 兼容早期「用姓名当键」的旧打分数据：能按姓名对上的换成 id */
(function migrate() {
  const byName = {};
  CONFIG.candidates.forEach(function (c) { byName[c.name] = c.id; });
  let changed = false;
  scores.forEach(function (s) {
    if (byName[s.c]) { s.c = byName[s.c]; changed = true; }
  });
  if (changed) writeJSON(SCORES_FILE, scores);
})();

function findGroup(id) {
  return CONFIG.groups.find(function (g) { return g.id === id; }) || null;
}
function levelOf(levels, key) {
  return (levels || []).find(function (l) { return l.key === key; }) || null;
}

/* ---------- 排名：小组只是分场面试，所有组的打分合并成一份统一排名 ---------- */
function unifiedRank() {
  const rows = CONFIG.candidates.map(function (c) {
    const mine = scores.filter(function (s) { return s.c === c.id; });
    const detail = mine
      .map(function (s) {
        const e = levelOf(CONFIG.expressLevels, s.e);
        const w = levelOf(CONFIG.willingLevels, s.w);
        if (!e || !w) return null;
        return {
          interviewer: s.i,
          expressLabel: e.label, expressScore: e.score,
          willingLabel: w.label, willingScore: w.score,
          total: e.score + w.score
        };
      })
      .filter(Boolean)
      .sort(function (a, b) { return a.interviewer.localeCompare(b.interviewer, 'zh'); });

    // 这位面试者是哪个组面试的（正常只有一个组；万一多个组都评过，total 不再准确）
    const gids = [];
    mine.forEach(function (s) { if (gids.indexOf(s.g) < 0) gids.push(s.g); });
    let total = null;
    if (gids.length === 1) {
      const g0 = findGroup(gids[0]);
      total = g0 ? g0.interviewers.length : null;
    }
    const groupNames = gids.map(function (gid) {
      const g0 = findGroup(gid);
      return g0 ? g0.name : '';
    }).filter(Boolean);

    const n = detail.length;
    let sum = 0;
    detail.forEach(function (d) { sum += d.total; });

    return {
      id: c.id,
      name: c.name,
      cls: c.cls,
      count: n,
      total: total,
      groups: groupNames,
      avg: n ? Math.round(sum / n * 100) / 100 : null,
      detail: detail
    };
  });

  const done = rows.filter(function (r) { return r.count > 0; })
    .sort(function (a, b) { return b.avg - a.avg || a.name.localeCompare(b.name, 'zh'); });
  const todo = rows.filter(function (r) { return r.count === 0; })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });

  const out = done.concat(todo);
  let last = null, lastRank = 0;
  out.forEach(function (r, i) {
    if (r.count === 0) { r.rank = null; return; }
    if (last !== null && r.avg === last) { r.rank = lastRank; }
    else { r.rank = i + 1; lastRank = r.rank; last = r.avg; }
  });

  return { rows: out };
}

/* ---------- HTTP ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml'
};

function json(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
  res.end(buf);
}
function text(res, code, msg) {
  const buf = Buffer.from(String(msg), 'utf8');
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    const c = [];
    req.on('data', function (x) { c.push(x); });
    req.on('end', function () { resolve(Buffer.concat(c).toString('utf8')); });
    req.on('error', reject);
  });
}

const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  const method = (req.method || 'GET').toUpperCase();

  /* 允许部署在子路径下，例如 http://ip/interview/ */
  const at = u.pathname.indexOf('/api/');
  const p = at >= 0 ? u.pathname.slice(at) : u.pathname;

  /* ---- 静态页面 ---- */
  if (at < 0) {
    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    if (rel.indexOf('..') >= 0) return text(res, 403, 'Forbidden');
    const file = path.join(PUBLIC_DIR, rel);
    return fs.readFile(file, function (err, buf) {
      if (err) return text(res, 404, 'Not Found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  }

  /* ---- 读取名单与评分标准 ---- */
  if (p === '/api/config' && method === 'GET') {
    return json(res, 200, {
      title: CONFIG.title,
      expressLevels: CONFIG.expressLevels,
      willingLevels: CONFIG.willingLevels,
      candidates: CONFIG.candidates,
      groups: CONFIG.groups
    });
  }

  /* ---- 某位面试官已打的分 ---- */
  if (p === '/api/mine' && method === 'GET') {
    const g = u.searchParams.get('g') || '';
    const i = u.searchParams.get('i') || '';
    return json(res, 200, {
      list: scores
        .filter(function (s) { return s.g === g && s.i === i; })
        .map(function (s) { return { c: s.c, e: s.e, w: s.w }; })
    });
  }

  /* ---- 提交打分（同一人重复提交自动覆盖） ---- */
  if (p === '/api/score' && method === 'POST') {
    return readBody(req).then(function (raw) {
      let d;
      try { d = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: '数据格式错误' }); }

      const g = findGroup(d.g);
      if (!g) return json(res, 400, { error: '组不存在' });
      if (!g.interviewers.length) return json(res, 400, { error: '该组还没有面试官' });
      if (g.interviewers.indexOf(d.i) < 0) return json(res, 400, { error: '面试官不在该组名单中' });
      if (!CONFIG.candidates.some(function (c) { return c.id === d.c; })) {
        return json(res, 400, { error: '面试者不在名单中' });
      }
      if (!levelOf(CONFIG.expressLevels, d.e)) return json(res, 400, { error: '表达能力等级无效' });
      if (!levelOf(CONFIG.willingLevels, d.w)) return json(res, 400, { error: '意愿等级无效' });

      const old = scores.find(function (s) { return s.g === d.g && s.c === d.c && s.i === d.i; });
      if (old) { old.e = d.e; old.w = d.w; }
      else scores.push({ g: d.g, c: d.c, i: d.i, e: d.e, w: d.w });
      writeJSON(SCORES_FILE, scores);
      return json(res, 200, { ok: true });
    }).catch(function (e) { return json(res, 500, { error: String(e.message || e) }); });
  }

  /* ---- 排名（所有组合并的统一排名） ---- */
  if (p === '/api/rank' && method === 'GET') {
    return json(res, 200, unifiedRank());
  }

  /* ---- 管理名单 ----
     面试官（按组）：{ g, kind:'iv', op:'add'|'del', name }
     面试者（全局共用）：{ kind:'cd', op:'add', name, cls }
                        { kind:'cd', op:'del', id }
                        { kind:'cd', op:'batch', items:[{name,cls}, ...] }   */
  if (p === '/api/manage' && method === 'POST') {
    return readBody(req).then(function (raw) {
      let d;
      try { d = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: '数据格式错误' }); }

      /* --- 面试官（按组维护） --- */
      if (d.kind === 'iv') {
        const g = findGroup(d.g);
        if (!g) return json(res, 400, { error: '组不存在' });

        const name = str(d.name);
        if (!name) return json(res, 400, { error: '名字不能为空' });
        if (name.length > 20) return json(res, 400, { error: '名字太长了' });

        if (d.op === 'add') {
          if (g.interviewers.indexOf(name) >= 0) return json(res, 400, { error: '「' + name + '」已经在名单里了' });
          g.interviewers.push(name);
        } else if (d.op === 'del') {
          const idx = g.interviewers.indexOf(name);
          if (idx < 0) return json(res, 400, { error: '名单里没有这个名字' });
          g.interviewers.splice(idx, 1);
          // 同步清掉相关打分，避免残留分数干扰排名
          scores = scores.filter(function (s) { return !(s.g === g.id && s.i === name); });
          writeJSON(SCORES_FILE, scores);
        } else {
          return json(res, 400, { error: '操作错误' });
        }
        writeJSON(CONFIG_FILE, CONFIG);
        return json(res, 200, { ok: true, groups: CONFIG.groups });
      }

      /* --- 面试者：所有组共用一份名单 --- */
      if (d.kind === 'cd') {
        if (d.op === 'add' || d.op === 'batch') {
          const items = d.op === 'add'
            ? [{ name: str(d.name), cls: str(d.cls) }]
            : (Array.isArray(d.items) ? d.items : []).map(function (it) {
                return { name: str(it && it.name), cls: str(it && it.cls) };
              });
          if (!items.length) return json(res, 400, { error: '没有可添加的名单' });

          const seen = Object.create(null);
          CONFIG.candidates.forEach(function (c) { seen[c.cls + '\u0000' + c.name] = 1; });
          let added = 0, skipped = 0;
          items.forEach(function (it) {
            if (!it.name || it.name.length > 20 || it.cls.length > 30) { skipped++; return; }
            const key = it.cls + '\u0000' + it.name;
            if (seen[key]) { skipped++; return; }
            seen[key] = 1;
            CONFIG.candidates.push({ id: uid(), name: it.name, cls: it.cls });
            added++;
          });
          if (!added) {
            return json(res, 400, {
              error: d.op === 'batch'
                ? '没有添加任何人：姓名为空、太长，或都已在名单里'
                : (items[0].name ? '「' + (items[0].cls ? items[0].cls + ' ' : '') + items[0].name + '」已经在名单里了' : '姓名不能为空')
            });
          }
          writeJSON(CONFIG_FILE, CONFIG);
          return json(res, 200, { ok: true, candidates: CONFIG.candidates, added: added, skipped: skipped });
        }

        if (d.op === 'del') {
          const id = str(d.id);
          const idx = CONFIG.candidates.findIndex(function (c) { return c.id === id; });
          if (idx < 0) return json(res, 400, { error: '名单里没有这个人' });
          CONFIG.candidates.splice(idx, 1);
          // 同步清掉所有组里此人的打分
          scores = scores.filter(function (s) { return s.c !== id; });
          writeJSON(SCORES_FILE, scores);
          writeJSON(CONFIG_FILE, CONFIG);
          return json(res, 200, { ok: true, candidates: CONFIG.candidates });
        }

        return json(res, 400, { error: '操作错误' });
      }

      return json(res, 400, { error: '类型错误' });
    }).catch(function (e) { return json(res, 500, { error: String(e.message || e) }); });
  }

  return json(res, 404, { error: '接口不存在' });
});

server.on('error', function (e) {
  if (e && e.code === 'EADDRINUSE') {
    console.error('');
    console.error('  端口 ' + PORT + ' 已被占用。');
    console.error('  换个端口再启动，例如：');
    console.error('    PORT=8080 node server.js');
    console.error('');
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('');
  console.log('  工作室面试打分系统已启动');
  console.log('  监听端口：' + PORT);
  console.log('  手机访问：http://<服务器IP>:' + PORT + '/');
  console.log('');
});

'use strict';

/**
 * 工作室面试打分系统
 * 启动：node server.js        换端口：PORT=8080 node server.js
 *
 * 组、面试官、面试者名单：首次启动会按下面的 SEED 生成 data/config.json，
 * 之后请直接在 App 右上角「管理」里改，不用再动代码。
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

  groups: [
    { id: 'g1', name: '第1组', interviewers: ['张洪涛', '张加美', '田丹', '冉娟'], candidates: [] },
    { id: 'g2', name: '第2组', interviewers: ['申宇轩', '黄红强', '付博'], candidates: [] },
    { id: 'g3', name: '第3组', interviewers: ['陈英开', '陈明峰', '骆丹'], candidates: [] },
    { id: 'g4', name: '第4组', interviewers: ['马运福', '刘院明', '谌艳'], candidates: [] }
  ]
};

const PORT = Number(process.env.PORT || 3000);
/* ====================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* ---------- 名单：首次启动用 SEED 生成，之后由 App 里的「管理」维护 ---------- */
let CONFIG = readJSON(CONFIG_FILE, null);
if (!CONFIG || !Array.isArray(CONFIG.groups)) {
  CONFIG = JSON.parse(JSON.stringify(SEED));
  writeJSON(CONFIG_FILE, CONFIG);
}

/* ---------- 打分数据：{ g:组, c:面试者, i:面试官, e:表达等级, w:意愿等级 } ---------- */
let scores = readJSON(SCORES_FILE, []);
if (!Array.isArray(scores)) scores = [];

function findGroup(id) {
  return CONFIG.groups.find(function (g) { return g.id === id; }) || null;
}
function levelOf(levels, key) {
  return (levels || []).find(function (l) { return l.key === key; }) || null;
}

/* ---------- 排名：同组所有面试官打分的平均分 ---------- */
function rankOf(group) {
  const rows = group.candidates.map(function (name) {
    const detail = scores
      .filter(function (s) { return s.g === group.id && s.c === name; })
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

    const n = detail.length;
    let sum = 0;
    detail.forEach(function (d) { sum += d.total; });

    return {
      name: name,
      count: n,
      total: group.interviewers.length,
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

  return { groupId: group.id, groupName: group.name, rows: out };
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
      if (g.candidates.indexOf(d.c) < 0) return json(res, 400, { error: '面试者不在该组名单中' });
      if (!levelOf(CONFIG.expressLevels, d.e)) return json(res, 400, { error: '表达能力等级无效' });
      if (!levelOf(CONFIG.willingLevels, d.w)) return json(res, 400, { error: '意愿等级无效' });

      const old = scores.find(function (s) { return s.g === d.g && s.c === d.c && s.i === d.i; });
      if (old) { old.e = d.e; old.w = d.w; }
      else scores.push({ g: d.g, c: d.c, i: d.i, e: d.e, w: d.w });
      writeJSON(SCORES_FILE, scores);
      return json(res, 200, { ok: true });
    }).catch(function (e) { return json(res, 500, { error: String(e.message || e) }); });
  }

  /* ---- 排名 ---- */
  if (p === '/api/rank' && method === 'GET') {
    return json(res, 200, { groups: CONFIG.groups.map(rankOf) });
  }

  /* ---- 管理名单：增删面试官 / 面试者 ---- */
  if (p === '/api/manage' && method === 'POST') {
    return readBody(req).then(function (raw) {
      let d;
      try { d = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: '数据格式错误' }); }

      const g = findGroup(d.g);
      if (!g) return json(res, 400, { error: '组不存在' });

      const name = String(d.name || '').trim();
      if (!name) return json(res, 400, { error: '名字不能为空' });
      if (name.length > 20) return json(res, 400, { error: '名字太长了' });

      const key = d.kind === 'iv' ? 'interviewers' : d.kind === 'cd' ? 'candidates' : null;
      if (!key) return json(res, 400, { error: '类型错误' });
      const list = g[key];

      if (d.op === 'add') {
        if (list.indexOf(name) >= 0) return json(res, 400, { error: '「' + name + '」已经在名单里了' });
        list.push(name);
      } else if (d.op === 'del') {
        const idx = list.indexOf(name);
        if (idx < 0) return json(res, 400, { error: '名单里没有这个名字' });
        list.splice(idx, 1);
        // 同步清掉相关打分，避免残留分数干扰排名
        const before = scores.length;
        scores = scores.filter(function (s) {
          if (s.g !== g.id) return true;
          return key === 'candidates' ? s.c !== name : s.i !== name;
        });
        if (scores.length !== before) writeJSON(SCORES_FILE, scores);
      } else {
        return json(res, 400, { error: '操作错误' });
      }

      writeJSON(CONFIG_FILE, CONFIG);
      return json(res, 200, { ok: true, groups: CONFIG.groups });
    }).catch(function (e) { return json(res, 500, { error: String(e.message || e) }); });
  }

  return json(res, 404, { error: '接口不存在' });
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('');
  console.log('  工作室面试打分系统已启动');
  console.log('  手机访问：http://<服务器IP>:' + PORT + '/');
  console.log('');
});

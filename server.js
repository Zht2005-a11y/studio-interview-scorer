'use strict';

/**
 * 工作室面试打分系统
 * 启动：node server.js        换端口：PORT=8080 node server.js
 *
 * 面试官（全局一份名单，所有小组共用）：在 App 右上角「管理」里增删。
 * 小组只是分场面试（提高同时面试的效率），不做任何名单隔离。
 * 轮次（多轮面试）：各轮共用同一套小组与面试官，分数按轮隔离统计。
 * 打分项（动态，如 表达能力 / 是否常来工作室）：右上角「管理」里可增删，
 *   每个打分项有若干等级（名称 + 分值），打分记录里按打分项存等级。
 * 面试者（班级 + 姓名，所有组共用）：在 App 首页「面试者名单」里添加、批量导入、删除。
 */

/* ============ 初始名单（只在 data/config.json 不存在时使用） ============ */
const SEED = {
  title: '工作室面试打分系统',

  // 打分项：每个打分项含若干等级 { key, label, score }，可在 App 里增删打分项
  dimensions: [
    // 表达能力：偏弱 60 / 良好 75 / 优秀 90
    {
      id: 'e', name: '表达能力',
      levels: [
        { key: 'weak',      label: '偏弱', score: 60 },
        { key: 'good',      label: '良好', score: 75 },
        { key: 'excellent', label: '优秀', score: 90 }
      ]
    },
    // 是否常来工作室：意愿弱 65 / 意愿一般 80 / 意愿强 90
    {
      id: 'w', name: '是否常来工作室',
      levels: [
        { key: 'low',  label: '意愿弱',   score: 65 },
        { key: 'mid',  label: '意愿一般', score: 80 },
        { key: 'high', label: '意愿强',   score: 90 }
      ]
    }
  ],

  // 所有组共用的面试者名单：[{ id, name, cls }]，在首页「面试者名单」里维护
  candidates: [],

  // 面试官：全局一份名单，所有小组共用（右上角「管理面试官」里维护）
  interviewers: ['张洪涛', '张加美', '田丹', '冉娟', '申宇轩', '黄红强', '付博',
                 '陈英开', '陈明峰', '骆丹', '马运福', '刘院明', '谌艳'],

  // 轮次：多轮面试共用同一套小组与面试官配置，分数按轮分开统计。
  // dims = 本轮考察哪些打分项（显式列出，不做任何隐式包含）；空数组 = 还没配置
  rounds: [
    { id: 'r1', name: '第1轮', dims: ['e', 'w'] },
    { id: 'r2', name: '第2轮', dims: ['e', 'w'] }
  ],

  // 小组：每组配置自己的面试官（打分页进组后只列出本组的面试官）；
  // 全局面试官池 = 各组名单的并集，在「管理 → 面试官」里维护
  groups: [
    { id: 'g1', name: '第1组', interviewers: ['张洪涛', '张加美', '田丹', '冉娟'] },
    { id: 'g2', name: '第2组', interviewers: ['申宇轩', '黄红强', '付博'] },
    { id: 'g3', name: '第3组', interviewers: ['陈英开', '陈明峰', '骆丹'] },
    { id: 'g4', name: '第4组', interviewers: ['马运福', '刘院明', '谌艳'] }
  ]
};

// 旧数据迁移用：没有按组配置面试官的老数据，按上面的名单自动补齐（只补一次，之后以 App 里维护的为准）
const LEGACY_GROUP_IV = [
  { match: ['g1', '第1组'], iv: ['张洪涛', '张加美', '田丹', '冉娟'] },
  { match: ['g2', '第2组'], iv: ['申宇轩', '黄红强', '付博'] },
  { match: ['g3', '第3组'], iv: ['陈英开', '陈明峰', '骆丹'] },
  { match: ['g4', '第4组'], iv: ['马运福', '刘院明', '谌艳'] }
];

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

/* 统一成规范结构：
   面试官是全局一份字符串数组（各组共用，旧版本挂在组里的名单会自动并进来）；
   面试者是全局共用的 { id, name, cls }，id 用于关联打分记录，改班级/姓名不会丢分 */
function normalize(cfg) {
  const iv = [], seenIv = Object.create(null);
  function takeIv(n) {
    const v = str(n);
    if (v && !seenIv[v]) { seenIv[v] = 1; iv.push(v); }
  }

  const cd = [];
  const seenCd = Object.create(null);
  function takeCd(c) {
    const o = typeof c === 'string' ? { id: '', name: str(c), cls: '' }
      : { id: str(c && c.id), name: str(c && c.name), cls: str(c && c.cls) };
    if (!o.name) return;
    const key = o.cls + '\u0000' + o.name;
    if (seenCd[key]) return;
    seenCd[key] = 1;
    const item = { id: o.id || uid(), name: o.name, cls: o.cls };
    // 评语挂在这个人身上，重启/迁移时不能丢
    const cm = c && c.comment;
    if (cm && str(cm.text)) {
      item.comment = { text: str(cm.text), by: str(cm.by), ts: Number(cm.ts) || Date.now() };
    }
    cd.push(item);
  }

  // 各组的面试官保留在组上（打分页进组后按组列出），同时并入全局面试官池
  (cfg.groups || []).forEach(function (g) {
    (Array.isArray(g.interviewers) ? g.interviewers : []).forEach(takeIv);
    (Array.isArray(g.candidates) ? g.candidates : []).forEach(takeCd);
    delete g.candidates;
  });
  // 老数据没有按组配置：按线上既定的 4 组名单自动补齐（只在字段缺失时补，App 里改过就不再动）
  LEGACY_GROUP_IV.forEach(function (m) {
    m.match.forEach(function (key) {
      const g = cfg.groups.find(function (x) { return x.id === key || x.name === key; });
      if (g && !Array.isArray(g.interviewers)) {
        g.interviewers = m.iv.slice();
        m.iv.forEach(takeIv);
      }
    });
  });
  (Array.isArray(cfg.interviewers) ? cfg.interviewers : []).forEach(takeIv);
  (Array.isArray(cfg.candidates) ? cfg.candidates : []).forEach(takeCd);
  cfg.interviewers = iv;
  cfg.candidates = cd;

  // 轮次：旧数据没有 rounds 时补上第一轮/第二轮，之后可在 App 里增删
  if (!Array.isArray(cfg.rounds) || !cfg.rounds.length) {
    cfg.rounds = [{ id: 'r1', name: '第1轮' }, { id: 'r2', name: '第2轮' }];
  } else {
    cfg.rounds = cfg.rounds.map(function (r) {
      return { id: str(r && r.id) || 'r_' + crypto.randomBytes(3).toString('hex'), name: str(r && r.name) || '轮次' };
    });
  }

  // 小组：分场面试用，可在 App 里增删；每组配置自己的面试官
  if (!Array.isArray(cfg.groups) || !cfg.groups.length) {
    cfg.groups = SEED.groups.map(function (g) { return { id: g.id, name: g.name, interviewers: (g.interviewers || []).slice() }; });
  } else {
    cfg.groups = cfg.groups.map(function (g) {
      return {
        id: str(g && g.id) || 'g_' + crypto.randomBytes(3).toString('hex'),
        name: str(g && g.name) || '小组',
        interviewers: Array.isArray(g.interviewers) ? g.interviewers : []
      };
    });
  }

  // 打分项：旧版固定两个（expressLevels / willingLevels），统一成动态 dimensions
  const normLv = function (lv, i) {
    return {
      key: str(lv && lv.key) || 'lv' + i,
      label: str(lv && lv.label) || ('等级' + (i + 1)),
      score: Number(lv && lv.score) || 0
    };
  };
  /* 打分项两种类型：
     - 选等级型（默认）：{ id, name, levels:[{key,label,score}] }
     - 自由填分型：      { id, name, mode:'free', max } —— 面试官自己填 0~max 的分数
     老数据没有 mode 字段，一律按「选等级型」处理，行为不变。 */
  const normMax = function (v) {
    const n = Number(v);
    return (isFinite(n) && n >= 1 && n <= 999) ? Math.round(n) : 100;
  };
  const normDim = function (dm, di) {
    const id = str(dm && dm.id) || 'd_' + crypto.randomBytes(3).toString('hex');
    const name = str(dm && dm.name) || ('打分项' + (di + 1));
    if (dm && dm.mode === 'free') {
      return { id: id, name: name, mode: 'free', max: normMax(dm.max) };
    }
    return { id: id, name: name, levels: (Array.isArray(dm && dm.levels) ? dm.levels : []).map(normLv) };
  };
  if (Array.isArray(cfg.dimensions) && cfg.dimensions.length) {
    cfg.dimensions = cfg.dimensions.map(normDim);
  } else {
    const eLv = Array.isArray(cfg.expressLevels) && cfg.expressLevels.length
      ? cfg.expressLevels
      : (SEED.dimensions.find(function (d) { return d.id === 'e'; }) || {}).levels;
    const wLv = Array.isArray(cfg.willingLevels) && cfg.willingLevels.length
      ? cfg.willingLevels
      : (SEED.dimensions.find(function (d) { return d.id === 'w'; }) || {}).levels;
    cfg.dimensions = [
      { id: 'e', name: '表达能力', levels: eLv.map(normLv) },
      { id: 'w', name: '是否常来工作室', levels: wLv.map(normLv) }
    ];
  }
  // dimensions 是唯一事实来源，旧字段不再保留
  delete cfg.expressLevels;
  delete cfg.willingLevels;

  // 轮次考察范围：rounds[].dims = 打分项 id 白名单，**显式列出、不做任何隐式包含**。
  // 空数组 = 该轮还没配置（此时这一轮打不了分，界面上会提示去配置）。
  // 老数据没有该字段时，一次性落成"当前全部打分项"，保证行为不变；之后完全由用户显式维护。
  const dimIdSet = Object.create(null);
  cfg.dimensions.forEach(function (d) { dimIdSet[d.id] = 1; });
  const allDimIds = cfg.dimensions.map(function (d) { return d.id; });
  cfg.rounds.forEach(function (r) {
    if (!Array.isArray(r.dims)) { r.dims = allDimIds.slice(); return; }
    const seen = Object.create(null);
    const list = [];
    r.dims.forEach(function (id) {
      const v = str(id);
      if (v && dimIdSet[v] && !seen[v]) { seen[v] = 1; list.push(v); }
    });
    r.dims = list;   // 允许为空
  });
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

/* ---------- 打分数据：{ r:轮次, g:组, c:面试者id, i:面试官, e:表达等级, w:意愿等级 } ---------- */
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

/* 兼容没有轮次字段的旧打分数据：全部归到第一轮（历史分数都是一轮面试产生的） */
(function migrateRounds() {
  const def = CONFIG.rounds.length ? CONFIG.rounds[0].id : 'r1';
  let changed = false;
  scores.forEach(function (s) { if (!s.r) { s.r = def; changed = true; } });
  if (changed) writeJSON(SCORES_FILE, scores);
})();

/* 兼容旧打分数据：固定字段 e/w 并入通用 dims；已删除的打分项从记录里清掉 */
(function migrateDims() {
  const validIds = {};
  CONFIG.dimensions.forEach(function (d) { validIds[d.id] = 1; });
  let changed = false;
  scores.forEach(function (s) {
    if (!s.dims || typeof s.dims !== 'object') { s.dims = {}; changed = true; }
    if (s.e || s.w) {
      if (validIds.e && s.e) s.dims.e = s.e;
      if (validIds.w && s.w) s.dims.w = s.w;
      delete s.e; delete s.w;
      changed = true;
    }
    Object.keys(s.dims).forEach(function (k) {
      if (!validIds[k]) { delete s.dims[k]; changed = true; }
    });
  });
  if (changed) writeJSON(SCORES_FILE, scores);
})();

function findGroup(id) {
  return CONFIG.groups.find(function (g) { return g.id === id; }) || null;
}
function findRound(id) {
  return CONFIG.rounds.find(function (r) { return r.id === id; }) || null;
}
function dimOf(dimId, dims) {
  const d = CONFIG.dimensions.find(function (x) { return x.id === dimId; });
  return d ? levelOf(d.levels, dims && dims[dimId]) : null;
}
function levelOf(levels, key) {
  return (levels || []).find(function (l) { return l.key === key; }) || null;
}

/* 某一轮次实际考察的打分项（按全局顺序返回）。
   rounds[].dims 是显式白名单；空数组表示这一轮还没配置。 */
function dimsOfRound(roundId) {
  const rd = findRound(roundId);
  if (!rd || !Array.isArray(rd.dims)) return CONFIG.dimensions;   // 轮次已被删等兜底
  const set = Object.create(null);
  rd.dims.forEach(function (id) { set[id] = 1; });
  return CONFIG.dimensions.filter(function (d) { return set[d.id]; });
}

/* 一条打分记录 -> { items:[{name,label,score}], total }
   总分只累计「该记录所属轮次考察范围之内」的打分项 —— 本轮不考察的项不计入。
   自由填分型没有 label，前端按 label 为空处理。 */
function detailOf(s) {
  const dm = s.dims || {};
  const items = [];
  let total = 0;
  dimsOfRound(s.r).forEach(function (d) {
    if (d.mode === 'free') {
      const v = Number(dm[d.id]);
      if (isFinite(v) && v >= 0) { items.push({ name: d.name, label: '', score: v }); total += v; }
      return;
    }
    const lv = levelOf(d.levels, dm[d.id]);
    if (lv) { items.push({ name: d.name, label: lv.label, score: lv.score }); total += lv.score; }
  });
  return { items: items, total: total };
}

/* 通用排名行：rs 为打分记录集合，pred 进一步筛选（按组等）；返回带竞争排名的行数组 */
function rankRows(rs, pred) {
  const rows = CONFIG.candidates.map(function (c) {
    const mine = rs.filter(function (s) { return s.c === c.id && (!pred || pred(s)); });
    const detail = mine
      .map(function (s) {
        const dv = detailOf(s);
        // 旧版页面兼容字段（固定两个打分项）
        const eL = dimOf('e', s.dims || {});
        const wL = dimOf('w', s.dims || {});
        return {
          interviewer: s.i,
          items: dv.items,
          total: dv.total,
          expressLabel: eL ? eL.label : '',
          expressScore: eL ? eL.score : 0,
          willingLabel: wL ? wL.label : '',
          willingScore: wL ? wL.score : 0
        };
      })
      .filter(function (d) { return d.items.length > 0; })
      .sort(function (a, b) { return a.interviewer.localeCompare(b.interviewer, 'zh'); });

    const n = detail.length;
    let sum = 0;
    detail.forEach(function (d) { sum += d.total; });

    return {
      id: c.id,
      name: c.name,
      cls: c.cls,
      count: n,
      total: CONFIG.interviewers.length,
      avg: n ? Math.round(sum / n * 100) / 100 : null,
      detail: detail,
      comment: c.comment || null
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
  return out;
}

/* ---------- 排名（旧版按组格式，仅用于兼容还没刷新缓存的旧页面） ---------- */
function rankOf(group, r) {
  const rs = scores.filter(function (s) { return s.r === r; });
  return {
    groupId: group.id,
    groupName: group.name,
    rows: rankRows(rs, function (s) { return s.g === group.id; })
  };
}

/* ---------- 排名：小组只是分场面试，一轮内所有组的打分合并成一份统一排名 ---------- */
function unifiedRank(r) {
  const rs = scores.filter(function (s) { return s.r === r; });
  return { rows: rankRows(rs, null) };
}

/* ---------- 总排名：跨所有轮次、所有小组，综合成一份总平均分排名（明细里标注每条分数来自哪一轮） ---------- */
function overallRank() {
  const rows = CONFIG.candidates.map(function (c) {
    const mine = scores.filter(function (s) { return s.c === c.id; });
    const detail = mine
      .map(function (s) {
        const dv = detailOf(s);
        const rd = findRound(s.r);
        return {
          interviewer: s.i,
          round: rd ? rd.name : '',
          items: dv.items,
          total: dv.total
        };
      })
      .filter(function (d) { return d.items.length > 0; })
      .sort(function (a, b) {
        return a.interviewer.localeCompare(b.interviewer, 'zh') || a.round.localeCompare(b.round, 'zh');
      });

    const n = detail.length;
    let sum = 0;
    detail.forEach(function (d) { sum += d.total; });

    return {
      id: c.id,
      name: c.name,
      cls: c.cls,
      count: n,
      avg: n ? Math.round(sum / n * 100) / 100 : null,
      detail: detail,
      comment: c.comment || null
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
  return out;
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
      // 禁止缓存：否则部署新版后，手机上残留的旧页面会拿旧字段请求新接口
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  }

  /* ---- 读取名单与评分标准 ---- */
  if (p === '/api/config' && method === 'GET') {
    const out = {
      title: CONFIG.title,
      dimensions: CONFIG.dimensions,
      interviewers: CONFIG.interviewers,
      candidates: CONFIG.candidates,
      groups: CONFIG.groups,
      rounds: CONFIG.rounds
    };
    // 旧版页面兼容：固定两个打分项的等级表
    const eDim = CONFIG.dimensions.find(function (d) { return d.id === 'e'; });
    const wDim = CONFIG.dimensions.find(function (d) { return d.id === 'w'; });
    if (eDim) out.expressLevels = eDim.levels;
    if (wDim) out.willingLevels = wDim.levels;
    return json(res, 200, out);
  }

  /* ---- 某位面试官在某轮已打的分（dims：打分项id -> 等级key） ---- */
  if (p === '/api/mine' && method === 'GET') {
    const g = u.searchParams.get('g') || '';
    const i = u.searchParams.get('i') || '';
    const rd = findRound(u.searchParams.get('r')) || CONFIG.rounds[0];
    return json(res, 200, {
      list: scores
        .filter(function (s) { return s.r === rd.id && s.g === g && s.i === i; })
        .map(function (s) { return { c: s.c, dims: s.dims || {} }; })
    });
  }

  /* ---- 某轮里每位面试者已被哪个组评分（跨组锁定状态） ---- */
  if (p === '/api/scored' && method === 'GET') {
    const rd = findRound(u.searchParams.get('r')) || CONFIG.rounds[0];
    const of = {};
    scores.filter(function (s) { return s.r === rd.id; }).forEach(function (s) {
      if (!of[s.c]) of[s.c] = s.g;
    });
    return json(res, 200, { of: of });
  }

  /* ---- 提交打分（同一轮次内重复提交自动覆盖；不同轮次分数互相独立） ---- */
  if (p === '/api/score' && method === 'POST') {
    return readBody(req).then(function (raw) {
      let d;
      try { d = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: '数据格式错误' }); }

      const rd = findRound(d.r) || CONFIG.rounds[0];
      const g = findGroup(d.g);
      if (!g) return json(res, 400, { error: '组不存在' });
      // 面试官校验：该组配置了面试官名单时，只能由本组配置的人打分；没配置的组回落到全局面试官池
      const gIv = Array.isArray(g.interviewers) ? g.interviewers : [];
      if (gIv.length) {
        if (gIv.indexOf(d.i) < 0) return json(res, 400, { error: '「' + d.i + '」不在' + g.name + '的面试官配置里' });
      } else if (CONFIG.interviewers.length && CONFIG.interviewers.indexOf(d.i) < 0) {
        return json(res, 400, { error: '面试官不在名单中' });
      }
      if (!CONFIG.candidates.some(function (c) { return c.id === d.c; })) {
        return json(res, 400, { error: '面试者不在名单中' });
      }
      // 校验各打分项等级：d.dims（新版）或 d.e / d.w（旧版页面兼容）
      // 只接受「本轮考察范围之内」的打分项，范围外的直接丢弃（不报错，兼容旧页面与历史数据）
      const scope = Object.create(null);
      dimsOfRound(rd.id).forEach(function (x) { scope[x.id] = 1; });
      const dimsIn = {};
      const badDims = [];
      if (d.dims && typeof d.dims === 'object') {
        Object.keys(d.dims).forEach(function (k) {
          const dm = CONFIG.dimensions.find(function (x) { return x.id === k; });
          if (!dm) { badDims.push(k); return; }
          if (dm.mode === 'free') {
            const v = Number(d.dims[k]);
            if (!isFinite(v) || v < 0 || v > dm.max) { badDims.push(k); return; }
            if (scope[k]) dimsIn[k] = Math.round(v);
            return;
          }
          if (!levelOf(dm.levels, d.dims[k])) { badDims.push(k); return; }
          if (scope[k]) dimsIn[k] = d.dims[k];
        });
      }
      if (d.e !== undefined || d.w !== undefined) {
        [['e', d.e], ['w', d.w]].forEach(function (pair) {
          const dm = CONFIG.dimensions.find(function (x) { return x.id === pair[0]; });
          if (!pair[1]) return;
          if (!dm) { badDims.push(pair[0]); return; }
          if (dm.mode === 'free') {
            const v = Number(pair[1]);
            if (!isFinite(v) || v < 0 || v > dm.max) { badDims.push(pair[0]); return; }
            if (scope[pair[0]]) dimsIn[pair[0]] = Math.round(v);
            return;
          }
          if (!levelOf(dm.levels, pair[1])) { badDims.push(pair[0]); return; }
          if (scope[pair[0]]) dimsIn[pair[0]] = pair[1];
        });
      }
      if (badDims.length) return json(res, 400, { error: '打分项或等级无效' });
      if (!Object.keys(dimsIn).length) return json(res, 400, { error: '没有打分内容' });

      /* 同一轮内一位面试者只由一个组评分：该轮里已被其他组评过、本组还没评过的，拒绝 */
      const inRound = scores.filter(function (s) { return s.r === rd.id; });
      const other = inRound.find(function (s) { return s.c === d.c && s.g !== d.g; });
      if (other && !inRound.some(function (s) { return s.c === d.c && s.g === d.g; })) {
        const og = findGroup(other.g);
        return json(res, 400, { error: '该面试者已由「' + (og ? og.name : '其他组') + '」评分，其他组不能再评' });
      }

      /* 覆盖式更新：同一条记录里逐项合并（旧页面只发 e/w 时不会清掉其他打分项）
         同时丢弃「已不在本轮考察范围内」的旧项，保持记录干净 */
      const old = inRound.find(function (s) { return s.g === d.g && s.c === d.c && s.i === d.i; });
      if (old) {
        const merged = {};
        Object.keys(old.dims || {}).forEach(function (k) { if (scope[k]) merged[k] = old.dims[k]; });
        Object.keys(dimsIn).forEach(function (k) { merged[k] = dimsIn[k]; });
        old.dims = merged;
      } else {
        scores.push({ r: rd.id, g: d.g, c: d.c, i: d.i, dims: dimsIn });
      }
      writeJSON(SCORES_FILE, scores);
      return json(res, 200, { ok: true });
    }).catch(function (e) { return json(res, 500, { error: String(e.message || e) }); });
  }

  /* ---- 面试者评语（每人一条，可添加可编辑，记录填写人） ---- */
  if (p === '/api/comment' && method === 'POST') {
    return readBody(req).then(function (raw) {
      let d;
      try { d = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: '数据格式错误' }); }

      const c = CONFIG.candidates.find(function (x) { return x.id === str(d.c); });
      if (!c) return json(res, 400, { error: '面试者不在名单中' });
      const by = str(d.by);
      if (!by || by.length > 20) return json(res, 400, { error: '填写人无效' });
      if (CONFIG.interviewers.indexOf(by) < 0) return json(res, 400, { error: '填写人不在面试官名单中' });

      const text = str(d.text).slice(0, 200);
      if (text) c.comment = { text: text, by: by, ts: Date.now() };
      else delete c.comment;   // 空评语 = 清除
      writeJSON(CONFIG_FILE, CONFIG);
      return json(res, 200, { ok: true, candidate: c });
    }).catch(function (e) { return json(res, 500, { error: String(e.message || e) }); });
  }

  /* ---- 排名（按轮次；rows 给新版页面，groups 兼容旧版页面；不带 r 默认第一轮；overall=1 跨所有轮次总排名） ---- */
  if (p === '/api/rank' && method === 'GET') {
    if (u.searchParams.get('overall') === '1') {
      return json(res, 200, { overall: true, rows: overallRank() });
    }
    const rd = findRound(u.searchParams.get('r')) || CONFIG.rounds[0];
    return json(res, 200, {
      round: rd.id,
      roundName: rd.name,
      rows: unifiedRank(rd.id).rows,
      groups: CONFIG.groups.map(function (g) { return rankOf(g, rd.id); })
    });
  }

  /* ---- 管理名单 ----
     面试官（全局一份，各组共用）：{ kind:'iv', op:'add'|'del', name }
     面试者（全局共用）：{ kind:'cd', op:'add', name, cls }
                        { kind:'cd', op:'del', id }
                        { kind:'cd', op:'batch', items:[{name,cls}, ...] }
     小组（分场面试，只在组内记分）：{ kind:'gp', op:'add', name? }  不传 name 自动编号「第N组」
                                      { kind:'gp', op:'del', id }    删除该组所有轮次里的打分
     轮次（各轮共用同一套小组与面试官，分数按轮分开）：
                        { kind:'rd', op:'add', name? }   不传 name 自动编号「第N轮」（新建时 dims 为空，需自行配置）
                        { kind:'rd', op:'dims', id, dims:[打分项id, ...] }
                                                         显式配置本轮考察哪些打分项（自由增减，可为空）
                                                         新建打分项不会自动进入任何轮次
                        { kind:'rd', op:'del', id }      删除该轮全部打分
     打分项（动态维度，两种类型；所有组/轮共用）：
                        { kind:'dim', op:'add', name, levels:[{label,score}, ...] }   选等级型
                        { kind:'dim', op:'add', name, mode:'free', max }              自由填分型
                        { kind:'dim', op:'edit', id, name?, levels?, mode?, max? }
                                                                  改名称 / 等级 / 类型；
                                                                  选等级→自由填分 会把历史等级换算成分值，
                                                                  自由填分→选等级 无法换算，会清掉该项历史分
                        { kind:'dim', op:'del', id }      删除该打分项及其在所有打分里的分数 */
  if (p === '/api/manage' && method === 'POST') {
    return readBody(req).then(function (raw) {
      let d;
      try { d = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: '数据格式错误' }); }

      /* --- 面试官：全局一份名单（所有组共用） --- */
      if (d.kind === 'iv') {
        const name = str(d.name);
        if (!name) return json(res, 400, { error: '名字不能为空' });
        if (name.length > 20) return json(res, 400, { error: '名字太长了' });

        if (d.op === 'add') {
          if (CONFIG.interviewers.indexOf(name) >= 0) return json(res, 400, { error: '「' + name + '」已经在名单里了' });
          CONFIG.interviewers.push(name);
        } else if (d.op === 'del') {
          const idx = CONFIG.interviewers.indexOf(name);
          if (idx < 0) return json(res, 400, { error: '名单里没有这个名字' });
          CONFIG.interviewers.splice(idx, 1);
          // 同步从各小组的面试官配置里移除，并清掉此人在所有组里的打分
          CONFIG.groups.forEach(function (g) {
            if (Array.isArray(g.interviewers)) g.interviewers = g.interviewers.filter(function (n) { return n !== name; });
          });
          scores = scores.filter(function (s) { return s.i !== name; });
          writeJSON(SCORES_FILE, scores);
        } else {
          return json(res, 400, { error: '操作错误' });
        }
        writeJSON(CONFIG_FILE, CONFIG);
        return json(res, 200, { ok: true, interviewers: CONFIG.interviewers });
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

      /* --- 小组：分场面试用，每组配置自己的面试官 --- */
      if (d.kind === 'gp') {
        const gps = CONFIG.groups;
        if (d.op === 'add') {
          const name = str(d.name) || ('第' + (gps.length + 1) + '组');
          if (name.length > 10) return json(res, 400, { error: '组名太长了' });
          if (gps.some(function (x) { return x.name === name; })) {
            return json(res, 400, { error: '已经有「' + name + '」了' });
          }
          gps.push({ id: 'g_' + crypto.randomBytes(3).toString('hex'), name: name, interviewers: [] });
        } else if (d.op === 'del') {
          if (gps.length <= 1) return json(res, 400, { error: '至少保留一个小组' });
          const id = str(d.id);
          const idx = gps.findIndex(function (x) { return x.id === id; });
          if (idx < 0) return json(res, 400, { error: '小组不存在' });
          gps.splice(idx, 1);
          // 同步清掉该组所有轮次里的打分
          scores = scores.filter(function (s) { return s.g !== id; });
          writeJSON(SCORES_FILE, scores);
        } else if (d.op === 'iv-add') {
          const g = gps.find(function (x) { return x.id === str(d.id); });
          if (!g) return json(res, 400, { error: '小组不存在' });
          const name = str(d.name);
          if (CONFIG.interviewers.indexOf(name) < 0) {
            return json(res, 400, { error: '请先在「面试官」里添加「' + name + '」' });
          }
          if (!Array.isArray(g.interviewers)) g.interviewers = [];
          if (g.interviewers.indexOf(name) >= 0) return json(res, 400, { error: '该组已有「' + name + '」' });
          g.interviewers.push(name);
        } else if (d.op === 'iv-del') {
          const g = gps.find(function (x) { return x.id === str(d.id); });
          if (!g) return json(res, 400, { error: '小组不存在' });
          const name = str(d.name);
          if (!Array.isArray(g.interviewers)) g.interviewers = [];
          g.interviewers = g.interviewers.filter(function (n) { return n !== name; });
        } else {
          return json(res, 400, { error: '操作错误' });
        }
        writeJSON(CONFIG_FILE, CONFIG);
        return json(res, 200, { ok: true, groups: gps });
      }

      /* --- 轮次：各轮共用同一套小组与面试官，分数按轮分开统计 --- */
      if (d.kind === 'rd') {
        const rounds = CONFIG.rounds;
        if (d.op === 'add') {
          const name = str(d.name) || ('第' + (rounds.length + 1) + '轮');
          if (name.length > 10) return json(res, 400, { error: '轮次名太长了' });
          if (rounds.some(function (x) { return x.name === name; })) {
            return json(res, 400, { error: '已经有「' + name + '」了' });
          }
          // 新建轮次默认不考察任何打分项，由用户显式配置（避免"默认塞进来"）
          rounds.push({ id: 'r_' + crypto.randomBytes(3).toString('hex'), name: name, dims: [] });
        } else if (d.op === 'dims') {
          /* 配置该轮考察哪些打分项：dims = 打分项 id 数组（显式、自由增减，允许为空 = 未配置） */
          const id = str(d.id);
          const r = rounds.find(function (x) { return x.id === id; });
          if (!r) return json(res, 400, { error: '轮次不存在' });
          const raw = Array.isArray(d.dims) ? d.dims : [];
          const seen = Object.create(null);
          const list = [];
          raw.forEach(function (x) {
            const v = str(x);
            if (v && CONFIG.dimensions.some(function (dd) { return dd.id === v; }) && !seen[v]) {
              seen[v] = 1; list.push(v);
            }
          });
          r.dims = list;
        } else if (d.op === 'del') {
          if (rounds.length <= 1) return json(res, 400, { error: '至少保留一个轮次' });
          const id = str(d.id);
          const idx = rounds.findIndex(function (x) { return x.id === id; });
          if (idx < 0) return json(res, 400, { error: '轮次不存在' });
          rounds.splice(idx, 1);
          // 同步清掉该轮所有打分
          scores = scores.filter(function (s) { return s.r !== id; });
          writeJSON(SCORES_FILE, scores);
        } else {
          return json(res, 400, { error: '操作错误' });
        }
        writeJSON(CONFIG_FILE, CONFIG);
        return json(res, 200, { ok: true, rounds: rounds });
      }

      /* --- 打分项：动态维度，两种类型（选等级 / 自由填分），所有组/轮共用 --- */
      if (d.kind === 'dim') {
        const dims = CONFIG.dimensions;
        if (d.op === 'add') {
          const name = str(d.name);
          if (!name) return json(res, 400, { error: '打分项名称不能为空' });
          if (name.length > 10) return json(res, 400, { error: '名称太长了' });
          if (dims.some(function (x) { return x.name === name; })) {
            return json(res, 400, { error: '「' + name + '」已经有了' });
          }
          const newId = 'd_' + crypto.randomBytes(3).toString('hex');
          // 自由填分型：只要名称 + 满分，面试官自己填分
          if (d.mode === 'free') {
            const max = Number(d.max);
            if (!isFinite(max) || max < 1 || max > 999) {
              return json(res, 400, { error: '满分要填 1~999' });
            }
            dims.push({ id: newId, name: name, mode: 'free', max: Math.round(max) });
            writeJSON(CONFIG_FILE, CONFIG);
            return json(res, 200, { ok: true, dimensions: dims, rounds: CONFIG.rounds });
          }
          const levels = (Array.isArray(d.levels) ? d.levels : [])
            .map(function (lv, i) {
              const label = str(lv && lv.label);
              const sc = Number(lv && lv.score);
              return (label && label.length <= 10 && isFinite(sc) && sc >= 0 && sc <= 999)
                ? { key: 'lv' + i, label: label, score: Math.round(sc) }
                : null;
            })
            .filter(Boolean);
          if (!levels.length) return json(res, 400, { error: '至少需要一个等级（格式：等级名 分值，每行一个）' });
          if (levels.length > 6) return json(res, 400, { error: '等级太多了（最多 6 个）' });
          dims.push({ id: newId, name: name, levels: levels });
        } else if (d.op === 'edit') {
          const id = str(d.id);
          const dim = dims.find(function (x) { return x.id === id; });
          if (!dim) return json(res, 400, { error: '打分项不存在' });
          // 先全部校验通过，再落值（避免校验失败留下半截改动）
          let newName = null;
          if (d.name !== undefined && d.name !== null) {
            newName = str(d.name);
            if (!newName) return json(res, 400, { error: '打分项名称不能为空' });
            if (newName.length > 10) return json(res, 400, { error: '名称太长了（最多 10 字）' });
            if (dims.some(function (x) { return x.id !== id && x.name === newName; })) {
              return json(res, 400, { error: '「' + newName + '」已经有了' });
            }
          }
          const oldMode = dim.mode === 'free' ? 'free' : 'level';
          const wantMode = d.mode === 'free' ? 'free' : (d.mode === 'level' ? 'level' : oldMode);

          /* 自由填分型：校验满分即可，不需要等级 */
          if (wantMode === 'free') {
            const max = d.max === undefined ? (dim.max || 100) : Number(d.max);
            if (!isFinite(max) || max < 1 || max > 999) {
              return json(res, 400, { error: '满分要填 1~999' });
            }
            if (newName) dim.name = newName;
            if (oldMode === 'level') {
              /* 选等级 → 自由填分：把历史记录里的等级换算成对应分值，尽量不丢分 */
              scores.forEach(function (s) {
                const lv = levelOf(dim.levels, s.dims && s.dims[id]);
                if (lv) s.dims[id] = Math.min(lv.score, Math.round(max));
                else if (s.dims && s.dims[id] !== undefined) delete s.dims[id];
              });
              writeJSON(SCORES_FILE, scores);
              delete dim.levels;
            }
            dim.mode = 'free';
            dim.max = Math.round(max);
            writeJSON(CONFIG_FILE, CONFIG);
            return json(res, 200, { ok: true, dimensions: dims, rounds: CONFIG.rounds });
          }

          /* 选等级型 */
          const rawLv = Array.isArray(d.levels) ? d.levels : [];
          const levels = [];
          const usedKeys = Object.create(null);
          rawLv.forEach(function (lv) {
            const label = str(lv && lv.label);
            const sc = Number(lv && lv.score);
            if (!label || label.length > 10 || !isFinite(sc) || sc < 0 || sc > 999) return;
            let key = str(lv && lv.key);
            if (!key || usedKeys[key]) key = 'k_' + crypto.randomBytes(2).toString('hex');
            usedKeys[key] = 1;
            levels.push({ key: key, label: label, score: Math.round(sc) });
          });
          if (!levels.length) return json(res, 400, { error: '至少保留一个等级' });
          if (levels.length > 6) return json(res, 400, { error: '等级太多了（最多 6 个）' });
          if (newName) dim.name = newName;
          if (oldMode === 'free') {
            /* 自由填分 → 选等级：自由分没法换算成等级，只能把该项的历史分数清掉 */
            scores.forEach(function (s) { if (s.dims) delete s.dims[id]; });
            writeJSON(SCORES_FILE, scores);
            delete dim.mode;
            delete dim.max;
          }
          dim.levels = levels;
          // 等级改了分值，历史打分记录里的等级 key 不变，排名会按新分值即时重算
        } else if (d.op === 'del') {
          if (dims.length <= 1) return json(res, 400, { error: '至少保留一个打分项' });
          const id = str(d.id);
          const idx = dims.findIndex(function (x) { return x.id === id; });
          if (idx < 0) return json(res, 400, { error: '打分项不存在' });
          dims.splice(idx, 1);
          // 级联：把该打分项从所有打分记录里移除
          scores.forEach(function (s) { if (s.dims && s.dims[id]) delete s.dims[id]; });
          writeJSON(SCORES_FILE, scores);
          // 级联：从各轮次的考察范围里移除（移除后该轮为空就是「还没配置」，不会自动补回）
          CONFIG.rounds.forEach(function (r) {
            if (!Array.isArray(r.dims)) return;
            r.dims = r.dims.filter(function (x) { return x !== id; });
          });
        } else {
          return json(res, 400, { error: '操作错误' });
        }
        writeJSON(CONFIG_FILE, CONFIG);
        return json(res, 200, { ok: true, dimensions: dims, rounds: CONFIG.rounds });
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

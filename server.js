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

  // 轮次：多轮面试共用同一套小组与面试官配置，分数按轮分开统计
  rounds: [
    { id: 'r1', name: '第1轮' },
    { id: 'r2', name: '第2轮' }
  ],

  groups: [
    { id: 'g1', name: '第1组' },
    { id: 'g2', name: '第2组' },
    { id: 'g3', name: '第3组' },
    { id: 'g4', name: '第4组' }
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

  // 旧版把面试官挂在各个组里（按组隔离），这里全部并入全局名单
  (cfg.groups || []).forEach(function (g) {
    (Array.isArray(g.interviewers) ? g.interviewers : []).forEach(takeIv);
    delete g.interviewers;
    (Array.isArray(g.candidates) ? g.candidates : []).forEach(takeCd);
    delete g.candidates;
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

  // 小组：分场面试用，可在 App 里增删
  if (!Array.isArray(cfg.groups) || !cfg.groups.length) {
    cfg.groups = SEED.groups.map(function (g) { return { id: g.id, name: g.name }; });
  } else {
    cfg.groups = cfg.groups.map(function (g) {
      return { id: str(g && g.id) || 'g_' + crypto.randomBytes(3).toString('hex'), name: str(g && g.name) || '小组' };
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
  if (Array.isArray(cfg.dimensions) && cfg.dimensions.length) {
    cfg.dimensions = cfg.dimensions.map(function (dm, di) {
      return {
        id: str(dm && dm.id) || 'd_' + crypto.randomBytes(3).toString('hex'),
        name: str(dm && dm.name) || ('打分项' + (di + 1)),
        levels: (Array.isArray(dm && dm.levels) ? dm.levels : []).map(normLv)
      };
    });
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

/* 一条打分记录 -> { items:[{name,label,score}], total }（打分项是动态的，按当前配置的打分项算） */
function detailOf(s) {
  const dm = s.dims || {};
  const items = [];
  let total = 0;
  CONFIG.dimensions.forEach(function (d) {
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
      if (!CONFIG.interviewers.length) return json(res, 400, { error: '还没有面试官，先到右上角添加' });
      if (CONFIG.interviewers.indexOf(d.i) < 0) return json(res, 400, { error: '面试官不在名单中' });
      if (!CONFIG.candidates.some(function (c) { return c.id === d.c; })) {
        return json(res, 400, { error: '面试者不在名单中' });
      }
      // 校验各打分项等级：d.dims（新版）或 d.e / d.w（旧版页面兼容）
      const dimsIn = {};
      const badDims = [];
      if (d.dims && typeof d.dims === 'object') {
        Object.keys(d.dims).forEach(function (k) {
          const dm = CONFIG.dimensions.find(function (x) { return x.id === k; });
          if (!dm || !levelOf(dm.levels, d.dims[k])) { badDims.push(k); return; }
          dimsIn[k] = d.dims[k];
        });
      }
      if (d.e !== undefined || d.w !== undefined) {
        [['e', d.e], ['w', d.w]].forEach(function (pair) {
          const dm = CONFIG.dimensions.find(function (x) { return x.id === pair[0]; });
          if (pair[1] && (dm ? levelOf(dm.levels, pair[1]) : null)) dimsIn[pair[0]] = pair[1];
          else if (pair[1]) badDims.push(pair[0]);
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

      /* 覆盖式更新：同一条记录里逐项合并（旧页面只发 e/w 时不会清掉其他打分项） */
      const old = inRound.find(function (s) { return s.g === d.g && s.c === d.c && s.i === d.i; });
      if (old) {
        old.dims = Object.assign({}, old.dims || {}, dimsIn);
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

  /* ---- 排名（按轮次；rows 给新版页面，groups 兼容旧版页面；不带 r 默认第一轮） ---- */
  if (p === '/api/rank' && method === 'GET') {
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
                        { kind:'rd', op:'add', name? }   不传 name 自动编号「第N轮」
                        { kind:'rd', op:'del', id }      删除该轮全部打分
     打分项（动态维度，每项若干等级 { label, score }）：
                        { kind:'dim', op:'add', name, levels:[{label,score}, ...] }
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
          // 同步清掉此人在所有组里的打分，避免残留分数干扰排名
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

      /* --- 小组：分场面试用，增删即可；删组时该组所有轮次的分数一并清除 --- */
      if (d.kind === 'gp') {
        const gps = CONFIG.groups;
        if (d.op === 'add') {
          const name = str(d.name) || ('第' + (gps.length + 1) + '组');
          if (name.length > 10) return json(res, 400, { error: '组名太长了' });
          if (gps.some(function (x) { return x.name === name; })) {
            return json(res, 400, { error: '已经有「' + name + '」了' });
          }
          gps.push({ id: 'g_' + crypto.randomBytes(3).toString('hex'), name: name });
        } else if (d.op === 'del') {
          if (gps.length <= 1) return json(res, 400, { error: '至少保留一个小组' });
          const id = str(d.id);
          const idx = gps.findIndex(function (x) { return x.id === id; });
          if (idx < 0) return json(res, 400, { error: '小组不存在' });
          gps.splice(idx, 1);
          // 同步清掉该组所有轮次里的打分
          scores = scores.filter(function (s) { return s.g !== id; });
          writeJSON(SCORES_FILE, scores);
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
          rounds.push({ id: 'r_' + crypto.randomBytes(3).toString('hex'), name: name });
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

      /* --- 打分项：动态维度（每项若干等级），所有组/轮共用 --- */
      if (d.kind === 'dim') {
        const dims = CONFIG.dimensions;
        if (d.op === 'add') {
          const name = str(d.name);
          if (!name) return json(res, 400, { error: '打分项名称不能为空' });
          if (name.length > 10) return json(res, 400, { error: '名称太长了' });
          if (dims.some(function (x) { return x.name === name; })) {
            return json(res, 400, { error: '「' + name + '」已经有了' });
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
          dims.push({ id: 'd_' + crypto.randomBytes(3).toString('hex'), name: name, levels: levels });
        } else if (d.op === 'del') {
          if (dims.length <= 1) return json(res, 400, { error: '至少保留一个打分项' });
          const id = str(d.id);
          const idx = dims.findIndex(function (x) { return x.id === id; });
          if (idx < 0) return json(res, 400, { error: '打分项不存在' });
          dims.splice(idx, 1);
          // 级联：把该打分项从所有打分记录里移除
          scores.forEach(function (s) { if (s.dims && s.dims[id]) delete s.dims[id]; });
          writeJSON(SCORES_FILE, scores);
        } else {
          return json(res, 400, { error: '操作错误' });
        }
        writeJSON(CONFIG_FILE, CONFIG);
        return json(res, 200, { ok: true, dimensions: dims });
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

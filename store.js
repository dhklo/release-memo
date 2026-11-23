/**
 * 持久化存储：以 JSON 文件为唯一事实来源。
 *
 * 每次操作都重新读取文件，因此同一个包的多个激活副本（例如插件市场热挂载 +
 * profile 安装行）看到的永远是同一份数据，不会出现内存副本分叉。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const ENVS = ['local', 'test', 'staging', 'prod'];
export const STATUSES = ['pending', 'in_progress', 'done', 'blocked'];
export const PRIORITIES = ['P0', 'P1', 'P2'];

export function validateEnv(env) {
  if (!ENVS.includes(env)) throw new Error(`未知环境: ${env}（可选: ${ENVS.join(' / ')}）`);
  return env;
}
export function validateStatus(status) {
  if (!STATUSES.includes(status)) throw new Error(`未知状态: ${status}（可选: ${STATUSES.join(' / ')}）`);
  return status;
}
export function validatePriority(priority) {
  if (!PRIORITIES.includes(priority)) throw new Error(`未知优先级: ${priority}（可选: ${PRIORITIES.join(' / ')}）`);
  return priority;
}

let idCounter = 0;
function nextId(items) {
  const max = items.reduce((acc, it) => Math.max(acc, Number(it.id) || 0), 0);
  idCounter = Math.max(idCounter + 1, max + 1);
  return idCounter;
}

/** 默认示例时间节点（按相对日期生成，保证总是“未来”的合理值） */
export function sampleMilestones() {
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  return [
    { name: '需求评审完成', date: day(3), note: '产研对齐验收标准' },
    { name: '开发提测', date: day(10), note: '代码合并主干并提测' },
    { name: '预发布验证通过', date: day(17), note: '回归核心链路' },
    { name: '正式上线', date: day(21), note: '发布窗口内部署并观察' },
  ];
}

/** 默认示例内容：覆盖四个环境的典型上线检查事项 */
export function sampleItems() {
  return [
    { env: 'local', title: '本地跑通全量单元测试', owner: '开发', milestoneName: '需求评审完成', priority: 'P1', status: 'done', note: '覆盖率不低于 80%' },
    { env: 'local', title: '本地自测主流程与回滚路径', owner: '开发', milestoneName: '开发提测', priority: 'P1', status: 'pending', note: '' },
    { env: 'test', title: '部署到测试环境并完成接口联调', owner: '后端', milestoneName: '开发提测', priority: 'P1', status: 'in_progress', note: '注意灰度开关默认关闭' },
    { env: 'test', title: '补充集成测试用例并归档报告', owner: '测试', milestoneName: '开发提测', priority: 'P2', status: 'pending', note: '' },
    { env: 'staging', title: '预发布环境回归核心链路', owner: '测试', milestoneName: '预发布验证通过', priority: 'P0', status: 'pending', note: '上线前必须通过' },
    { env: 'staging', title: '确认配置项与密钥已就绪', owner: '运维', milestoneName: '预发布验证通过', priority: 'P0', status: 'blocked', note: '等待密钥审批' },
    { env: 'prod', title: '发布窗口与值班安排确认', owner: '运维', milestoneName: '正式上线', priority: 'P1', status: 'pending', note: '' },
    { env: 'prod', title: '线上验证与监控告警观察 30 分钟', owner: '值班', milestoneName: '正式上线', priority: 'P0', status: 'pending', note: '异常立即回滚' },
  ];
}

export function createStore(dataDir) {
  const dir = dataDir || path.join(os.homedir(), '.dsh', 'release-memo');
  const file = path.join(dir, 'checklist.json');

  let tmpCounter = 0;

  /** 读取整个文件（不吞异常，供 read 判断“文件不存在”与“文件损坏”） */
  const readRaw = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err && err.code === 'ENOENT') return null; // 首次运行
      // 解析失败：备份损坏文件，避免后续写入把它彻底覆盖掉
      try {
        const bak = `${file}.corrupt-${Date.now()}`;
        fs.copyFileSync(file, bak);
      } catch { /* 备份失败不阻塞 */ }
      return null;
    }
  };

  const read = () => {
    const raw = readRaw();
    return Array.isArray(raw?.items) ? raw.items : [];
  };

  /** 读取时间节点列表 */
  const readMilestones = () => {
    const raw = readRaw();
    return Array.isArray(raw?.milestones) ? raw.milestones : [];
  };

  /**
   * 原子写入。写入方必须传入完整的 items + milestones 快照，
   * 避免在“读取另一部分”时与另一个激活副本产生竞态（曾导致节点被覆盖丢失）。
   * 唯一临时名 + rename，保证不会读到半个文件。
   */
  const write = (items, milestones) => {
    fs.mkdirSync(dir, { recursive: true });
    tmpCounter += 1;
    const tmp = `${file}.${process.pid}.${tmpCounter}.${Date.now()}.tmp`;
    const payload = { version: 2, items, milestones };
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  };

  /** 读一次拿到完整快照，避免两次读取之间的竞态 */
  const snapshot = () => {
    const raw = readRaw();
    return {
      items: Array.isArray(raw?.items) ? raw.items : [],
      milestones: Array.isArray(raw?.milestones) ? raw.milestones : [],
    };
  };

  const norm = (it) => ({
    id: Number(it.id),
    env: ENVS.includes(it.env) ? it.env : 'local',
    title: String(it.title ?? ''),
    owner: String(it.owner ?? ''),
    due: String(it.due ?? ''),
    // 关联的时间节点（可为空；为空时 due 仍可作为独立截止日期使用）
    milestoneId: it.milestoneId === null || it.milestoneId === undefined || it.milestoneId === ''
      ? null
      : Number(it.milestoneId),
    priority: PRIORITIES.includes(it.priority) ? it.priority : 'P1',
    status: STATUSES.includes(it.status) ? it.status : 'pending',
    note: String(it.note ?? ''),
    createdAt: String(it.createdAt ?? ''),
    updatedAt: String(it.updatedAt ?? ''),
  });

  /** 时间节点归一化：date 统一为 YYYY-MM-DD */
  const normMs = (ms) => ({
    id: Number(ms.id),
    name: String(ms.name ?? ''),
    date: String(ms.date ?? '').slice(0, 10),
    note: String(ms.note ?? ''),
    createdAt: String(ms.createdAt ?? ''),
    updatedAt: String(ms.updatedAt ?? ''),
  });

  return {
    file,

    /** 首次运行写入示例内容；已有数据时不动。返回是否写入。 */
    seed(demo) {
      const items = read();
      const milestones = readMilestones();
      if (items.length > 0 || milestones.length > 0) return false;
      const now = new Date().toISOString();
      const ms = sampleMilestones();
      const created = ms.map((row, i) => normMs({
        id: i + 1, createdAt: now, updatedAt: now, ...row,
      }));
      // 示例事项按标题挑一个合适的时间节点，并让 due 跟随节点日期
      const byName = new Map(created.map((m) => [m.name, m]));
      write(demo.map((row, i) => {
        const node = row.milestoneName ? byName.get(row.milestoneName) : undefined;
        return norm({
          id: i + 1,
          createdAt: now,
          updatedAt: now,
          ...row,
          milestoneId: node ? node.id : null,
          due: node ? node.date : (row.due ?? ''),
        });
      }), created);
      return true;
    },

    /* ── 时间节点 ──────────────────────────────────────────── */
    listMilestones() {
      return readMilestones()
        .map(normMs)
        .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
    },

    addMilestone(input = {}) {
      const name = String(input.name ?? '').trim();
      if (!name) throw new Error('节点名称不能为空');
      const date = String(input.date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('节点日期格式应为 YYYY-MM-DD');
      const milestones = readMilestones();
      const now = new Date().toISOString();
      const id = milestones.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
      const ms = normMs({
        id, name, date, note: input.note ?? '', createdAt: now, updatedAt: now,
      });
      milestones.push(ms);
      write(snapshot().items, milestones);
      return ms;
    },

    updateMilestone(id, patch = {}) {
      const milestones = readMilestones();
      const index = milestones.findIndex((m) => Number(m.id) === id);
      if (index < 0) throw new Error(`时间节点不存在: ${id}`);
      const next = { ...normMs(milestones[index]) };
      if (patch.name !== undefined) {
        const name = String(patch.name).trim();
        if (!name) throw new Error('节点名称不能为空');
        next.name = name;
      }
      if (patch.date !== undefined) {
        const date = String(patch.date).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('节点日期格式应为 YYYY-MM-DD');
        next.date = date;
      }
      if (patch.note !== undefined) next.note = String(patch.note);
      next.updatedAt = new Date().toISOString();
      milestones[index] = next;
      write(snapshot().items, milestones);
      // 节点日期变了，跟着该节点的事项同步截止日期
      if (patch.date !== undefined) {
        const items = read();
        let changed = false;
        for (const it of items) {
          if (Number(it.milestoneId) === id) {
            it.due = next.date;
            it.updatedAt = next.updatedAt;
            changed = true;
          }
        }
        if (changed) write(items, milestones);
      }
      return next;
    },

    removeMilestone(id) {
      const milestones = readMilestones();
      const next = milestones.filter((m) => Number(m.id) !== id);
      if (next.length === milestones.length) throw new Error(`时间节点不存在: ${id}`);
      // 解除引用该节点的事项关联（保留它们的 due 日期不变）
      const items = read().map((it) => (Number(it.milestoneId) === id
        ? { ...it, milestoneId: null }
        : it));
      write(items, next);
      return true;
    },

    list(filter = {}) {
      const env = filter.env && filter.env !== 'all' ? filter.env : undefined;
      const status = filter.status && filter.status !== 'all' ? filter.status : undefined;
      const keyword = String(filter.keyword ?? '').trim().toLowerCase();
      // 截止日期筛选：dueBefore 早于该日 / dueAfter 晚于该日 / dueFrom~dueTo 区间
      const dueBefore = filter.dueBefore ? String(filter.dueBefore) : undefined;
      const dueAfter = filter.dueAfter ? String(filter.dueAfter) : undefined;
      const dueFrom = filter.dueFrom ? String(filter.dueFrom) : undefined;
      const dueTo = filter.dueTo ? String(filter.dueTo) : undefined;
      const dueOn = filter.dueOn ? String(filter.dueOn) : undefined;
      // "YYYY-MM-DD" 可直接按字符串比较；同时把历史格式（20261201、带时间等）
      // 归一成日期，否则 dueOn/dueFrom 这类等值或区间比较会漏掉老数据。
      const dayOf = (it) => {
        const raw = String(it.due ?? '').trim();
        if (!raw) return '';
        if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        if (/^\d{12}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw);
        if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        return raw.slice(0, 10);
      };
      return read()
        .map(norm)
        .filter((it) => !env || it.env === env)
        .filter((it) => !status || it.status === status)
        .filter((it) => {
          const d = dayOf(it);
          if (filter.noDue) return !d; // 只看未填截止日期的
          // 一旦按日期筛选，未填截止日期的事项一律不参与（否则空串比较会误命中）
          if (!d) return !dueOn && !dueFrom && !dueTo && !dueBefore && !dueAfter;
          if (dueOn) return d === dueOn;
          if (dueFrom && d < dueFrom) return false;
          if (dueTo && d > dueTo) return false;
          if (dueBefore && !(d < dueBefore)) return false;
          if (dueAfter && !(d > dueAfter)) return false;
          return true;
        })
        .filter((it) => {
          if (!keyword) return true;
          return it.title.toLowerCase().includes(keyword)
            || it.owner.toLowerCase().includes(keyword)
            || it.note.toLowerCase().includes(keyword);
        });
    },

    /** 统计：总数、按环境的总数/完成数、按状态的数量 */
    stats() {
      const items = read().map(norm);
      const byEnv = {};
      const envDone = {};
      const byStatus = {};
      for (const env of ENVS) { byEnv[env] = 0; envDone[env] = 0; }
      for (const status of STATUSES) byStatus[status] = 0;
      for (const it of items) {
        byEnv[it.env] += 1;
        if (it.status === 'done') envDone[it.env] += 1;
        byStatus[it.status] += 1;
      }
      return { total: items.length, byEnv, envDone, byStatus };
    },

    get(id) {
      const found = read().map(norm).find((it) => it.id === id);
      return found;
    },

    /**
     * 新增事项。
     * 传 input.envs（数组）可一次在多个环境各建一条；只传 input.env 则建一条。
     * @returns 单条时返回该事项，多条时返回事项数组（保持向后兼容）
     */
    add(input = {}) {
      const title = String(input.title ?? '').trim();
      if (!title) throw new Error('title 不能为空');
      // 先按原始输入校验，避免 norm() 的容错把非法值静默成默认值
      const rawEnvs = Array.isArray(input.envs) && input.envs.length > 0
        ? input.envs
        : [input.env ?? 'local'];
      const envs = [...new Set(rawEnvs.map((e) => validateEnv(e)))];
      const priority = validatePriority(input.priority ?? 'P1');
      const status = validateStatus(input.status ?? 'pending');
      const items = read();
      const now = new Date().toISOString();
      // 选了时间节点就用节点日期作为截止日；没选则保留显式传入的 due
      const milestoneId = input.milestoneId === null || input.milestoneId === undefined
        || input.milestoneId === ''
        ? null
        : Number(input.milestoneId);
      let due = String(input.due ?? '');
      if (milestoneId !== null) {
        const ms = readMilestones().map(normMs).find((m) => m.id === milestoneId);
        if (!ms) throw new Error(`时间节点不存在: ${milestoneId}`);
        due = ms.date;
      }
      const created = [];
      for (const env of envs) {
        const item = norm({
          id: nextId([...items, ...created]),
          env,
          title,
          owner: input.owner ?? '',
          due,
          milestoneId,
          priority,
          status,
          note: input.note ?? '',
          createdAt: now,
          updatedAt: now,
        });
        created.push(item);
      }
      items.push(...created);
      write(items, snapshot().milestones);
      return created.length === 1 ? created[0] : created;
    },

    update(id, patch = {}) {
      const items = read();
      const index = items.findIndex((it) => Number(it.id) === id);
      if (index < 0) throw new Error(`事项不存在: ${id}`);
      const current = norm(items[index]);
      const next = { ...current };
      if (patch.title !== undefined) {
        const title = String(patch.title).trim();
        if (!title) throw new Error('title 不能为空');
        next.title = title;
      }
      if (patch.env !== undefined) next.env = validateEnv(patch.env);
      if (patch.owner !== undefined) next.owner = String(patch.owner);
      if (patch.due !== undefined) next.due = String(patch.due);
      if (patch.priority !== undefined) next.priority = validatePriority(patch.priority);
      if (patch.status !== undefined) next.status = validateStatus(patch.status);
      if (patch.note !== undefined) next.note = String(patch.note);
      next.updatedAt = new Date().toISOString();
      items[index] = next;
      write(items, snapshot().milestones);
      return next;
    },

    remove(id) {
      const items = read();
      const next = items.filter((it) => Number(it.id) !== id);
      if (next.length === items.length) throw new Error(`事项不存在: ${id}`);
      write(next, snapshot().milestones);
      return true;
    },

    toggle(id) {
      const found = read().map(norm).find((it) => it.id === id);
      if (!found) throw new Error(`事项不存在: ${id}`);
      return this.update(id, { status: found.status === 'done' ? 'pending' : 'done' });
    },

    /**
     * 把一条事项复制到其他环境。
     * @param id 源事项 id
     * @param targets 目标环境数组（不能等于源环境）
     * @param overrides 可选：{ status?, priority?, owner? ... } 覆盖副本字段
     * @returns 新建的副本数组
     */
    copy(id, targets, overrides = {}) {
      const list = Array.isArray(targets) ? targets : [targets];
      if (list.length === 0) throw new Error('请至少选择一个目标环境');
      const source = read().map(norm).find((it) => it.id === id);
      if (!source) throw new Error(`事项不存在: ${id}`);
      // 目标去重并校验
      const uniqueTargets = [...new Set(list.map((t) => validateEnv(t)))];
      if (uniqueTargets.length === 1 && uniqueTargets[0] === source.env) {
        throw new Error(`目标环境与原环境相同（${source.env}），无需复制`);
      }
      const items = read();
      const now = new Date().toISOString();
      const created = [];
      for (const env of uniqueTargets) {
        if (env === source.env) continue; // 跳过源环境本身
        created.push(norm({
          ...source,
          ...overrides,
          id: nextId([...items, ...created]),
          env,
          createdAt: now,
          updatedAt: now,
        }));
      }
      if (created.length === 0) throw new Error('没有需要复制的目标环境');
      for (const c of created) {
        validateEnv(c.env);
        validatePriority(c.priority);
        validateStatus(c.status);
      }
      items.push(...created);
      write(items, snapshot().milestones);
      return created;
    },

    /** 只清空事项，保留时间节点（节点是用户维护的基础数据） */
    clear() {
      write([], snapshot().milestones);
      return true;
    },
  };
}

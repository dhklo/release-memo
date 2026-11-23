/**
 * 上线准备备忘录（release-memo）— Host 半边。
 *
 * 与 Client 的桥接方式：注册同源 HTTP 路由 `/api/release-memo/*`，
 * Client 用 `fetch()` 调用（与已安装的 dsh-context 插件同一套已验证方案）。
 * 静态 `dsh.client` 模块拿不到动态包的 `host.call` / `styles` 内置符号。
 *
 * 同时注册 agent 工具 `release_memo`，与 UI 共用 store 里的同一份实现。
 */
import { createStore, sampleItems, ENVS, STATUSES } from './store.js';

const ROUTE = '/api/release-memo';
const ENV_DESC = 'local（本地）/ test（测试）/ staging（预发布）/ prod（正式）';
const STATUS_DESC = 'pending（待办）/ in_progress（进行中）/ done（完成）/ blocked（受阻）';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export function apply(ctx, config) {
  const store = createStore(config?.dataDir);
  store.seed(sampleItems());

  /** 唯一业务入口：UI 路由与 agent 工具都调用它。 */
  const run = (action, payload = {}) => {
    switch (action) {
      case 'list':
        return {
          items: store.list(payload),
          stats: store.stats(),
          milestones: store.listMilestones(),
        };
      /* ── 时间节点 ── */
      case 'milestones':
        return { milestones: store.listMilestones() };
      case 'milestoneAdd':
        return store.addMilestone(payload.milestone ?? payload);
      case 'milestoneUpdate':
        if (!Number.isInteger(payload.id)) throw new Error('milestoneUpdate 需要 id');
        return store.updateMilestone(payload.id, payload.patch ?? {});
      case 'milestoneRemove':
        if (!Number.isInteger(payload.id)) throw new Error('milestoneRemove 需要 id');
        return { removed: store.removeMilestone(payload.id) };
      case 'add':
        return store.add(payload.item ?? payload);
      case 'update':
        if (!Number.isInteger(payload.id)) throw new Error('update 需要 id');
        return store.update(payload.id, payload.patch ?? {});
      case 'remove':
        if (!Number.isInteger(payload.id)) throw new Error('remove 需要 id');
        return { removed: store.remove(payload.id) };
      case 'toggle':
        if (!Number.isInteger(payload.id)) throw new Error('toggle 需要 id');
        return store.toggle(payload.id);
      case 'copy':
        if (!Number.isInteger(payload.id)) throw new Error('copy 需要 id');
        return {
          copied: store.copy(
            payload.id,
            payload.targets ?? payload.env,
            payload.overrides ?? {},
          ),
        };
      case 'stats':
        return { stats: store.stats() };
      case 'clear':
        return { cleared: store.clear() };
      default:
        throw new Error(`未知操作: ${action}`);
    }
  };

  // ── HTTP 路由：Client 的唯一数据通道 ──────────────────────────────
  // 用 ctx.inject 等待 connection 就绪：ctx.get() 在 apply 时机可能返回 undefined，
  // 那样路由会被静默跳过（页面侧表现为 404）。
  // 同一个包可能被二次激活（插件市场热挂载 + profile 安装行），路由全局唯一，
  // 先注册者生效；后注册者跳过，两者共用同一份文件存储。
  const disposers = [];
  ctx.inject(['connection'], (cctx) => {
    const connection = cctx.get('connection');
    if (!connection?.fetch?.register) {
      throw new Error('release-memo: connection.fetch.register 不可用，UI 数据通道无法建立');
    }
    try {
      disposers.push(connection.fetch.register({
        path: ROUTE,
        methods: ['POST', 'GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          // GET：查询参数形式，便于直接调试
          if (request.method === 'GET') {
            const url = new URL(request.url);
            const action = url.searchParams.get('action') ?? 'list';
            const payload = {
              env: url.searchParams.get('env') ?? undefined,
              status: url.searchParams.get('status') ?? undefined,
              keyword: url.searchParams.get('keyword') ?? undefined,
              dueFrom: url.searchParams.get('dueFrom') ?? undefined,
              dueTo: url.searchParams.get('dueTo') ?? undefined,
            };
            try {
              return json({ ok: true, value: run(action, payload) });
            } catch (err) {
              return json({ ok: false, error: String(err?.message ?? err) }, 400);
            }
          }
          // POST：完整操作负载
          let body = {};
          try {
            const text = await request.text();
            body = text ? JSON.parse(text) : {};
          } catch {
            return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
          }
          try {
            const value = run(body.action ?? 'list', body);
            return json({ ok: true, value });
          } catch (err) {
            return json({ ok: false, error: String(err?.message ?? err) }, 400);
          }
        },
      }));
    } catch (err) {
      // 已有同路径路由（二次激活）：保留先注册者，本副本继续服务 agent 工具。
      ctx.logger?.debug?.(`release-memo: 路由已存在，跳过注册 (${err?.message ?? err})`);
    }
  });

  // ── agent 工具：与 UI 共用 run() ─────────────────────────────────
  ctx.inject(['tools'], (cctx) => {
    const tools = cctx.get('tools');
    if (!tools || tools.get('release_memo')) return;
    disposers.push(tools.register({
      name: 'release_memo',
      description:
        '项目功能上线前准备工作备忘录。管理按环境（本地/测试/预发布/正式）分类的上线检查事项，'
        + '并以“时间节点”组织事项的截止日期（新增事项时选择节点，截止日期自动跟随节点日期）。'
        + `字段含负责人、优先级（P0/P1/P2）、状态（${STATUS_DESC}）与备注。`
        + 'action=list 返回事项、统计与全部时间节点，支持按环境/状态/关键词/截止日期区间筛选；'
        + 'action=add/update/remove/toggle/copy/stats 管理事项；'
        + 'action=milestones/milestoneAdd/milestoneUpdate/milestoneRemove 管理时间节点（格式 YYYY-MM-DD）。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'list', 'add', 'update', 'remove', 'toggle', 'copy', 'stats',
              'milestones', 'milestoneAdd', 'milestoneUpdate', 'milestoneRemove',
            ],
            description: '要执行的操作',
          },
          id: {
            type: 'integer',
            description: '事项 id（update/remove/toggle/copy）或时间节点 id（milestoneUpdate/milestoneRemove）',
          },
          targets: {
            type: 'array',
            items: { type: 'string', enum: ENVS },
            description: 'copy 的目标环境数组，可多个，如 ["staging","prod"]',
          },
          milestone: {
            type: 'object',
            description: 'milestoneAdd 的时间节点字段',
            properties: {
              name: { type: 'string', description: '节点名称（必填），如 开发提测' },
              date: { type: 'string', description: '节点日期，格式 YYYY-MM-DD（必填）' },
              note: { type: 'string', description: '备注' },
            },
            required: ['name', 'date'],
          },
          item: {
            type: 'object',
            description: '新增事项的完整字段（add 必填）',
            properties: {
              env: { type: 'string', enum: ENVS, description: `单个环境，${ENV_DESC}` },
              envs: {
                type: 'array',
                items: { type: 'string', enum: ENVS },
                description: '多环境数组：一次在每个环境各建一条（与 env 二选一，优先 envs）',
              },
              title: { type: 'string', description: '事项标题（必填）' },
              owner: { type: 'string', description: '负责人' },
              milestoneId: {
                type: 'integer',
                description: '时间节点 id：选了它截止日期自动取该节点日期',
              },
              due: { type: 'string', description: '截止日期 2026-11-30（未选 milestoneId 时使用）' },
              priority: { type: 'string', enum: ['P0', 'P1', 'P2'], description: '优先级，默认 P1' },
              status: { type: 'string', enum: STATUSES, description: '状态，默认 pending' },
              note: { type: 'string', description: '备注' },
            },
            required: ['title'],
          },
          patch: {
            type: 'object',
            description: '要修改的字段（update 必填，只传需要修改的）',
            properties: {
              env: { type: 'string', enum: ENVS },
              title: { type: 'string' },
              owner: { type: 'string' },
              due: { type: 'string' },
              priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
              status: { type: 'string', enum: STATUSES },
              note: { type: 'string' },
            },
          },
          env: { type: 'string', enum: ENVS, description: 'list 筛选：环境' },
          status: { type: 'string', enum: STATUSES, description: 'list 筛选：状态' },
          keyword: { type: 'string', description: 'list 筛选：关键词（匹配标题/负责人/备注）' },
          dueFrom: { type: 'string', description: 'list 筛选：截止日期下限，YYYY-MM-DD（含）' },
          dueTo: { type: 'string', description: 'list 筛选：截止日期上限，YYYY-MM-DD（含）' },
        },
        required: ['action'],
      },
      output: {
        schema: { type: 'object' },
        render(_args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
        },
      },
      async execute(args) {
        try {
          const value = run(args.action, args);
          // 工具输出必须是对象；add 多环境时 store 返回数组，这里包一层
          return Array.isArray(value) ? { items: value } : value;
        } catch (err) {
          return { error: String(err?.message ?? err) };
        }
      },
    }));
  });

  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* 已释放 */ }
    }
  };
}

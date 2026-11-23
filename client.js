/**
 * 上线准备备忘录（release-memo）— Client 半边。
 *
 * 插槽：sidebar.panellist（侧边栏图标）+ main（中央面板页，key 与图标 id 相同）。
 * 数据：同源 fetch 到 /api/release-memo/（Host 在 index.js 注册的路由）。
 * 样式：组件内 <style> 元素，随组件卸载自动移除；静态客户端包没有 styles 内置符号。
 */
window.__ModuleLoader__.load({
  id: '@local/release-memo',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback, useMemo, useRef } = React;

    const API = '/api/release-memo';

    const ENVS = ['local', 'test', 'staging', 'prod'];
    const ENV_LABELS = { local: '本地环境', test: '测试环境', staging: '预发布环境', prod: '正式环境' };
    const ENV_SHORT = { local: '本地', test: '测试', staging: '预发布', prod: '正式' };
    const STATUSES = ['pending', 'in_progress', 'done', 'blocked'];
    const STATUS_LABELS = { pending: '待办', in_progress: '进行中', done: '完成', blocked: '受阻' };
    const PRIORITIES = ['P0', 'P1', 'P2'];
    const EMPTY_DRAFT = {
      envs: ['local'],
      title: '',
      owner: 'hdong',
      milestoneId: null,
      due: '',
      priority: 'P1',
      status: 'pending',
      note: '',
    };

    /** 在数组里切换某项（用于多选） */
    function toggleInList(list, value) {
      return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    }

    /* ── 截止时间（只到日）─────────────────────────────────────────
     * 存储统一用 "YYYY-MM-DD"：可读、可按字符串排序、可被关键词搜索。
     * <input type="date"> 的 value 也是 "YYYY-MM-DD"，两者一致。
     * 同时兼容历史数据："20261201"、"202611301800"、"2026-11-30 18:00"、ISO 串等，
     * 带时间的写法只取日期部分。
     */
    const pad2 = (n) => String(n).padStart(2, '0');

    /** 存储值 → 日期的 "YYYY-MM-DD"（无法解析时返回空串） */
    function toDateValue(stored) {
      const s = String(stored ?? '').trim();
      if (!s) return '';
      // 纯数字：YYYYMMDD 或 YYYYMMDDHHmm（截取日期部分）
      if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      if (/^\d{12}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      // "YYYY-MM-DD" / "YYYY/MM/DD"，可带时间
      const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
      if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
      // 兜底：可被 Date 解析的写法
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      }
      return '';
    }

    /** 快捷截止日：今天 / 明天 / 一周后 */
    function quickDue(daysAhead) {
      const d = new Date();
      d.setDate(d.getDate() + daysAhead);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    /** 新表单草稿：负责人默认 hdong；时间节点默认不选（选了截止日期自动跟随） */
    function makeDraft() {
      return { ...EMPTY_DRAFT, envs: ['local'] };
    }

    /** 存储值 → 列表展示文本（省略年份，显示 "MM/DD"） */
    function formatDue(stored) {
      const v = toDateValue(stored);
      if (!v) return String(stored ?? '');
      return v.slice(5).replace('-', '/');
    }

    /** 是否已逾期：截止日早于今天才算逾期（当天不算） */
    function isOverdue(item) {
      if (item.status === 'done') return false;
      const v = toDateValue(item.due);
      if (!v) return false;
      return v < quickDue(0); // "YYYY-MM-DD" 可直接按字符串比较
    }

    const CSS = `
/* ── 基础：克制中性风 ──────────────────────────────────────────
 * 只用三类颜色：
 *   1. 主题灰阶（bg / border / label）
 *   2. 品牌色（仅用于：主按钮、选中态、焦点、进度填充）
 *   3. 状态色（红/黄/绿，仅用于优先级和状态的语义标签）
 * 不使用 color-mix 半透明混合，避免颜色叠加发灰。
 */
.rm-page{height:100%;overflow-y:auto;background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);
  font-size:13.5px;line-height:1.55;font-family:inherit;box-sizing:border-box}
.rm-page *{box-sizing:border-box}

/* ── 动效 ──────────────────────────────────────────────────── */
.rm-page{
  --rm-ease-soft:cubic-bezier(.4,0,.2,1);
  --rm-ease-out:cubic-bezier(.16,1,.3,1);
  --rm-dur-fast:150ms;
  --rm-dur:200ms;
  --rm-dur-slow:280ms;
}
.rm-collapse{display:grid;grid-template-rows:0fr;opacity:0;
  transition:grid-template-rows var(--rm-dur) var(--rm-ease-out),
             opacity var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-collapse > *{overflow:hidden;min-height:0}
.rm-collapse-open{grid-template-rows:1fr;opacity:1;
  transition:grid-template-rows var(--rm-dur-slow) var(--rm-ease-out),
             opacity var(--rm-dur) var(--rm-ease-soft)}
@media (prefers-reduced-motion: reduce){
  .rm-page *,.rm-page *::before,.rm-page *::after{
    transition-duration:.01ms !important;animation-duration:.01ms !important}
}

/* ── 布局 ──────────────────────────────────────────────────── */
.rm-shell{display:flex;align-items:flex-start;gap:0}
.rm-wrap{flex:1;min-width:0;margin:0;padding:24px 28px 48px;
  display:flex;flex-direction:column;gap:16px}
.rm-side{width:268px;flex:none;align-self:flex-start;position:sticky;top:0;
  max-height:100vh;overflow-y:auto;
  border-left:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);
  padding:20px 12px 28px;display:flex;flex-direction:column;gap:10px;box-sizing:border-box}
@media (max-width: 700px){
  .rm-shell{flex-direction:column}
  .rm-side{position:static;width:100%;max-height:none;border-left:0;
    border-top:1px solid var(--dsw-alias-border-l1);padding:14px 20px 28px}
}

/* ── 页头 ──────────────────────────────────────────────────── */
.rm-hero{display:flex;align-items:center;gap:12px}
.rm-hero-icon{width:40px;height:40px;border-radius:11px;flex:none;display:grid;place-items:center;
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.rm-hero-title{margin:0;font-size:19px;font-weight:700;letter-spacing:.2px;line-height:1.3}
.rm-hero-sub{margin:2px 0 0;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.rm-hero-actions{margin-left:auto;display:flex;gap:8px;align-items:center;flex:none}

/* ── 统计卡片：纯灰底 + 细边框 ────────────────────────────── */
.rm-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(154px,1fr));gap:10px}
.rm-card{position:relative;text-align:left;cursor:pointer;padding:12px 14px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;
  background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;
  transition:border-color var(--rm-dur-fast) var(--rm-ease-soft),
             background var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-card:hover{border-color:var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-2)}
.rm-card-on{border-color:var(--dsw-alias-brand-primary)}
.rm-card-on:before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
  border-radius:10px 0 0 10px;background:var(--dsw-alias-brand-primary)}
.rm-card-env{font-size:12px;color:var(--dsw-alias-label-secondary)}
.rm-card-num{font-size:23px;font-weight:700;margin:2px 0 0;line-height:1.25;
  font-variant-numeric:tabular-nums}
.rm-card-detail{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.rm-card-bar{height:4px;border-radius:2px;margin-top:9px;overflow:hidden;
  background:var(--dsw-alias-border-l1)}
.rm-card-fill{height:100%;border-radius:2px;
  background:var(--dsw-alias-state-success-primary);
  transition:width var(--rm-dur-slow) var(--rm-ease-out)}
/* 环境色仅用作类名占位，不再着色 */
.rm-env-local,.rm-env-test,.rm-env-staging,.rm-env-prod{}

/* ── 筛选 ──────────────────────────────────────────────────── */
.rm-filters{display:flex;flex-direction:column;gap:8px}
.rm-filter-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rm-filter{display:inline-flex;align-items:center;gap:6px}
.rm-filter-name{font-size:11.5px;color:var(--dsw-alias-label-secondary);
  white-space:nowrap;min-width:2em}
.rm-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;
  overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.rm-seg button{border:0;border-right:1px solid var(--dsw-alias-border-l1);
  background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:12.5px;padding:5px 12px;cursor:pointer;white-space:nowrap;
  transition:background var(--rm-dur-fast) var(--rm-ease-soft),
             color var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-seg button:last-child{border-right:0}
.rm-seg button:hover{background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary)}
.rm-seg button.rm-on{background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);font-weight:600}
.rm-search{flex:1;min-width:190px;display:flex;align-items:center;gap:7px;padding:5px 11px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-bg-layer-1);
  transition:border-color var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-search:focus-within{border-color:var(--dsw-alias-brand-primary)}
.rm-search svg{flex:none;opacity:.5}
.rm-search input{flex:1;min-width:0;border:0;outline:none;background:transparent;
  color:inherit;font:inherit;font-size:12.5px;padding:1px 0}
.rm-search input::placeholder{color:var(--dsw-alias-label-secondary)}

/* ── 分组列表 ──────────────────────────────────────────────── */
.rm-group{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-1)}
.rm-group-head{display:flex;align-items:center;gap:8px;padding:9px 14px;
  font-size:12.5px;font-weight:600;background:var(--dsw-alias-bg-layer-2);
  border-bottom:1px solid var(--dsw-alias-border-l1)}
.rm-dot{width:6px;height:6px;border-radius:50%;flex:none;
  background:var(--dsw-alias-label-secondary)}
.rm-group-count{margin-left:auto;font-weight:400;
  color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}

/* 节点筛选时，左栏分组加标识 */
.rm-group-on{border-color:var(--dsw-alias-brand-primary);
  box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.rm-group-on .rm-group-head{color:var(--dsw-alias-brand-primary)}

/* 节点筛选提示条 */
.rm-nodefilter{display:flex;align-items:center;gap:8px;padding:7px 12px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);font-size:12px;
  animation:rm-form-in var(--rm-dur) var(--rm-ease-out)}
.rm-nodefilter-label{color:var(--dsw-alias-label-secondary)}
.rm-nodefilter-name{font-weight:600}
.rm-nodefilter .rm-btn{margin-left:auto}
.rm-rows{display:flex;flex-direction:column}
.rm-row{display:flex;align-items:flex-start;gap:12px;padding:11px 14px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  transition:background var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-row:last-child{border-bottom:0}
.rm-row:hover{background:var(--dsw-alias-bg-layer-2)}
.rm-row:hover .rm-row-actions{opacity:1}
.rm-check{width:16px;height:16px;margin:2px 0 0;flex:none;cursor:pointer;
  accent-color:var(--dsw-alias-brand-primary)}
.rm-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.rm-title{font-weight:600;word-break:break-word}
.rm-done .rm-title{text-decoration:line-through;font-weight:400;
  color:var(--dsw-alias-label-secondary)}
.rm-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px;
  color:var(--dsw-alias-label-secondary)}
.rm-note{font-size:12px;color:var(--dsw-alias-label-secondary);
  padding-left:8px;border-left:2px solid var(--dsw-alias-border-l2)}
.rm-row-actions{display:flex;gap:4px;flex:none;margin-top:1px;opacity:.5;
  transition:opacity var(--rm-dur-fast) var(--rm-ease-soft)}

/* ── 标签：极简，只有文字和细边 ───────────────────────────── */
.rm-chip{border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 5px;
  font-size:11px;line-height:17px;white-space:nowrap;font-weight:500;
  color:var(--dsw-alias-label-secondary);background:transparent}
.rm-chip-p0{color:var(--dsw-alias-state-error-primary);
  border-color:var(--dsw-alias-state-error-primary)}
.rm-chip-p1{color:var(--dsw-alias-label-secondary);
  border-color:var(--dsw-alias-border-l2)}
.rm-chip-p2{color:var(--dsw-alias-label-secondary);
  border-color:var(--dsw-alias-border-l1);opacity:.85}
.rm-chip-done{color:var(--dsw-alias-state-success-primary);
  border-color:var(--dsw-alias-state-success-primary)}
.rm-chip-blocked{color:var(--dsw-alias-state-warn-primary);
  border-color:var(--dsw-alias-state-warn-primary)}
.rm-chip-prog{color:var(--dsw-alias-brand-primary);
  border-color:var(--dsw-alias-brand-primary)}
.rm-chip-pending{color:var(--dsw-alias-label-secondary);
  border-color:var(--dsw-alias-border-l1)}
.rm-chip-env{color:var(--dsw-alias-label-secondary);
  border-color:var(--dsw-alias-border-l1)}
.rm-due{white-space:nowrap}
.rm-due-over{color:var(--dsw-alias-state-error-primary)}

/* ── 按钮：扁平，只用品牌色强调主操作 ─────────────────────── */
.rm-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:7px;
  background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:500;
  padding:4px 11px;cursor:pointer;white-space:nowrap;line-height:1.5;
  transition:color var(--rm-dur-fast) var(--rm-ease-soft),
             border-color var(--rm-dur-fast) var(--rm-ease-soft),
             background var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-btn:hover{color:var(--dsw-alias-label-primary);
  border-color:var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-2)}
.rm-btn:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary);
  box-shadow:0 0 0 2px var(--dsw-alias-bg-base),
             0 0 0 3px var(--dsw-alias-brand-primary)}
.rm-btn:active{transform:scale(.98)}
.rm-btn-primary{color:var(--dsw-alias-bg-base);
  border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-brand-primary);
  font-size:12.5px;padding:5px 14px;font-weight:600}
.rm-btn-primary:hover{color:var(--dsw-alias-bg-base);
  border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-brand-primary);opacity:.88}
.rm-btn-danger{color:var(--dsw-alias-state-error-primary);
  border-color:var(--dsw-alias-border-l1)}
.rm-btn-danger:hover{color:var(--dsw-alias-state-error-primary);
  border-color:var(--dsw-alias-state-error-primary);
  background:var(--dsw-alias-bg-layer-2)}
.rm-btn-sm{font-size:11px;padding:2px 8px;border-radius:6px}
.rm-btn-lg{font-size:13px;padding:7px 18px;border-radius:8px}
.rm-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.rm-btn:disabled:hover{color:var(--dsw-alias-label-secondary);
  border-color:var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1)}

/* ── 表单 ──────────────────────────────────────────────────── */
.rm-form{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;
  padding:16px;background:var(--dsw-alias-bg-layer-1);
  animation:rm-form-in var(--rm-dur) var(--rm-ease-out)}
@keyframes rm-form-in{
  from{opacity:0;transform:translateY(-4px)}
  to{opacity:1;transform:none}
}
.rm-form-title{margin:0 0 13px;padding-bottom:11px;font-size:13.5px;font-weight:700;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  display:flex;align-items:center;gap:7px}
.rm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(152px,1fr));gap:11px}
.rm-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.rm-field-span{grid-column:1/-1}
.rm-label{font-size:11.5px;color:var(--dsw-alias-label-secondary);font-weight:500}
.rm-input,.rm-select{width:100%;border:1px solid var(--dsw-alias-border-l1);
  border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:inherit;
  font:inherit;font-size:12.5px;padding:6px 10px;outline:none;
  transition:border-color var(--rm-dur-fast) var(--rm-ease-soft),
             background var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.8}
.rm-input:hover,.rm-select:hover{border-color:var(--dsw-alias-border-l2)}
.rm-input:focus,.rm-select:focus{border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-bg-layer-1)}
.rm-select{cursor:pointer;appearance:none;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),
                   linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 15px) center, calc(100% - 10px) center;
  background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:30px}
.rm-form-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;
  padding-top:13px;border-top:1px solid var(--dsw-alias-border-l1)}
.rm-input[type=date]{color-scheme:light dark}
.rm-date{cursor:pointer}
.rm-date::-webkit-calendar-picker-indicator{cursor:pointer;opacity:.75}
.rm-date:hover::-webkit-calendar-picker-indicator{opacity:1}
.rm-copy{}
.rm-copy-sub{margin:-4px 0 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}

/* ── 侧栏树 ────────────────────────────────────────────────── */
.rm-side-head{display:flex;align-items:center;gap:8px;padding:0 2px 6px;
  border-bottom:1px solid var(--dsw-alias-border-l1)}
.rm-side-title{font-size:13px;font-weight:700}
.rm-side-count{font-size:11px;color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:0 6px;line-height:17px;
  font-variant-numeric:tabular-nums}
.rm-side-add{margin-left:auto;font-size:11.5px;padding:3px 10px;border-radius:7px}
.rm-side-extra{font-size:11px;padding:3px 9px;border-radius:7px;margin-left:auto}
.rm-side-extra + .rm-side-add{margin-left:6px}

.rm-tree{display:flex;flex-direction:column;gap:2px}
.rm-tree-node{position:relative}
.rm-tree-parent{display:flex;align-items:center;gap:6px;padding:6px;border-radius:6px;
  cursor:pointer;font-size:12.5px;
  transition:background var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-tree-parent:hover{background:var(--dsw-alias-bg-layer-2)}
.rm-tree-caret{font-size:9px;opacity:.5;flex:none;cursor:pointer;padding:0 1px;line-height:1;
  transition:transform var(--rm-dur) var(--rm-ease-out),
             opacity var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-tree-caret:hover{opacity:1}
/* 选中态：左侧色条 + 品牌色文字，与 hover 明确区分 */
.rm-tree-on{background:var(--dsw-alias-bg-layer-2);
  box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.rm-tree-parent.rm-tree-on .rm-tree-name{color:var(--dsw-alias-brand-primary);font-weight:700}
.rm-tree-parent.rm-tree-on .rm-tree-badge{color:var(--dsw-alias-brand-primary)}
.rm-tree-parent.rm-tree-on .rm-tree-caret{opacity:1}
.rm-caret-closed{transform:rotate(-90deg)}
.rm-tree-name{font-weight:600;word-break:break-word;min-width:0}
.rm-tree-date{font-size:10.5px;color:var(--dsw-alias-label-secondary);flex:none;
  font-variant-numeric:tabular-nums}
.rm-tree-badge{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-secondary);
  flex:none;font-variant-numeric:tabular-nums}
.rm-tree-children{margin-left:9px;padding-left:7px;
  border-left:1px solid var(--dsw-alias-border-l1);
  display:flex;flex-direction:column;gap:1px;margin-top:1px;margin-bottom:3px}
.rm-tree-leaf{display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 5px;
  border-radius:5px;color:var(--dsw-alias-label-secondary);cursor:default}
.rm-tree-leaf:hover{background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary)}

/* 环境分组层：比事项稍微突出，比节点弱 */
.rm-tree-envgroup{display:flex;flex-direction:column}
.rm-tree-env{display:flex;align-items:center;gap:5px;padding:3px 5px;
  border-radius:5px;cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-secondary);
  transition:background var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-tree-env:hover{background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary)}
.rm-tree-envname{font-weight:500;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.rm-tree-envcount{margin-left:auto;font-size:10px;flex:none;
  font-variant-numeric:tabular-nums;opacity:.8}
.rm-tree-envchildren{margin-left:7px;padding-left:6px;
  border-left:1px solid var(--dsw-alias-border-l1);
  display:flex;flex-direction:column;gap:0;padding-top:1px;padding-bottom:2px}
.rm-leaf-dot{width:5px;height:5px;border-radius:50%;flex:none;
  background:var(--dsw-alias-border-l2)}
.rm-leaf-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rm-tree-done .rm-leaf-text{text-decoration:line-through;opacity:.6}
.rm-tree-over .rm-leaf-dot{background:var(--dsw-alias-state-error-primary)}
.rm-tree-over .rm-leaf-text{color:var(--dsw-alias-state-error-primary)}
.rm-tree-muted{font-style:italic;opacity:.6;font-size:11.5px}
.rm-tree-tools{display:flex;gap:3px;justify-content:flex-end;padding:0 6px 2px;opacity:0;
  transition:opacity var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-tree-node:hover .rm-tree-tools{opacity:1}
.rm-tree-tools .rm-btn{font-size:10.5px;padding:1px 7px;border-radius:5px}
.rm-tree-orphan > .rm-tree-parent > .rm-tree-name{
  color:var(--dsw-alias-label-secondary);font-weight:400}
.rm-ms-empty{padding:16px 14px;font-size:12px;
  color:var(--dsw-alias-label-secondary);text-align:center}
.rm-ms-form{padding:12px;margin:0 2px 8px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:9px;
  background:var(--dsw-alias-bg-layer-2);
  display:flex;flex-direction:column;gap:9px;
  animation:rm-form-in var(--rm-dur) var(--rm-ease-out)}
.rm-ms-form .rm-form-actions{margin-top:2px;padding-top:0;border-top:0}

/* ── 多选 ──────────────────────────────────────────────────── */
.rm-targets{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.rm-target{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);
  font:inherit;font-size:12.5px;
  transition:border-color var(--rm-dur-fast) var(--rm-ease-soft),
             background var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-target:hover{border-color:var(--dsw-alias-border-l2)}
.rm-target-on{border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-bg-layer-1)}
.rm-target-box{width:15px;height:15px;flex:none;display:grid;place-items:center;
  font-size:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;line-height:1}
.rm-target-on .rm-target-box{border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.rm-check-row{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;
  color:var(--dsw-alias-label-secondary)}
.rm-check-row input{accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.rm-envpick{display:flex;flex-wrap:wrap;gap:8px}
.rm-envbtn{display:inline-flex;align-items:center;gap:7px;padding:6px 13px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);
  font:inherit;font-size:12.5px;
  transition:border-color var(--rm-dur-fast) var(--rm-ease-soft),
             background var(--rm-dur-fast) var(--rm-ease-soft)}
.rm-envbtn:hover{border-color:var(--dsw-alias-border-l2)}
.rm-envbtn-on{border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-bg-layer-1)}
.rm-envbtn-on .rm-target-box{border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.rm-mspick{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.rm-mspick .rm-select{flex:1;min-width:190px}

/* ── 提示 ──────────────────────────────────────────────────── */
.rm-error{margin:0;padding:8px 12px;border-radius:8px;font-size:12px;
  color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-state-error-primary)}
.rm-empty{text-align:center;padding:32px 0;font-size:13px;
  color:var(--dsw-alias-label-secondary)}
`;

    /* ── 数据访问 ─────────────────────────────────────────────── */
    async function api(body) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let payload = null;
      try { payload = await res.json(); } catch { /* 非 JSON 响应 */ }
      if (!payload || payload.ok !== true) {
        throw new Error(payload?.error || `请求失败（HTTP ${res.status}）`);
      }
      return payload.value;
    }

    /* ── 图标 ─────────────────────────────────────────────────── */
    function PanelIcon(props) {
      const size = props.size || 20;
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'none',
        stroke: props.active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        React.createElement('path', { d: 'M7 3h10a2 2 0 0 1 2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2z' }),
        React.createElement('path', { d: 'M9.5 11.5l1.8 1.8 3.4-3.6' }));
    }

    function SearchIcon() {
      return React.createElement('svg', {
        width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
      },
        React.createElement('circle', { cx: 11, cy: 11, r: 7 }),
        React.createElement('path', { d: 'M20 20l-3.5-3.5' }));
    }

    function Field(props) {
      return React.createElement('div', {
        className: 'rm-field' + (props.span ? ' rm-field-span' : ''),
      },
        React.createElement('span', { className: 'rm-label' }, props.label),
        props.children);
    }

    /* ── 主面板 ───────────────────────────────────────────────── */
    function PanelPage() {
      const [items, setItems] = useState([]);
      const [allItems, setAllItems] = useState([]); // 全量事项，供右侧节点树使用
      const [stats, setStats] = useState(null);
      const [env, setEnv] = useState('local'); // 进入时默认只看本地环境
      const [status, setStatus] = useState('all');
      const [keyword, setKeyword] = useState('');
      // 时间节点列表与编辑状态
      const [milestones, setMilestones] = useState([]);
      const [msFilter, setMsFilter] = useState(null); // 选中节点：null | 节点id | 'none'
      const listRef = useRef(null);
      // 折叠状态：默认全部展开（记录“已折叠”的节点 key）
      const [collapsed, setCollapsed] = useState({});
      const toggleCollapse = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
      const [showMsAdd, setShowMsAdd] = useState(false);
      const [editingMs, setEditingMs] = useState(null);
      const [msDraft, setMsDraft] = useState({ name: '', date: '', note: '' });
      const [showForm, setShowForm] = useState(false);
      const [editing, setEditing] = useState(null);
      const [draft, setDraft] = useState(makeDraft);
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(true);
      // 复制面板：{ item, targets: Set, keepStatus: bool }
      const [copying, setCopying] = useState(null);
      const alive = useRef(true);

      useEffect(() => () => { alive.current = false; }, []);

      const refresh = useCallback(async () => {
        try {
          // allItems 供右侧节点树使用（不受筛选影响）；items 是当前筛选结果
          const [filtered, all] = await Promise.all([
            api({ action: 'list', env, status, keyword }),
            api({ action: 'list' }),
          ]);
          if (!alive.current) return;
          setItems(filtered.items || []);
          setStats(filtered.stats || null);
          setMilestones(filtered.milestones || []);
          setAllItems(all.items || []);
          setError('');
        } catch (err) {
          if (alive.current) setError(String(err?.message ?? err));
        } finally {
          if (alive.current) setLoading(false);
        }
      }, [env, status, keyword]);

      useEffect(() => { refresh(); }, [refresh]);

      const grouped = useMemo(() => {
        // 组内排序：未完成优先（状态权重），再按优先级，最后按创建顺序
        const statusRank = { blocked: 0, in_progress: 1, pending: 2, done: 3 };
        const prioRank = { P0: 0, P1: 1, P2: 2 };
        const sortRows = (rows) => rows.slice().sort((a, b) => {
          const s = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
          if (s !== 0) return s;
          const p = (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9);
          if (p !== 0) return p;
          return a.id - b.id;
        });
        const map = new Map(ENVS.map((e) => [e, []]));
        // 选中树节点时，左栏只显示该节点下的事项
        const base = msFilter === null
          ? items
          : items.filter((it) => (msFilter === 'none'
            ? (it.milestoneId === null || it.milestoneId === undefined)
            : it.milestoneId === msFilter));
        for (const it of base) {
          if (map.has(it.env)) map.get(it.env).push(it);
        }
        return ENVS.map((e) => ({ env: e, rows: sortRows(map.get(e)) })).filter((g) => g.rows.length > 0);
      }, [items, msFilter]);

      const submit = async (event) => {
        event.preventDefault();
        try {
          if (!draft.title.trim()) throw new Error('标题不能为空');
          if (draft.envs.length === 0) throw new Error('请至少选择一个环境');
          if (editing === null) {
            // 新增：envs 可多个，Host 会为每个环境各建一条
            await api({ action: 'add', item: draft });
          } else {
            // 编辑：一条事项只属于一个环境，取第一个选中的
            const { envs, ...rest } = draft;
            await api({ action: 'update', id: editing, patch: { ...rest, env: envs[0] } });
          }
          setEditing(null);
          setDraft(makeDraft());
          setShowForm(false);
          await refresh();
        } catch (err) {
          setError(String(err?.message ?? err));
        }
      };

      const startEdit = (item) => {
        setEditing(item.id);
        setDraft({
          envs: [item.env],
          title: item.title,
          owner: item.owner || '',
          milestoneId: item.milestoneId ?? null,
          due: item.due || '',
          priority: item.priority,
          status: item.status,
          note: item.note || '',
        });
        setShowForm(true);
        setError('');
      };

      /* ── 时间节点管理 ──────────────────────────────────────── */
      const submitMs = async (event) => {
        event.preventDefault();
        try {
          if (!msDraft.name.trim()) throw new Error('节点名称不能为空');
          if (!msDraft.date) throw new Error('请选择节点日期');
          if (editingMs === null) {
            await api({ action: 'milestoneAdd', milestone: msDraft });
          } else {
            await api({ action: 'milestoneUpdate', id: editingMs, patch: msDraft });
          }
          setMsDraft({ name: '', date: '', note: '' });
          setShowMsAdd(false);
          setEditingMs(null);
          await refresh();
        } catch (err) {
          setError(String(err?.message ?? err));
        }
      };

      const startEditMs = (m) => {
        setEditingMs(m.id);
        setMsDraft({ name: m.name, date: m.date, note: m.note || '' });
        setShowMsAdd(true);
        setError('');
      };

      const removeMs = async (id) => {
        try { await api({ action: 'milestoneRemove', id }); await refresh(); }
        catch (err) { setError(String(err?.message ?? err)); }
      };

      const toggle = async (id) => {
        try { await api({ action: 'toggle', id }); await refresh(); }
        catch (err) { setError(String(err?.message ?? err)); }
      };

      /**
       * 点击树节点：设置筛选 + 滚动定位到左栏对应分组。
       * 传 null / 相同值即取消。
       */
      const selectNode = (value) => {
        const next = msFilter === value ? null : value;
        setMsFilter(next);
        if (next === null) return;
        setShowForm(false);
        setEditing(null);
        // 等筛选后的列表渲染完成，再滚动到目标分组
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const host = listRef.current;
            if (!host) return;
            const target = host.querySelector(`[data-ms="${next}"]`);
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              host.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          });
        });
      };

      /* ── 跨环境复制 ──────────────────────────────────────────── */
      const openCopy = (item) => {
        setCopying({ item, targets: [], keepStatus: false });
        setShowForm(false);
        setEditing(null);
        setError('');
      };

      const toggleTarget = (targetEnv) => {
        setCopying((prev) => {
          if (!prev) return prev;
          const has = prev.targets.includes(targetEnv);
          return {
            ...prev,
            targets: has ? prev.targets.filter((t) => t !== targetEnv) : [...prev.targets, targetEnv],
          };
        });
      };

      const confirmCopy = async () => {
        if (!copying) return;
        const { item, targets, keepStatus } = copying;
        if (targets.length === 0) {
          setError('请至少选择一个目标环境');
          return;
        }
        try {
          await api({
            action: 'copy',
            id: item.id,
            targets,
            // 默认把副本重置为待办（常见诉求：复制一份重新走流程）
            overrides: keepStatus ? {} : { status: 'pending' },
          });
          setCopying(null);
          await refresh();
        } catch (err) {
          setError(String(err?.message ?? err));
        }
      };

      const remove = async (id) => {
        try { await api({ action: 'remove', id }); await refresh(); }
        catch (err) { setError(String(err?.message ?? err)); }
      };

      const pending = stats ? stats.total - (stats.byStatus.done || 0) : 0;
      const blocked = stats ? (stats.byStatus.blocked || 0) : 0;

      const envCard = (e) => {
        const total = stats?.byEnv?.[e] || 0;
        const done = stats?.envDone?.[e] || 0;
        const pct = total ? Math.round((done / total) * 100) : 0;
        return React.createElement('button', {
          key: e,
          type: 'button',
          className: 'rm-card rm-env-' + e + (env === e ? ' rm-card-on' : ''),
          onClick: () => { setEnv(env === e ? 'all' : e); setShowForm(false); setEditing(null); },
          'aria-pressed': env === e,
          title: `${ENV_LABELS[e]}：${done}/${total} 已完成`,
        },
          React.createElement('div', { className: 'rm-card-env' }, ENV_LABELS[e]),
          React.createElement('div', { className: 'rm-card-num' }, String(total)),
          React.createElement('div', { className: 'rm-card-detail' },
            total ? `${done}/${total} 完成 · ${pct}%` : '暂无事项'),
          React.createElement('div', {
            className: 'rm-card-bar', role: 'progressbar',
            'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100,
          }, React.createElement('div', { className: 'rm-card-fill', style: { width: `${pct}%` } })));
      };

      const seg = (label, options, value, onChange) => React.createElement('div', {
        className: 'rm-filter',
      },
        React.createElement('span', { className: 'rm-filter-name' }, label),
        React.createElement('div', { className: 'rm-seg', role: 'group', 'aria-label': label },
          options.map(({ v, l }) => React.createElement('button', {
            key: v, type: 'button', className: value === v ? 'rm-on' : '',
            'aria-pressed': value === v, onClick: () => onChange(v),
          }, l))));

      const envOptions = [{ v: 'all', l: '全部' }].concat(ENVS.map((e) => ({ v: e, l: ENV_SHORT[e] })));
      const statusOptions = [{ v: 'all', l: '全部' }].concat(STATUSES.map((s) => ({ v: s, l: STATUS_LABELS[s] })));
      const renderRow = (it) => React.createElement('div', {
        key: it.id, className: 'rm-row' + (it.status === 'done' ? ' rm-done' : ''),
      },
        React.createElement('input', {
          className: 'rm-check', type: 'checkbox', checked: it.status === 'done',
          onChange: () => toggle(it.id), title: '标记完成 / 恢复待办',
          'aria-label': `标记完成：${it.title}`,
        }),
        React.createElement('div', { className: 'rm-main' },
          React.createElement('div', { className: 'rm-title' }, it.title),
          React.createElement('div', { className: 'rm-meta' },
            React.createElement('span', {
              className: 'rm-chip' + (it.priority === 'P0' ? ' rm-chip-p0'
                : it.priority === 'P1' ? ' rm-chip-p1' : ' rm-chip-p2'),
            }, it.priority),
            React.createElement('span', {
              className: 'rm-chip' + (it.status === 'done' ? ' rm-chip-done'
                : it.status === 'blocked' ? ' rm-chip-blocked'
                  : it.status === 'in_progress' ? ' rm-chip-prog' : ' rm-chip-pending'),
            }, STATUS_LABELS[it.status] || it.status),
            it.owner ? React.createElement('span', null, `负责人 ${it.owner}`) : null,
            (() => {
              const node = milestones.find((m) => m.id === it.milestoneId);
              if (!it.due && !node) return null;
              const label = node ? `${node.name} · ${formatDue(it.due)}` : formatDue(it.due);
              return React.createElement('span', {
                className: isOverdue(it) ? 'rm-due rm-due-over' : 'rm-due',
                title: node
                  ? `时间节点：${node.name}（${it.due}）${isOverdue(it) ? '，已逾期' : ''}`
                  : `截止 ${it.due}${isOverdue(it) ? '，已逾期' : ''}`,
              }, `${label}${isOverdue(it) ? ' · 已逾期' : ''}`);
            })()),
          it.note ? React.createElement('div', { className: 'rm-note' }, it.note) : null),
        React.createElement('div', { className: 'rm-row-actions' },
          React.createElement('button', {
            type: 'button', className: 'rm-btn', onClick: () => startEdit(it),
          }, '编辑'),
          React.createElement('button', {
            type: 'button', className: 'rm-btn', onClick: () => openCopy(it),
            title: '复制到其他环境',
          }, '复制'),
          React.createElement('button', {
            type: 'button', className: 'rm-btn rm-btn-danger', onClick: () => remove(it.id),
          }, '删除')));

      /* ── 右侧：时间节点树 ─────────────────────────────────────
       * 树形：节点为父，关联该节点的事项为子；
       * 另有“未指定节点”分组收纳没有关联的事项。
       */
      const itemsByMs = new Map();
      for (const it of allItems) {
        const key = it.milestoneId ?? 'none';
        if (!itemsByMs.has(key)) itemsByMs.set(key, []);
        itemsByMs.get(key).push(it);
      }
      const orphanItems = itemsByMs.get('none') ?? [];

      /** 把一个节点下的事项再按环境分组：[[env, items], ...]（按 ENVS 顺序） */
      const groupByEnv = (list) => {
        const map = new Map();
        for (const it of list) {
          if (!map.has(it.env)) map.set(it.env, []);
          map.get(it.env).push(it);
        }
        return ENVS.filter((e) => map.has(e)).map((e) => [e, map.get(e)]);
      };

      const msTotal = milestones.length;
      // 是否全部已折叠（用于切换按钮文案）
      const collapseKeys = milestones.map((m) => `ms-${m.id}`)
        .concat(orphanItems.length > 0 ? ['none'] : []);
      const allCollapsed = collapseKeys.length > 0 && collapseKeys.every((k) => collapsed[k]);

      /** 单条事项叶子 */
      const renderLeaf = (it, prefix) => React.createElement('div', {
        key: `${prefix}-${it.id}`,
        className: 'rm-tree-leaf'
          + (it.status === 'done' ? ' rm-tree-done' : '')
          + (isOverdue(it) ? ' rm-tree-over' : ''),
        title: `${it.title}（${ENV_LABELS[it.env]} · ${STATUS_LABELS[it.status]}）`,
      },
        React.createElement('span', { className: 'rm-leaf-dot' }),
        React.createElement('span', { className: 'rm-leaf-text' }, it.title));

      /** 环境分组层：环境名 + 其下事项 */
      const renderEnvGroup = (env, list, prefix) => {
        const done = list.filter((x) => x.status === 'done').length;
        const envKey = `${prefix}-env-${env}`;
        const isCollapsedEnv = !!collapsed[envKey];
        return React.createElement('div', { key: envKey, className: 'rm-tree-envgroup' },
          React.createElement('div', {
            className: 'rm-tree-env',
            role: 'button', tabIndex: 0,
            onClick: (e) => { e.stopPropagation(); toggleCollapse(envKey); },
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault(); e.stopPropagation(); toggleCollapse(envKey);
              }
            },
          },
            React.createElement('span', {
              className: 'rm-tree-caret' + (isCollapsedEnv ? ' rm-caret-closed' : ''),
              'aria-expanded': String(!isCollapsedEnv),
            }, '▾'),
            React.createElement('span', { className: 'rm-tree-envname' }, ENV_LABELS[env]),
            React.createElement('span', { className: 'rm-tree-envcount' }, `${done}/${list.length}`)),
          React.createElement('div', {
            className: 'rm-collapse' + (isCollapsedEnv ? '' : ' rm-collapse-open'),
            'aria-hidden': String(isCollapsedEnv),
          },
            React.createElement('div', { className: 'rm-tree-envchildren' },
              list.map((it) => renderLeaf(it, envKey)))));
      };

      const msPanel = React.createElement('aside', { className: 'rm-side' },
        React.createElement('div', { className: 'rm-side-head' },
          React.createElement('span', { className: 'rm-side-title' }, '时间节点'),
          React.createElement('span', { className: 'rm-side-count' },
            msTotal ? `${msTotal}` : '0'),
          React.createElement('button', {
            type: 'button', className: 'rm-btn rm-side-extra',
            title: allCollapsed ? '全部展开' : '全部折叠',
            onClick: () => {
              if (allCollapsed) { setCollapsed({}); return; }
              const next = {};
              for (const m of milestones) next[`ms-${m.id}`] = true;
              if (orphanItems.length > 0) next.none = true;
              setCollapsed(next);
            },
          }, allCollapsed ? '展开' : '折叠'),
          React.createElement('button', {
            type: 'button', className: 'rm-btn rm-btn-primary rm-side-add',
            onClick: () => {
              if (showMsAdd && editingMs === null) { setShowMsAdd(false); return; }
              setEditingMs(null);
              setMsDraft({ name: '', date: '', note: '' });
              setShowMsAdd(true);
              setError('');
            },
          }, showMsAdd && editingMs === null ? '取消' : '＋')),

        showMsAdd ? React.createElement('form', { className: 'rm-ms-form', onSubmit: submitMs },
          React.createElement(Field, { label: '节点名称' },
            React.createElement('input', {
              className: 'rm-input', value: msDraft.name, autoFocus: true,
              placeholder: '如 开发提测',
              onChange: (e) => setMsDraft({ ...msDraft, name: e.target.value }),
            })),
          React.createElement(Field, { label: '节点日期（年月日）' },
            React.createElement('input', {
              className: 'rm-input rm-date', type: 'date', value: msDraft.date,
              onChange: (e) => setMsDraft({ ...msDraft, date: e.target.value }),
              onClick: (e) => { try { e.currentTarget.showPicker?.(); } catch { /* ignore */ } },
            })),
          React.createElement(Field, { label: '备注' },
            React.createElement('input', {
              className: 'rm-input', value: msDraft.note, placeholder: '可选',
              onChange: (e) => setMsDraft({ ...msDraft, note: e.target.value }),
            })),
          React.createElement('div', { className: 'rm-form-actions' },
            React.createElement('button', {
              type: 'button', className: 'rm-btn',
              onClick: () => { setShowMsAdd(false); setEditingMs(null); setError(''); },
            }, '取消'),
            React.createElement('button', { type: 'submit', className: 'rm-btn rm-btn-primary rm-btn-lg' },
              editingMs === null ? '添加' : '保存'))) : null,

        React.createElement('div', { className: 'rm-tree' },
          milestones.length === 0 && orphanItems.length === 0
            ? React.createElement('div', { className: 'rm-ms-empty' }, '还没有时间节点')
            : null,
          milestones.map((m) => {
            const children = itemsByMs.get(m.id) ?? [];
            const doneCount = children.filter((c) => c.status === 'done').length;
            const key = `ms-${m.id}`;
            const isCollapsed = !!collapsed[key];
            return React.createElement('div', { key, className: 'rm-tree-node' },
              React.createElement('div', {
                className: 'rm-tree-parent'
                  + (msFilter === m.id ? ' rm-tree-on' : ''),
                role: 'button', tabIndex: 0,
                onClick: () => selectNode(m.id),
                onKeyDown: (e) => { if (e.key === 'Enter') selectNode(m.id); },
              },
                React.createElement('span', {
                  className: 'rm-tree-caret' + (isCollapsed ? ' rm-caret-closed' : ''),
                  role: 'button',
                  'aria-expanded': String(!isCollapsed),
                  'aria-label': isCollapsed ? '展开' : '折叠',
                  title: isCollapsed ? '展开' : '折叠',
                  onClick: (e) => { e.stopPropagation(); toggleCollapse(key); },
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault(); e.stopPropagation(); toggleCollapse(key);
                    }
                  },
                }, '▾'),
                React.createElement('span', { className: 'rm-tree-name' }, m.name),
                React.createElement('span', { className: 'rm-tree-date' }, formatDue(m.date)),
                React.createElement('span', { className: 'rm-tree-badge' },
                  `${doneCount}/${children.length}`)),
              React.createElement('div', {
                className: 'rm-collapse' + (isCollapsed ? '' : ' rm-collapse-open'),
                'aria-hidden': String(isCollapsed),
              },
                React.createElement('div', { className: 'rm-tree-children' },
                  children.length === 0
                    ? React.createElement('div', { className: 'rm-tree-leaf rm-tree-muted' }, '暂无事项')
                    : groupByEnv(children).map(([env, list]) =>
                      renderEnvGroup(env, list, key)))),
              React.createElement('div', { className: 'rm-tree-tools' },
                React.createElement('button', {
                  type: 'button', className: 'rm-btn', onClick: () => startEditMs(m),
                }, '改'),
                React.createElement('button', {
                  type: 'button', className: 'rm-btn rm-btn-danger', onClick: () => removeMs(m.id),
                }, '删')));
          }),
          orphanItems.length > 0
            ? React.createElement('div', { className: 'rm-tree-node rm-tree-orphan' },
              React.createElement('div', {
                className: 'rm-tree-parent' + (msFilter === 'none' ? ' rm-tree-on' : ''),
                onClick: () => selectNode('none'),
                role: 'button', tabIndex: 0,
                onKeyDown: (e) => { if (e.key === 'Enter') selectNode('none'); },
              },
                React.createElement('span', {
                  className: 'rm-tree-caret' + (collapsed['none'] ? ' rm-caret-closed' : ''),
                  role: 'button',
                  'aria-expanded': String(!collapsed['none']),
                  'aria-label': collapsed['none'] ? '展开' : '折叠',
                  title: collapsed['none'] ? '展开' : '折叠',
                  onClick: (e) => { e.stopPropagation(); toggleCollapse('none'); },
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault(); e.stopPropagation(); toggleCollapse('none');
                    }
                  },
                }, '▾'),
                React.createElement('span', { className: 'rm-tree-name' }, '未指定节点'),
                React.createElement('span', { className: 'rm-tree-badge' },
                  `${orphanItems.filter((i) => i.status === 'done').length}/${orphanItems.length}`)),
              React.createElement('div', {
                className: 'rm-collapse' + (collapsed['none'] ? '' : ' rm-collapse-open'),
                'aria-hidden': String(!!collapsed['none']),
              },
                React.createElement('div', { className: 'rm-tree-children' },
                  groupByEnv(orphanItems).map(([env, list]) =>
                    renderEnvGroup(env, list, 'none')))))
            : null));

      /* 清单区内容：抽成变量，避免深层嵌套的括号问题 */
      const listContent = loading
        ? React.createElement('div', { className: 'rm-empty' }, '加载中…')
        : grouped.length === 0
          ? React.createElement('div', { className: 'rm-empty' },
            (keyword || status !== 'all')
              ? '没有符合筛选条件的事项'
              : env !== 'all'
                ? `${ENV_LABELS[env]}还没有检查事项，点右上角「新增事项」创建第一条`
                : '还没有检查事项，点右上角「新增事项」创建第一条')
          : grouped.map(({ env: e, rows }, i) => React.createElement('div', {
            key: e,
            className: 'rm-group rm-env-' + e + (msFilter !== null ? ' rm-group-on' : ''),
            // 第一个分组作为滚动锚点
            'data-ms': i === 0 ? (msFilter === null ? '' : String(msFilter)) : undefined,
          },
            React.createElement('div', { className: 'rm-group-head' },
              React.createElement('span', { className: 'rm-dot' }),
              ENV_LABELS[e],
              React.createElement('span', { className: 'rm-group-count' }, `${rows.length} 项`)),
            React.createElement('div', { className: 'rm-rows' }, rows.map(renderRow))));

      return React.createElement('div', { className: 'rm-page', ref: listRef },
        React.createElement('style', null, CSS),
        React.createElement('div', { className: 'rm-shell' },
          React.createElement('div', { className: 'rm-wrap' },

          React.createElement('div', { className: 'rm-hero' },
            React.createElement('div', { className: 'rm-hero-icon' },
              React.createElement(PanelIcon, { size: 23, active: true })),
            React.createElement('div', null,
              React.createElement('h1', { className: 'rm-hero-title' }, '上线准备备忘录'),
              React.createElement('p', { className: 'rm-hero-sub' },
                stats
                  ? `共 ${stats.total} 项 · 待完成 ${pending} 项 · 受阻 ${blocked} 项`
                  : '功能上线前的检查清单，按环境跟踪推进')),
            React.createElement('div', { className: 'rm-hero-actions' },
              React.createElement('button', {
                type: 'button', className: 'rm-btn rm-btn-primary',
                onClick: () => {
                  if (showForm && editing === null) { setShowForm(false); return; }
                  setEditing(null); setDraft(makeDraft()); setError(''); setShowForm(true);
                },
              }, showForm && editing === null ? '取消新增' : '新增事项'))),

          stats ? React.createElement('div', { className: 'rm-cards' }, ENVS.map(envCard)) : null,

          showForm ? React.createElement('form', { className: 'rm-form', onSubmit: submit },
            React.createElement('h2', { className: 'rm-form-title' },
              editing === null ? '新增事项' : '编辑事项'),
            React.createElement('div', { className: 'rm-grid' },
              React.createElement(Field, { label: '环境（可多选）', span: true },
                React.createElement('div', { className: 'rm-envpick' },
                  ENVS.map((v) => {
                    const on = draft.envs.includes(v);
                    return React.createElement('button', {
                      key: v, type: 'button',
                      className: 'rm-envbtn' + (on ? ' rm-envbtn-on' : ''),
                      'aria-pressed': on,
                      onClick: () => setDraft({ ...draft, envs: toggleInList(draft.envs, v) }),
                    }, React.createElement('span', { className: 'rm-target-box' }, on ? '✓' : ''),
                    ENV_LABELS[v]);
                  }))),
              React.createElement(Field, { label: '优先级' },
                React.createElement('select', {
                  className: 'rm-select', value: draft.priority,
                  onChange: (e) => setDraft({ ...draft, priority: e.target.value }),
                }, PRIORITIES.map((v) => React.createElement('option', { key: v, value: v }, v)))),
              React.createElement(Field, { label: '状态' },
                React.createElement('select', {
                  className: 'rm-select', value: draft.status,
                  onChange: (e) => setDraft({ ...draft, status: e.target.value }),
                }, STATUSES.map((v) => React.createElement('option', { key: v, value: v }, STATUS_LABELS[v])))),
              React.createElement(Field, { label: '负责人' },
                React.createElement('input', {
                  className: 'rm-input', value: draft.owner, placeholder: '如 张三',
                  onChange: (e) => setDraft({ ...draft, owner: e.target.value }),
                })),
              React.createElement(Field, { label: '时间节点', span: true },
                React.createElement('div', { className: 'rm-mspick' },
                  React.createElement('select', {
                    className: 'rm-select', value: draft.milestoneId ?? '',
                    'aria-label': '选择时间节点',
                    onChange: (e) => setDraft({
                      ...draft,
                      milestoneId: e.target.value === '' ? null : Number(e.target.value),
                    }),
                  },
                    React.createElement('option', { value: '' },
                      milestones.length ? '不指定时间节点' : '（还没有时间节点，请先在下方添加）'),
                    milestones.map((m) => React.createElement('option', {
                      key: m.id, value: String(m.id),
                    }, `${m.name}（${m.date}）`))),
                  React.createElement('button', {
                    type: 'button', className: 'rm-btn',
                    onClick: () => setShowMsAdd(true), title: '新建时间节点',
                  }, '＋ 新建节点'))),
              React.createElement(Field, { label: '标题', span: true },
                React.createElement('input', {
                  className: 'rm-input', value: draft.title, autoFocus: true,
                  placeholder: '要检查或完成的事项',
                  onChange: (e) => setDraft({ ...draft, title: e.target.value }),
                })),
              React.createElement(Field, { label: '备注', span: true },
                React.createElement('input', {
                  className: 'rm-input', value: draft.note, placeholder: '补充说明（可选）',
                  onChange: (e) => setDraft({ ...draft, note: e.target.value }),
                }))),
            React.createElement('div', { className: 'rm-form-actions' },
              React.createElement('button', {
                type: 'button', className: 'rm-btn',
                onClick: () => { setShowForm(false); setEditing(null); setError(''); },
              }, '取消'),
              React.createElement('button', { type: 'submit', className: 'rm-btn rm-btn-primary rm-btn-lg' },
                editing === null ? '添加' : '保存修改'))) : null,

          error ? React.createElement('p', { className: 'rm-error', role: 'alert' }, error) : null,

          /* 复制到其他环境 */
          copying ? React.createElement('div', { className: 'rm-form rm-copy' },
            React.createElement('h2', { className: 'rm-form-title' },
              `复制「${copying.item.title}」到其他环境`),
            React.createElement('p', { className: 'rm-copy-sub' },
              `原环境：${ENV_LABELS[copying.item.env]}　—　选择目标环境（可多选）`),
            React.createElement('div', { className: 'rm-targets' },
              ENVS.filter((e) => e !== copying.item.env).map((e) => {
                const on = copying.targets.includes(e);
                return React.createElement('button', {
                  key: e, type: 'button',
                  className: 'rm-target' + (on ? ' rm-target-on' : ''),
                  'aria-pressed': on,
                  onClick: () => toggleTarget(e),
                }, React.createElement('span', { className: 'rm-target-box' }, on ? '✓' : ''),
                ENV_LABELS[e]);
              })),
            React.createElement('label', { className: 'rm-check-row' },
              React.createElement('input', {
                type: 'checkbox', checked: copying.keepStatus,
                onChange: (e) => setCopying({ ...copying, keepStatus: e.target.checked }),
              }),
              '保留原状态（默认副本重置为「待办」）'),
            React.createElement('div', { className: 'rm-form-actions' },
              React.createElement('button', {
                type: 'button', className: 'rm-btn', onClick: () => { setCopying(null); setError(''); },
              }, '取消'),
              React.createElement('button', {
                type: 'button', className: 'rm-btn rm-btn-primary',
                onClick: confirmCopy, disabled: copying.targets.length === 0,
              }, copying.targets.length > 0
                ? `复制到 ${copying.targets.length} 个环境`
                : '请选择目标环境'))) : null,


          /* 筛选区：环境一行，状态一行，搜索框单独一行 */
          React.createElement('div', { className: 'rm-filters' },
            React.createElement('div', { className: 'rm-filter-row' },
              seg('环境', envOptions, env, (v) => { setEnv(v); setShowForm(false); setEditing(null); })),
            React.createElement('div', { className: 'rm-filter-row' },
              seg('状态', statusOptions, status, setStatus)),
            React.createElement('div', { className: 'rm-filter-row' },
              React.createElement('div', { className: 'rm-search' },
                React.createElement(SearchIcon, null),
                React.createElement('input', {
                  value: keyword, placeholder: '搜索标题 / 负责人 / 备注',
                  'aria-label': '关键词筛选',
                  onChange: (e) => setKeyword(e.target.value),
                })))),

          /* 节点筛选提示条 */
          msFilter !== null ? React.createElement('div', { className: 'rm-nodefilter' },
            React.createElement('span', { className: 'rm-nodefilter-label' }, '按时间节点筛选'),
            React.createElement('span', { className: 'rm-nodefilter-name' },
              msFilter === 'none'
                ? '未指定节点'
                : (milestones.find((m) => m.id === msFilter)?.name ?? `节点 #${msFilter}`)),
            React.createElement('button', {
              type: 'button', className: 'rm-btn rm-btn-sm',
              onClick: () => setMsFilter(null),
            }, '清除')) : null,

          listContent,
        ),

          /* ── 右侧：时间节点树 ── */
          msPanel,
        ),
      );
    }
    /* 侧边栏图标：画布很小，只画书签 + 勾 */
    function SidebarIcon(props) {
      return React.createElement(PanelIcon, { size: props.size || 20, active: props.active });
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposers = [];

        disposers.push(ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: 'release-memo' },
          PanelPage,
        )));

        disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: 'release-memo', order: 15, label: '上线备忘录' },
          SidebarIcon,
        )));

        return () => {
          for (const dispose of disposers) {
            try { dispose(); } catch { /* 已释放 */ }
          }
        };
      },
    };
  },
});

import { addIcon, createEl, setIcon } from "obsidian";

/** 线性图标集（内联 SVG，stroke=currentColor），统一替代表情图标。 */
export const ICON_PATHS = {
  chart:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="20" x2="5" y2="12"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="19" y1="20" x2="19" y2="14"/></svg>',
  refresh:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  alert:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  clock:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  pause:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="9" y2="15"/><line x1="15" y1="9" x2="15" y2="15"/></svg>',
  pulse:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 12 7 12 10 5 14 19 17 12 21 12"/></svg>',
  fire:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
} as const;

// 注册为 Obsidian 自定义图标（统一加 bw- 前缀，避免与内置图标冲突）。
// 包 try/catch：极少数 Obsidian 版本对 SVG 校验较严，注册失败绝不能影响插件加载或侧栏渲染。
try {
  for (const [key, svg] of Object.entries(ICON_PATHS) as Array<[string, string]>) {
    addIcon(`bw-${key}`, svg);
  }
} catch {
  // 图标注册失败：svgIcon 会回退为无图标的空 span，不影响任何功能。
}

export type IconName = keyof typeof ICON_PATHS;

/** 内联 SVG 线性图标（stroke=currentColor，随文字色变化）。零表情图标。 */
export function svgIcon(name: IconName, cls?: string): HTMLElement {
  // 主路径用 Obsidian 的 createEl（符合 prefer-create-el 规则）；
  // 兜底 document.createElement 仅用于个别未导出顶层 createEl 的运行环境（避免白屏）。
  let span: HTMLElement;
  try {
    span = createEl("span");
  } catch {
    // eslint-disable-next-line -- 兜底：部分运行环境未导出顶层 createEl/createSpan，回退原生创建避免白屏
    span = document.createElement("span");
  }
  span.className = "bw-icon" + (cls ? " " + cls : "");
  try {
    setIcon(span, `bw-${name}`);
  } catch {
    // setIcon 失败（图标未注册等）时保留空 span，绝不抛出。
  }
  return span;
}

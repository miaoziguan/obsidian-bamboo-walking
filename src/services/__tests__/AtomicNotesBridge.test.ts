import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import {
  getAtomicNotesApi,
  buildExtractionText,
  findRelatedNotes,
  ATOMIC_NOTES_PLUGIN_ID,
} from "../AtomicNotesBridge";

/** 构造一个带 plugins.getPlugin 的最小 App 桩 */
function makeApp(getPlugin?: (id: string) => unknown): App {
  return { plugins: getPlugin ? { getPlugin } : undefined } as unknown as App;
}

describe("buildExtractionText", () => {
  it("标题作为 H1 前缀 + 正文，用空行分隔", () => {
    const text = buildExtractionText({
      title: "反流量更反自我规训",
      content: "正文第一段。\n\n正文第二段。",
    });
    expect(text).toBe("# 反流量更反自我规训\n\n正文第一段。\n\n正文第二段。");
  });

  it("空标题时只保留正文", () => {
    expect(buildExtractionText({ title: "  ", content: "只有正文" })).toBe(
      "只有正文",
    );
  });

  it("空正文时只保留标题", () => {
    expect(buildExtractionText({ title: "标题", content: "   " })).toBe(
      "# 标题",
    );
  });

  it("首尾空白被裁剪", () => {
    expect(
      buildExtractionText({ title: "  T  ", content: "  body  " }),
    ).toBe("# T\n\nbody");
  });
});

describe("getAtomicNotesApi", () => {
  it("插件存在且有 extractFromText 时返回 API", () => {
    const fn = async () => {};
    const api = getAtomicNotesApi(
      makeApp((id) =>
        id === ATOMIC_NOTES_PLUGIN_ID ? { extractFromText: fn } : null,
      ),
    );
    expect(api).not.toBeNull();
    expect(typeof api?.extractFromText).toBe("function");
  });

  it("未安装插件（getPlugin 返回 null）时返回 null", () => {
    expect(getAtomicNotesApi(makeApp(() => null))).toBeNull();
  });

  it("插件存在但缺少 extractFromText（版本过旧）时返回 null", () => {
    expect(
      getAtomicNotesApi(makeApp(() => ({ someOtherMethod: () => {} }))),
    ).toBeNull();
  });

  it("宿主无 plugins 对象时返回 null，不抛异常", () => {
    expect(getAtomicNotesApi(makeApp(undefined))).toBeNull();
  });
});

describe("findRelatedNotes", () => {
  it("飞刃存在且有 findRelatedNotes 时转发查询并返回结果", async () => {
    const notes = [
      { path: "原子笔记/a.md", title: "A", score: 0.3 },
      { path: "原子笔记/b.md", title: "B", score: 0.2 },
    ];
    const fn = async () => notes;
    const result = await findRelatedNotes(
      makeApp((id) =>
        id === ATOMIC_NOTES_PLUGIN_ID
          ? { extractFromText: async () => {}, findRelatedNotes: fn }
          : null,
      ),
      "查询文本",
    );
    expect(result).toEqual(notes);
  });

  it("飞刃存在但无 findRelatedNotes（旧版）时返回 null", async () => {
    const result = await findRelatedNotes(
      makeApp((id) =>
        id === ATOMIC_NOTES_PLUGIN_ID
          ? { extractFromText: async () => {} }
          : null,
      ),
      "查询文本",
    );
    expect(result).toBeNull();
  });

  it("未安装飞刃时返回 null，不抛异常", async () => {
    const result = await findRelatedNotes(makeApp(() => null), "查询文本");
    expect(result).toBeNull();
  });

  it("将 opts 透传给飞刃", async () => {
    const captured: { opts?: unknown } = {};
    const fn = async (_q: string, opts?: unknown) => {
      captured.opts = opts;
      return [];
    };
    await findRelatedNotes(
      makeApp((id) =>
        id === ATOMIC_NOTES_PLUGIN_ID
          ? { extractFromText: async () => {}, findRelatedNotes: fn }
          : null,
      ),
      "查询",
      { topK: 3 },
    );
    expect(captured.opts).toEqual({ topK: 3 });
  });
});

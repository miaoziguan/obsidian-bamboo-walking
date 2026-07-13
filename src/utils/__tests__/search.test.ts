import { describe, it, expect } from "vitest";
import { matchArticle } from "../search";
import type { ArticleIndexEntry } from "../../types";

const entry: ArticleIndexEntry = {
  slug: "技术随想/x",
  title: "技术随想入门",
  date: "2026-07-04",
  category: "技术随想",
  summary: "关于 Obsidian 的笔记",
  tags: ["obsidian", "效率"],
};

describe("matchArticle", () => {
  it("轻量匹配：标题/摘要/分类/标签命中", () => {
    expect(matchArticle("obsidian", entry, { fullText: false })).toBe(true);
    expect(matchArticle("效率", entry, { fullText: false })).toBe(true);
    expect(matchArticle("技术随想", entry, { fullText: false })).toBe(true);
  });

  it("轻量不匹配且 fullText=false 时不查正文", () => {
    expect(matchArticle("正文关键词", entry, { fullText: false })).toBe(false);
  });

  it("fullText=true 时正文命中", () => {
    expect(
      matchArticle("正文关键词", entry, {
        fullText: true,
        getContent: () => "这是正文关键词内容",
      }),
    ).toBe(true);
  });

  it("空查询视为全部命中", () => {
    expect(matchArticle("   ", entry, { fullText: false })).toBe(true);
  });

  it("大小写不敏感", () => {
    expect(matchArticle("OBSIDIAN", entry, { fullText: false })).toBe(true);
  });

  it("getContent 缺失时 fullText 不抛错，仅轻量结果", () => {
    expect(matchArticle("正文关键词", entry, { fullText: true })).toBe(false);
  });
});

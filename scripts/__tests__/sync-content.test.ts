import { describe, it, expect } from "vitest";
import { syncContent } from "../sync-content";
import fs from "fs";
import os from "os";
import path from "path";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
}

function makeSrc(articlesDir: string) {
  fs.mkdirSync(articlesDir, { recursive: true });
  fs.writeFileSync(
    path.join(articlesDir, "index.json"),
    JSON.stringify([
      {
        slug: "c/x",
        title: "t",
        date: "2026-01-01",
        category: "c",
        summary: "s",
        hash: "a".repeat(64),
      },
    ]),
  );
  const fp = path.join(articlesDir, "c", "x.md");
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, "# x");
}

describe("syncContent", () => {
  it("复制源 articles 到目标并保持一致", () => {
    const src = tmp();
    const dest = tmp();
    makeSrc(path.join(src, "articles"));
    expect(() => syncContent(src, path.join(dest, "articles"), { strict: true })).not.toThrow();
    expect(fs.existsSync(path.join(dest, "articles", "index.json"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "articles", "c", "x.md"))).toBe(true);
  });

  it("目标 index.json 缺失则 strict 抛错", () => {
    const src = tmp();
    const dest = tmp();
    // 源没有 index.json（异常源）
    fs.mkdirSync(path.join(src, "articles"), { recursive: true });
    fs.writeFileSync(path.join(src, "articles", "x.md"), "# x");
    expect(() => syncContent(src, path.join(dest, "articles"), { strict: true })).toThrow();
  });

  it("源缺失则抛出", () => {
    const src = tmp();
    const dest = tmp();
    expect(() => syncContent(src, path.join(dest, "articles"), { strict: true })).toThrow();
  });
});

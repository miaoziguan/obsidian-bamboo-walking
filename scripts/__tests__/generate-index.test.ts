import { describe, it, expect } from "vitest";
import { runGenerate } from "../../../bamboo-column/scripts/generate-index";
import fs from "fs";
import os from "os";
import path from "path";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genidx-"));
}

function writeMd(articlesDir: string, slug: string, body: string) {
  const fp = path.join(articlesDir, slug + ".md");
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, body);
}

describe("generate-index 健壮性", () => {
  it("缺必需字段的文章被计入 invalid 且 strict 模式抛错", () => {
    const dir = tmpDir();
    const articles = path.join(dir, "articles");
    fs.mkdirSync(articles, { recursive: true });
    fs.writeFileSync(
      path.join(articles, "index.json"),
      JSON.stringify([
        { slug: "c/ok", title: "OK", date: "2026-01-01", category: "c", summary: "s" },
        { slug: "c/bad", title: "", date: "2026-01-01", category: "c", summary: "s" }, // 缺 title
      ]),
    );
    writeMd(articles, "c/ok", "# OK\n正文");
    writeMd(articles, "c/bad", "# \n正文");
    expect(() => runGenerate(dir, { strict: true })).toThrow();
  });

  it("目录 .md 与 index.json 不一致时 strict 抛错", () => {
    const dir = tmpDir();
    const articles = path.join(dir, "articles");
    fs.mkdirSync(articles, { recursive: true });
    fs.writeFileSync(
      path.join(articles, "index.json"),
      JSON.stringify([
        { slug: "c/ok", title: "OK", date: "2026-01-01", category: "c", summary: "s" },
      ]),
    );
    writeMd(articles, "c/ok", "# OK");
    writeMd(articles, "orphan", "# 孤儿文件无 index 条目");
    expect(() => runGenerate(dir, { strict: true })).toThrow();
  });

  it("正常情况生成 64 位 hash 且不抛错", () => {
    const dir = tmpDir();
    const articles = path.join(dir, "articles");
    fs.mkdirSync(articles, { recursive: true });
    fs.writeFileSync(
      path.join(articles, "index.json"),
      JSON.stringify([
        { slug: "c/ok", title: "OK", date: "2026-01-01", category: "c", summary: "s" },
      ]),
    );
    writeMd(articles, "c/ok", "# OK\n正文内容");
    expect(() => runGenerate(dir, { strict: true })).not.toThrow();
    const idx = JSON.parse(fs.readFileSync(path.join(articles, "index.json"), "utf8"));
    expect(idx[0].hash).toHaveLength(64);
  });
});

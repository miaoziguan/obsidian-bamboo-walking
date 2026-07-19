import { describe, it, expect } from "vitest";
import { CacheService } from "../CacheService";
import { CACHE_KEY, CACHE_VERSION } from "../../constants";

function makeService(initial: Record<string, unknown> | null) {
  let store: Record<string, unknown> | null = initial;
  return new CacheService(
    async () => store,
    async (d) => {
      store = d;
    },
  );
}

const oldEntry = {
  slug: "技术随想/x",
  title: "旧",
  date: "2020-01-01",
  category: "技术随想",
  summary: "s",
} as any;

describe("CacheService 版本兼容", () => {
  it("旧版本缓存读时重建 index，但保留 readSlugs", async () => {
    const old: any = {
      [CACHE_KEY]: {
        version: 0,
        index: [oldEntry],
        articles: {},
        lastFetch: 1,
        lastSeenSlugs: ["技术随想/x"],
        readSlugs: ["a", "b"],
      },
    };
    const svc = makeService(old);
    await svc.load();
    expect(svc.getIndex()).toEqual([]); // 重建
    expect(svc.isRead("a")).toBe(true); // 保留
    expect(svc.isRead("b")).toBe(true);
  });

  it("version 不匹配时丢弃 index，save 落盘写入当前版本号", async () => {
    const old: any = {
      [CACHE_KEY]: {
        version: 0,
        index: [oldEntry],
        articles: {},
        lastFetch: 1,
        lastSeenSlugs: ["技术随想/x"],
        readSlugs: ["keep"],
      },
    };
    const svc = makeService(old);
    await svc.load();
    await svc.save();
    const disk = (svc as any)["data"];
    expect(disk.version).toBe(CACHE_VERSION);
  });

  it("当前版本缓存正常读取，readSlugs 持久化", async () => {
    const cur: any = {
      [CACHE_KEY]: {
        version: CACHE_VERSION,
        index: [oldEntry],
        articles: {},
        lastFetch: 1,
        lastSeenSlugs: ["技术随想/x"],
        readSlugs: ["z"],
      },
    };
    const svc = makeService(cur);
    await svc.load();
    expect(svc.getIndex()).toHaveLength(1); // 不重建
    expect(svc.isRead("z")).toBe(true);
    await svc.markRead("new");
    await svc.save();
    const disk = (svc as any)["data"];
    expect(disk.readSlugs).toContain("new");
  });
});

describe("CacheService 字数统计", () => {
  it("setArticle 预计算 wordCount，getWordCount / getTotalWordCount 命中", async () => {
    const svc = makeService(null);
    await svc.load();
    await svc.setArticle(
      "技术随想/a",
      { ...oldEntry, content: "这是一篇中文测试文章" } as any,
      "h1",
    );
    expect(svc.getWordCount("技术随想/a")).toBe(10); // 这/是/一/篇/中/文/测/试/文/章
    expect(svc.getTotalWordCount()).toBe(10);
  });

  it("旧缓存缺 wordCount 时 getWordCount 懒补算并回写内存", async () => {
    const article = { ...oldEntry, content: "你好世界" } as any;
    const old: any = {
      [CACHE_KEY]: {
        version: CACHE_VERSION,
        index: [oldEntry],
        articles: { "技术随想/a": { article, fetchedAt: 1, hash: "h" } },
        lastFetch: 1,
        lastSeenSlugs: ["技术随想/x"],
        readSlugs: [],
      },
    };
    const svc = makeService(old);
    await svc.load();

    // 懒补算前：getTotalWordCount 仅累加已知项，应为 0
    expect(svc.getTotalWordCount()).toBe(0);
    // 首次查询触发懒补算
    expect(svc.getWordCount("技术随想/a")).toBe(4); // 你/好/世/界
    // 补算结果回写内存，下次直接命中
    expect((svc as any)["data"].articles["技术随想/a"].wordCount).toBe(4);
    expect(svc.getTotalWordCount()).toBe(4);
  });

  it("未缓存文章 getWordCount 返回 undefined", async () => {
    const svc = makeService(null);
    await svc.load();
    expect(svc.getWordCount("技术随想/不存在")).toBeUndefined();
  });
});

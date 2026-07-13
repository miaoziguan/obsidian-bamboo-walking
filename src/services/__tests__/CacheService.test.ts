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

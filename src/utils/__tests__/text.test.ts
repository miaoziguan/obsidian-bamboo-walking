import { describe, it, expect } from "vitest";
import { countWords, formatWordCount, estimateReadingTime } from "../text";

describe("countWords", () => {
  it("纯中文按字计", () => {
    expect(countWords("春江水暖鸭先知")).toBe(7);
  });

  it("中文含标点按字计", () => {
    expect(countWords("你好，世界！")).toBe(6); // 你/好/，/世/界/！
  });

  it("英文按词计，与中文相加", () => {
    expect(countWords("Hello world 你好")).toBe(4); // 2 英文词 + 2 中文
  });

  it("剥离 frontmatter / 代码块 / markdown 符号", () => {
    const md = [
      "---",
      "title: 测试",
      "---",
      "# 标题",
      "",
      "这是 **加粗** 文本 `code` 和 ```js",
      "const x = 1;",
      "```",
      "",
    ].join("\n");
    // 中文：标题(2) 这是(2) 加粗(2) 文本(2) 和(1) = 9；代码块/行内码均被剥除
    expect(countWords(md)).toBe(9);
  });

  it("链接保留文本，图片不计入", () => {
    const md = "看 [说明](http://x.com) 和 ![](img.png) 结束";
    // 中文：看/说/明/和/结/束 = 6；url 与图片均不计入
    expect(countWords(md)).toBe(6);
  });

  it("空字符串返回 0", () => {
    expect(countWords("")).toBe(0);
  });
});

describe("formatWordCount", () => {
  it("小于一万显示「X 字」", () => {
    expect(formatWordCount(2400)).toBe("2400 字");
  });
  it("过万显示「X.X 万字」", () => {
    expect(formatWordCount(12345)).toBe("1.2 万字");
  });
});

describe("estimateReadingTime", () => {
  it("至少 1 分钟", () => {
    expect(estimateReadingTime(0)).toBe(1);
  });
  it("350 字约 1 分钟", () => {
    expect(estimateReadingTime(350)).toBe(1);
  });
  it("700 字约 2 分钟", () => {
    expect(estimateReadingTime(700)).toBe(2);
  });
});

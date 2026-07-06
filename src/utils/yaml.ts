/* ────────────── YAML 工具 ────────────── */

/**
 * 简易 YAML frontmatter 解析器。
 * 仅处理个人专栏内容仓库的已知格式，不兼容嵌套对象/块标量/注释。
 * （纯个人内容源，不需要完整的 YAML 解析库。）
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const yamlStr = match[1];
  const body = match[2];
  const fm: Record<string, unknown> = {};

  for (const line of yamlStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();
    if ((value as string).startsWith("[") && (value as string).endsWith("]")) {
      const inner = (value as string).slice(1, -1).trim();
      if (!inner) {
        value = [];
      } else {
        value = inner
          .split(",")
          .map((s: string) =>
            s.trim().replace(/^["']|["']$/g, "").replace(/\\(.)/g, "$1"),
          );
      }
    } else {
      value = (value as string)
        .replace(/^["']|["']$/g, "")
        .replace(/\\(.)/g, "$1");
      if (/^\d+(\.\d+)?$/.test(value as string)) value = parseFloat(value as string);
    }
    fm[key] = value;
  }

  return { frontmatter: fm, body };
}

/**
 * 转义 YAML 字符串值中的危险字符。
 * 防止文章标题等字段中的引号/换行破坏 frontmatter 结构。
 */
export function yamlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

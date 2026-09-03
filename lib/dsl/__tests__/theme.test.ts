import { describe, expect, it } from "vitest";
import { normalizeStage } from "@/lib/dsl/normalize";
import { DEFAULT_THEME_ID, THEMES, isThemeId, mapElementColor, resolveTheme } from "@/lib/dsl/theme";

describe("theme token", () => {
  it("normalizeStage：老数据无 theme → 兜底默认主题", () => {
    const stage = normalizeStage({ title: "t", scenes: [] });
    expect(stage.theme).toBe(DEFAULT_THEME_ID);
  });

  it("normalizeStage：非法 theme → 兜底；合法 theme 保留", () => {
    expect(normalizeStage({ title: "t", scenes: [], theme: "nope" }).theme).toBe(DEFAULT_THEME_ID);
    expect(normalizeStage({ title: "t", scenes: [], theme: "midnight" }).theme).toBe("midnight");
  });

  it("isThemeId 只认内置主题", () => {
    expect(isThemeId("mint")).toBe(true);
    expect(isThemeId("hacker")).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });

  it("resolveTheme 未知 id 回退默认", () => {
    expect(resolveTheme("nope").id).toBe(DEFAULT_THEME_ID);
    expect(THEMES.length).toBeGreaterThanOrEqual(3);
  });

  it("mapElementColor：默认深色映射主题色，bold 用标题色；自定义色保留", () => {
    const tokens = resolveTheme("midnight").tokens;
    expect(mapElementColor("#1f2937", tokens)).toBe(tokens.text);
    expect(mapElementColor("#374151", tokens, true)).toBe(tokens.title);
    expect(mapElementColor("#B45309", tokens)).toBe("#B45309"); // 自定义色保留
    expect(mapElementColor("", tokens)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { extractJson, parseLooseJson } from "../json-repair";

describe("extractJson", () => {
  it("提取 markdown 围栏中的 JSON", () => {
    const raw = '好的，以下是结果：\n```json\n{"a":1}\n```\n希望有帮助';
    expect(extractJson(raw)).toBe('{"a":1}');
  });

  it("从噪声文本中截取平衡 JSON", () => {
    const raw = 'blah {"a":{"b":[1,2]}} trailing';
    expect(extractJson(raw)).toBe('{"a":{"b":[1,2]}}');
  });

  it("无 JSON 返回 null", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("parseLooseJson", () => {
  it("正常解析", () => {
    expect(parseLooseJson('{"x":1}')).toEqual({ x: 1 });
  });

  it("修复尾逗号", () => {
    expect(parseLooseJson('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it("修复未闭合括号", () => {
    expect(parseLooseJson('{"a":{"b":[1,2')).toEqual({ a: { b: [1, 2] } });
  });

  it("修复未闭合字符串", () => {
    expect(parseLooseJson('{"a":"he')).toEqual({ a: "he" });
  });

  it("完全非法返回 null", () => {
    expect(parseLooseJson("this is not json {")).toBeNull();
  });
});

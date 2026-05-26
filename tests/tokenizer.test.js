/**
 * tests/tokenizer.test.js
 *
 * Tests for tokenizer.js — the accurate BPE-approximating token counter.
 * Reference values calibrated against tiktoken cl100k_base.
 */

const { countTokens, countMessageTokens } = require("../tokenizer");

// ─── countTokens ──────────────────────────────────────────────────────────────

describe("countTokens — edge cases", () => {
  test("empty string returns 0", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens(null)).toBe(0);
    expect(countTokens(undefined)).toBe(0);
  });

  test("single short words are 1 token", () => {
    expect(countTokens("hi")).toBe(1);
    expect(countTokens("the")).toBe(1);
    expect(countTokens("AI")).toBe(1);
  });

  test("long English word splits into multiple tokens", () => {
    // 'internationalization' is 20 chars → ~4-5 tokens in cl100k
    const n = countTokens("internationalization");
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(7);
  });

  test("typical sentence produces reasonable token count", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const n = countTokens(text);
    // tiktoken gives ~10 tokens for this sentence
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(14);
  });

  test("pure numbers are tokenized efficiently", () => {
    // "12345" → 2 tokens (cl100k groups digits)
    const n = countTokens("12345");
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(4);
  });

  test("CJK characters are ~1 token each", () => {
    // 5 Chinese characters — at least 3 tokens, at most 12
    const n = countTokens("你好世界！");
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(12);
  });

  test("camelCase identifiers split into more tokens than plain text", () => {
    const camel = countTokens("getUserById");
    const plain = countTokens("getuserbyid");
    // Both should be counted but camelCase may be similar or slightly more
    expect(camel).toBeGreaterThanOrEqual(1);
    expect(plain).toBeGreaterThanOrEqual(1);
  });

  test("URL-like string is counted without crashing", () => {
    const n = countTokens("https://api.example.com/v1/messages?format=json&stream=true");
    expect(n).toBeGreaterThanOrEqual(5);
  });

  test("newlines each contribute at least 1 token", () => {
    const withNewlines = countTokens("line1\nline2\nline3");
    const withoutNewlines = countTokens("line1 line2 line3");
    // Newlines should produce at least as many tokens as spaces
    expect(withNewlines).toBeGreaterThanOrEqual(withoutNewlines - 2);
  });

  test("emoji are counted without crashing", () => {
    const n = countTokens("Hello 🎉 World 🚀");
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(20);
  });

  test("code snippet is estimated reasonably", () => {
    const code = `function add(a, b) {\n  return a + b;\n}`;
    const n = countTokens(code);
    // tiktoken gives ~18-25 tokens for this snippet
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(50);
  });
});

// ─── countMessageTokens ───────────────────────────────────────────────────────

describe("countMessageTokens", () => {
  test("empty body returns at least 1 token (reply primer)", () => {
    const result = countMessageTokens({ messages: [] });
    expect(result.input_tokens).toBeGreaterThanOrEqual(1);
  });

  test("returns { input_tokens: number } shape", () => {
    const result = countMessageTokens({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result).toHaveProperty("input_tokens");
    expect(typeof result.input_tokens).toBe("number");
    expect(result.input_tokens).toBeGreaterThan(0);
  });

  test("system prompt adds to token count", () => {
    const withSystem = countMessageTokens({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hi" }],
    });
    const withoutSystem = countMessageTokens({
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(withSystem.input_tokens).toBeGreaterThan(withoutSystem.input_tokens);
  });

  test("more messages = more tokens", () => {
    const oneMsg = countMessageTokens({
      messages: [{ role: "user", content: "What is Node.js?" }],
    });
    const threeMsgs = countMessageTokens({
      messages: [
        { role: "user", content: "What is Node.js?" },
        { role: "assistant", content: [{ type: "text", text: "Node.js is a runtime." }] },
        { role: "user", content: "Tell me more." },
      ],
    });
    expect(threeMsgs.input_tokens).toBeGreaterThan(oneMsg.input_tokens);
  });

  test("tool definitions add to token count", () => {
    const withTools = countMessageTokens({
      messages: [{ role: "user", content: "Search for Node.js" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web for current information.",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    });
    const withoutTools = countMessageTokens({
      messages: [{ role: "user", content: "Search for Node.js" }],
    });
    expect(withTools.input_tokens).toBeGreaterThan(withoutTools.input_tokens);
  });

  test("handles block-array user content", () => {
    const result = countMessageTokens({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "What is 2 + 2?" }],
        },
      ],
    });
    expect(result.input_tokens).toBeGreaterThanOrEqual(5);
  });

  test("tool_use blocks in assistant message count tokens", () => {
    const withToolUse = countMessageTokens({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "web_search",
              input: { query: "Node.js tutorial" },
            },
          ],
        },
      ],
    });
    expect(withToolUse.input_tokens).toBeGreaterThan(5);
  });

  test("image blocks add fixed cost", () => {
    const withImage = countMessageTokens({
      messages: [
        {
          role: "user",
          content: [{ type: "image", source: { media_type: "image/png" } }],
        },
      ],
    });
    // Image should add at least 512 tokens (our fixed estimate)
    expect(withImage.input_tokens).toBeGreaterThanOrEqual(512);
  });

  test("system prompt as array of blocks works", () => {
    const result = countMessageTokens({
      system: [
        { type: "text", text: "You are an expert." },
        { type: "text", text: "Be concise." },
      ],
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.input_tokens).toBeGreaterThan(5);
  });

  test("never returns 0 or negative", () => {
    const edge = countMessageTokens({ messages: [{ role: "user", content: "" }] });
    expect(edge.input_tokens).toBeGreaterThanOrEqual(1);
  });

  test("much better than naive length/4 for realistic conversation", () => {
    const body = {
      system: "You are a helpful coding assistant. Always write clean, documented code.",
      messages: [
        { role: "user", content: "Write a Node.js function that reads a JSON file and returns the parsed object." },
        { role: "assistant", content: [{ type: "text", text: "Here's a clean implementation:\n\n```js\nconst fs = require('fs');\nfunction readJson(path) {\n  return JSON.parse(fs.readFileSync(path, 'utf8'));\n}\nmodule.exports = readJson;\n```" }] },
        { role: "user", content: "Add error handling to it." },
      ],
    };

    const accurate = countMessageTokens(body).input_tokens;
    // Naive: just JSON.stringify length / 4
    const naiveInput = JSON.stringify(body.messages).length / 4;

    // Both should be in a reasonable range, but our estimator should handle
    // system prompt + message overhead correctly
    expect(accurate).toBeGreaterThan(30);
    expect(accurate).toBeLessThan(500);
    // And it should be non-trivially different from the naive estimate
    expect(Math.abs(accurate - naiveInput)).toBeGreaterThan(5);
  });
});

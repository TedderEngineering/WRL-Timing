import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/env.js", () => ({ env: { NODE_ENV: "production" } }));
const { errorHandler } = await import("../error-handler.js");

function run(err: Error) {
  const res = { statusCode: 0, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  errorHandler(err, {} as never, res as never, () => {});
  return res;
}

describe("error handler", () => {
  it("reports a request body that is too large as 413, not an internal error", () => {
    const res = run(Object.assign(new Error("request entity too large"), { status: 413, type: "entity.too.large" }));
    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("keeps unknown errors as a 500 without details in production", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = run(new Error("secret detail"));
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error", code: "INTERNAL_ERROR" });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { executeTool } from "../registry.js";
import { callService } from "../../integrations/homeAssistant/client.js";

vi.mock("../../integrations/homeAssistant/client.js", () => ({
  getState: vi.fn(),
  callService: vi.fn(),
}));

vi.mock("../../integrations/homeAssistant/registry.js", async importOriginal => ({
  ...(await importOriginal<object>()),
  getLights: () => [{ entity_id: "light.ceiling" }],
  resolveArea: (area: string) => ({ area_id: area, name: area }),
}));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

describe("control_home_assistant", () => {
  beforeEach(() => vi.mocked(callService).mockClear());

  it("reports malformed arguments as a tool failure the model can read", async () => {
    const result = await executeTool("control_home_assistant", { action: "light.turn_on" }, log, "test");

    expect(result).toMatch(/^control_home_assistant failed: control_home_assistant tool arguments failed validation/);
    expect(callService).not.toHaveBeenCalled();
  });

  it("accepts a number the model sent as a string", async () => {
    await executeTool("control_home_assistant", { action: "light_dim", area: "kitchen", brightness_pct: "30" }, log, "test");

    expect(callService).toHaveBeenCalledWith("light", "turn_on", { area_id: "kitchen", brightness_pct: 30 });
  });
});

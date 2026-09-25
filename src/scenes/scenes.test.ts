import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyScene, type ScenePlan } from "./scenes.js";
import { callService } from "../integrations/homeAssistant/client.js";
import { getLights, getNumberEntities } from "../integrations/homeAssistant/registry.js";

vi.mock("../integrations/homeAssistant/client.js", () => ({ callService: vi.fn() }));
vi.mock("../integrations/homeAssistant/registry.js", () => ({ getLights: vi.fn(), getNumberEntities: vi.fn() }));

const mockedCallService = vi.mocked(callService);
const mockedGetLights = vi.mocked(getLights);
const mockedGetNumberEntities = vi.mocked(getNumberEntities);

const KNOWN_LIGHTS = [
  { entity_id: "light.a", name: "A" },
  { entity_id: "light.b", name: "B" },
];

beforeEach(() => {
  mockedCallService.mockReset().mockResolvedValue(undefined as any);
  mockedGetLights.mockReturnValue(KNOWN_LIGHTS as any);
  mockedGetNumberEntities.mockReturnValue([]);
});

const twoActiveLightsPlan: ScenePlan = {
  name: "Test Scene",
  description: "desc",
  lights: [
    { kind: "light", entity_id: "light.a", brightness: 150 },
    { kind: "light", entity_id: "light.b", brightness: 200 },
  ],
};

describe("applyScene", () => {
  it("makes zero device calls when the plan is invalid - the actual bug this fixes", async () => {
    const badPlan = { name: "", description: "", lights: [] } as unknown as ScenePlan;
    await expect(applyScene(badPlan)).rejects.toThrow(/Invalid scene plan/);
    expect(mockedCallService).not.toHaveBeenCalled();
  });

  it("reports allSucceeded when every device call succeeds", async () => {
    const result = await applyScene(twoActiveLightsPlan);
    expect(result.allSucceeded).toBe(true);
    expect(result.anySucceeded).toBe(true);
    expect(result.outcomes).toEqual([
      { entity_id: "light.a", ok: true },
      { entity_id: "light.b", ok: true },
    ]);
  });

  it("reports total failure honestly instead of claiming success - the other half of the bug", async () => {
    mockedCallService.mockImplementation(async (domain: string, service: string) => {
      if (domain === "light" && service === "turn_off") return undefined; // the pre-scene turn-off step
      throw new Error("HA 500");
    });

    const result = await applyScene(twoActiveLightsPlan);
    expect(result.allSucceeded).toBe(false);
    expect(result.anySucceeded).toBe(false);
    expect(result.outcomes).toEqual([
      { entity_id: "light.a", ok: false, error: "HA 500" },
      { entity_id: "light.b", ok: false, error: "HA 500" },
    ]);
  });

  it("reports partial success when only some devices fail", async () => {
    mockedCallService.mockImplementation(async (domain: string, service: string, data: any) => {
      if (domain === "light" && service === "turn_off") return undefined;
      if (data.entity_id === "light.a") throw new Error("HA 500");
      return undefined;
    });

    const result = await applyScene(twoActiveLightsPlan);
    expect(result.allSucceeded).toBe(false);
    expect(result.anySucceeded).toBe(true);
    expect(result.outcomes.find(o => o.entity_id === "light.a")).toEqual({ entity_id: "light.a", ok: false, error: "HA 500" });
    expect(result.outcomes.find(o => o.entity_id === "light.b")).toEqual({ entity_id: "light.b", ok: true });
  });

  it("turns off every known light before applying the plan", async () => {
    await applyScene(twoActiveLightsPlan);
    expect(mockedCallService).toHaveBeenCalledWith("light", "turn_off", { entity_id: "light.a" });
    expect(mockedCallService).toHaveBeenCalledWith("light", "turn_off", { entity_id: "light.b" });
  });

  it("treats a state: off entry as already satisfied by the turn-off step, with no extra call", async () => {
    const plan: ScenePlan = { name: "x", description: "y", lights: [{ kind: "light", entity_id: "light.a", state: "off" }] };
    const result = await applyScene(plan);
    expect(result.outcomes).toContainEqual({ entity_id: "light.a", ok: true });
    expect(mockedCallService).not.toHaveBeenCalledWith("light", "turn_on", expect.anything());
  });

  it("reports an off entry as failed when the underlying turn-off actually failed, instead of assuming success", async () => {
    mockedCallService.mockImplementation(async (domain: string, service: string, data: any) => {
      if (domain === "light" && service === "turn_off" && data.entity_id === "light.a") throw new Error("HA 500");
      return undefined;
    });

    const plan: ScenePlan = { name: "x", description: "y", lights: [{ kind: "light", entity_id: "light.a", state: "off" }] };
    const result = await applyScene(plan);
    expect(result.outcomes).toContainEqual({ entity_id: "light.a", ok: false, error: "HA 500" });
    expect(result.allSucceeded).toBe(false);
  });

  it("includes a failed shutdown of a light the plan never mentions in the final result", async () => {
    // light.b isn't part of the plan at all, but it's still part of the
    // intended final scene - "off" - so its failed shutdown must count.
    mockedCallService.mockImplementation(async (domain: string, service: string, data: any) => {
      if (domain === "light" && service === "turn_off" && data.entity_id === "light.b") throw new Error("HA 500");
      return undefined;
    });

    const plan: ScenePlan = { name: "x", description: "y", lights: [{ kind: "light", entity_id: "light.a", brightness: 150 }] };
    const result = await applyScene(plan);
    expect(result.outcomes).toContainEqual({ entity_id: "light.b", ok: false, error: "HA 500" });
    expect(result.allSucceeded).toBe(false);
  });

  it("applies a number entity via number.set_value when it's known to exist", async () => {
    mockedGetNumberEntities.mockReturnValue([{ entity_id: "number.wiz_lamp_1_effect_speed", name: "Effect speed" }] as any);

    const plan: ScenePlan = {
      name: "x",
      description: "y",
      lights: [{ kind: "number", entity_id: "number.wiz_lamp_1_effect_speed", value: 60 }],
    };
    const result = await applyScene(plan);

    expect(mockedCallService).toHaveBeenCalledWith("number", "set_value", { entity_id: "number.wiz_lamp_1_effect_speed", value: 60 });
    expect(result.outcomes).toContainEqual({ entity_id: "number.wiz_lamp_1_effect_speed", ok: true });
    expect(result.allSucceeded).toBe(true);
  });
});

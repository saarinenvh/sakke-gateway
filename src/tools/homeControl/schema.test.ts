import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import {
  controlHomeAssistantArgsExample,
  controlHomeAssistantArgsSchema,
  getDeviceStateArgsExample,
  getDeviceStateArgsSchema,
  refreshHomeDataArgsExample,
  refreshHomeDataArgsSchema,
  runRoutineArgsExample,
  runRoutineArgsSchema,
} from "./schema.js";

describe("home control schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(controlHomeAssistantArgsSchema, controlHomeAssistantArgsExample, "control_home_assistant args example");
    parseOrThrow(getDeviceStateArgsSchema, getDeviceStateArgsExample, "get_device_state args example");
    parseOrThrow(runRoutineArgsSchema, runRoutineArgsExample, "run_routine args example");
    parseOrThrow(refreshHomeDataArgsSchema, refreshHomeDataArgsExample, "refresh_home_data args example");
  });
});

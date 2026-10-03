import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import {
  openTvAppArgsExample,
  openTvAppArgsSchema,
  tvRemoteCommandArgsExample,
  tvRemoteCommandArgsSchema,
  tvSendTextArgsExample,
  tvSendTextArgsSchema,
} from "./schema.js";

describe("TV schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(openTvAppArgsSchema, openTvAppArgsExample, "open_tv_app args example")).not.toThrow();
    expect(() => parseOrThrow(tvRemoteCommandArgsSchema, tvRemoteCommandArgsExample, "tv_remote_command args example")).not.toThrow();
    expect(() => parseOrThrow(tvSendTextArgsSchema, tvSendTextArgsExample, "tv_send_text args example")).not.toThrow();
  });
});

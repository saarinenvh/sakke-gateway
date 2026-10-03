import { describe, it } from "vitest";
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
    parseOrThrow(openTvAppArgsSchema, openTvAppArgsExample, "open_tv_app args example");
    parseOrThrow(tvRemoteCommandArgsSchema, tvRemoteCommandArgsExample, "tv_remote_command args example");
    parseOrThrow(tvSendTextArgsSchema, tvSendTextArgsExample, "tv_send_text args example");
  });
});

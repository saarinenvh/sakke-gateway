import { describe, it, expect } from "vitest";
import { findPersonalPlaylist } from "./spotify.js";

// Personal and editorial playlists can't be found by search at all under the
// Client Credentials flow, so known ones are matched by name. The matching has
// to tolerate STT mishearings and the filler words the model adds, without
// grabbing unrelated requests.
const METAL = "spotify:playlist:6r8VigRsBUdBocm2aXxuGZ";
const DISCOVER = "spotify:playlist:37i9dQZEVXcRBTpgpeHTpf";

describe("findPersonalPlaylist", () => {
  it("matches an exact name", () => {
    expect(findPersonalPlaylist("metal")).toBe(METAL);
    expect(findPersonalPlaylist("discover weekly")).toBe(DISCOVER);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(findPersonalPlaylist("  Discover Weekly ")).toBe(DISCOVER);
  });

  it("strips the filler words the model tacks on", () => {
    expect(findPersonalPlaylist("metal playlist")).toBe(METAL);
    expect(findPersonalPlaylist("the metal playlist please")).toBe(METAL);
    expect(findPersonalPlaylist("discover weekly playlist")).toBe(DISCOVER);
  });

  it("tolerates an STT mishearing", () => {
    // "Discovery Weekly" is one edit away and is what Whisper actually produced.
    expect(findPersonalPlaylist("discovery weekly")).toBe(DISCOVER);
  });

  it("does not match an unrelated request", () => {
    expect(findPersonalPlaylist("jazz")).toBeNull();
    expect(findPersonalPlaylist("the beatles")).toBeNull();
    expect(findPersonalPlaylist("weekly standup recording")).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(findPersonalPlaylist("")).toBeNull();
    expect(findPersonalPlaylist("   ")).toBeNull();
  });

  // Characterisation, not endorsement. The edit-distance threshold is 1 for
  // names of 6 characters or fewer, so any single-edit neighbour of "metal"
  // matches it - "mental" among them. Narrow in practice (a bare one-word
  // request), but if the threshold is ever tightened this test should fail and
  // be re-read rather than quietly updated.
  it("matches single-edit neighbours of a short name, including ones you might not want", () => {
    expect(findPersonalPlaylist("metals")).toBe(METAL);
    expect(findPersonalPlaylist("mental")).toBe(METAL);
  });

  it("does not stretch to two edits on a short name", () => {
    expect(findPersonalPlaylist("mentally")).toBeNull();
  });
});

# Announcements

Speaks a message on the voice satellite (`assist_satellite.announce`). The
message is first reworded in Sakke's own voice by the agent with the
`announcement` profile; if that fails, comes back empty, or takes too long,
the message is spoken as it is. Failing to reach the satellite throws.

## Entry points

| Export | Called by |
| --- | --- |
| `announce(message, log)` | `tools/announce/announce.ts`, the `announce` tool that scheduled jobs run |
| `speakOnSatellite(text)` | `features/morning/liveDeps.ts`, for the already-worded morning brief |
| `setWordingWriter(writer)` | `index.ts`, with `writeAnnouncementWording`, at startup |

The wording writer is injected rather than imported because writing it needs
the agent, which imports every tool.

## Data

None. It keeps nothing between calls.

## Files

| File | Does |
| --- | --- |
| `announcer.ts` | `announce` and `speakOnSatellite`; shows Sakke speaking on the display while the satellite talks |
| `wording.ts` | `writeAnnouncementWording`: one throwaway agent turn with the `announcement` profile |

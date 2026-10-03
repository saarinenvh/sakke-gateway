# Spotify

Plays music through Home Assistant's Spotify media player. A named request is
searched on the Spotify Web API (`integrations/spotify/`) and answered with three numbered options; the
options are remembered per conversation, so a pick only needs its number. A
known personal playlist plays at once, matched by name with room for STT
mishearings, since search can't find it. When nothing is playing anywhere,
playback first wakes the living room TV and opens Spotify on it so there is a
Connect device to play on.

## Entry points

| Export | Called by |
| --- | --- |
| `spotifySuggest`, `spotifyPlayIndexed`, `spotifyPlayPersonal`, `spotifyPlay`, `spotifyPause`, `spotifyNext`, `spotifyPrevious`, `spotifyVolume` | `tools/spotify/spotify.ts` |
| `clearSpotifySuggestion` | `agent/conversationStore.ts`, when a conversation is dropped |

## Data

No database table. The last suggestion of each conversation is kept in memory
only.

## Files

| File | Does |
| --- | --- |
| `spotify.ts` | suggestions, picks, personal playlists, and playback through HA |
| `schema.ts` | the HA Spotify player's attributes |

export function spotifyPrompt(): string {
  return `Music: use the spotify tool. For any named request — a song, artist, album or playlist — call it with action "suggest" first and read back the options; voice input is too unreliable to commit to a blind top result. When the user picks one, call action "play" with only the index.`;
}

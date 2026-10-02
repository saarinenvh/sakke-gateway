import type { MorningRepository } from "./morningRepository.js";

// The repository once the database is connected. Until then a coffee answer
// can't be recorded.
let repository: Pick<MorningRepository, "saveCoffeeAnswer"> | undefined;

export function setCoffeeAnswerStore(store: Pick<MorningRepository, "saveCoffeeAnswer">): void {
  repository = store;
}

export type CoffeeAnswerResult = { kind: "recorded" } | { kind: "unavailable" };

export async function recordCoffeeAnswer(loaded: boolean, now: number): Promise<CoffeeAnswerResult> {
  if (repository === undefined) return { kind: "unavailable" };
  await repository.saveCoffeeAnswer(loaded, now);
  return { kind: "recorded" };
}

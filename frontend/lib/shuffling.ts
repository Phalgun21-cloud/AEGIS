/**
 * Question and Option Shuffling Module for AEGIS
 * Uses a deterministic pseudo-random number generator (Mulberry32) seeded by
 * the attempt ID / candidate ID.
 * This guarantees:
 * 1. Each candidate receives a unique randomized question order.
 * 2. The order is 100% stable across browser refresh and Next/Previous navigation.
 * 3. Question IDs, marks, and answer key relationships remain immutable.
 */

import type { PaperQuestion } from "./types";

/**
 * Creates a deterministic 32-bit pseudo-random number generator (Mulberry32)
 */
function createSeededPRNG(seed: number) {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Converts any string or number seed into a 32-bit integer.
 */
function hashSeed(seed: string | number): number {
  if (typeof seed === "number") return Math.floor(seed);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Deterministically shuffles an array in place using the Fisher-Yates algorithm.
 */
export function shuffleArray<T>(items: T[], seed: string | number): T[] {
  const prng = createSeededPRNG(hashSeed(seed));
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Shuffles questions for a candidate examination attempt.
 * Assigns display numbers (1, 2, 3...) sequentially while preserving original question IDs.
 */
export function shuffleQuestionsForAttempt(
  questions: PaperQuestion[],
  attemptId: number,
  options?: {
    enableQuestionShuffle?: boolean;
    enableOptionShuffle?: boolean;
  }
): PaperQuestion[] {
  const { enableQuestionShuffle = true, enableOptionShuffle = false } = options ?? {};

  let ordered = [...questions];

  if (enableQuestionShuffle && questions.length > 1) {
    ordered = shuffleArray(questions, `exam_attempt_q_${attemptId}`);
  }

  // Assign visible sequence numbers 1..N based on shuffled order
  return ordered.map((q, idx) => {
    let qOptions = q.options;

    // Optional option shuffling if question has options
    if (enableOptionShuffle && q.options && q.options.length > 1) {
      qOptions = shuffleArray(q.options, `exam_attempt_opt_${attemptId}_${q.question_id}`);
    }

    return {
      ...q,
      number: idx + 1,
      options: qOptions,
    };
  });
}


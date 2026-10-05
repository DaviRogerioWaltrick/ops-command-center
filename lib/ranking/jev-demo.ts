import { hashString } from "./probabilistic";
import type { AskJev } from "./jev";

/**
 * DEMO ONLY. A stand-in for Jev that makes no network call and costs nothing,
 * so the probabilistic UI can be built and reviewed before any TypeSafe key
 * is used. The distributions are invented by a simple heuristic over the item
 * state (how many people it releases, warning words in the latest note) plus
 * a stable hash for spread. They are NOT model output and say nothing about
 * what Jev would answer. Every screen that shows them is labelled as a demo
 * (RANKING_MODE=probabilistic-demo), and the cache namespace keeps these
 * answers apart from real ones.
 */
export const DEMO_NAMESPACE = "demo";
export const DEMO_LABEL = "simulated estimate (demo, not Jev)";

const WARNING_WORDS = /\b(block|blocked|waiting|delay|delayed|slip|slipped|stalled|stuck|escalat|overdue|no response|risk)/i;

function distribution(mode: number, spread: number): number[] {
  const raw = [0, 1, 2, 3, 4].map((level) => Math.exp(-Math.abs(level - mode) * spread));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((p) => p / total);
}

/** 1 minus the normalized entropy: 1 when all mass is on one level, 0 when it is uniform. */
function concentration(probabilities: number[]): number {
  const entropy = -probabilities.reduce((sum, p) => (p > 0 ? sum + p * Math.log(p) : sum), 0);
  return 1 - entropy / Math.log(probabilities.length);
}

export function createDemoAsk(): AskJev {
  return async (state) => {
    const seed = hashString(JSON.stringify(state));
    const released = Array.isArray(state.people_released) ? state.people_released.length : 0;
    const leverageMode = released === 0 ? 1 : Math.min(4, released + 1);
    const spread = 0.7 + (seed % 7) / 7; // 0.7 to 1.6: some items are clear-cut, some are not
    const warned = typeof state.latest_note === "string" && WARNING_WORDS.test(state.latest_note);
    const abandoned = Array.isArray(state.waiting_on_abandoned_work) && state.waiting_on_abandoned_work.length > 0;
    const slipMode = abandoned ? 3 : warned ? 3 : (seed >>> 3) % 2;
    const leverage = distribution(leverageMode, spread);
    const slipRisk = distribution(slipMode, 1.8 - (seed % 5) / 10);
    return {
      judgment: {
        leverage: { probabilities: leverage, confidence: concentration(leverage) },
        slipRisk: { probabilities: slipRisk, confidence: concentration(slipRisk) },
      },
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  };
}

/**
 * Live measurement of the dependency-inference call at different workspace sizes.
 * Spends real Anthropic tokens (separate from Jev), so it is NOT part of `npm test`.
 *
 * Run from the repo root (loads .env into the process without printing it):
 *   npx tsx --conditions react-server --env-file=.env evaluation/inference-scale.ts 15 150 400 150:long
 *
 * Each argument is an item count, optionally ":long" for notes about twice as long, or "inc:N" for the
 * incremental check (see runIncremental).
 * All items are invented. A known set of dependencies is planted in the text of the
 * blocked item (it names the blocker by a paraphrase, never by id), so the answer can be
 * scored: planted links found, found backwards, missed, and any other link reported
 * (the filler text never describes a link, so every other link counts as spurious).
 */
import { clearInferenceMemory, getInferenceMeter, inferDependencyEdges, resetInferenceMeter } from "../lib/dependencies";
import { seededRandom } from "../lib/ranking/probabilistic";
import type { WorkItem } from "../lib/types";

const CUSTOMERS = [
  "Harbor Dental", "Northwind Grill", "Cedar Ridge Realty", "Blue Heron Spa", "Atlas Roofing", "Summit Fitness",
  "Maple Street Bakery", "Ironbridge Legal", "Willow Pediatrics", "Redwood Storage", "Lakeside Auto", "Pioneer Plumbing",
  "Orchard Vet", "Granite Insurance", "Beacon Yoga", "Copper Kettle Cafe", "Falcon Logistics", "Meadow Florist",
  "Silverline Tax", "Evergreen Landscaping", "Crescent Bank", "Driftwood Hotel", "Anchor Marine", "Juniper Salon",
  "Keystone Builders", "Lantern Books", "Mosaic Design", "Nimbus Cloud", "Opal Jewelers", "Prairie Farms",
];
const DELIVERABLES = [
  "contract review", "onboarding checklist", "pricing proposal", "brand guide", "website redesign", "security questionnaire",
  "data migration", "training session", "quarterly report", "launch plan", "invoice dispute", "renewal quote",
  "integration setup", "legal approval", "budget sign-off", "photo shoot", "email campaign", "audit response",
  "compliance form", "kickoff meeting", "vendor selection", "staging environment", "support handover", "case study",
];
const SOURCES = ["clickup", "salesforce", "linear"];
const TEAMS = ["Marketing", "Sales", "Operations", "Engineering", "Finance"];

// Filler text that sounds like waiting but names no other item in the workspace, so it must not become a link.
const EXTERNAL_WAITING = [
  "Waiting on the client to confirm the scope.",
  "Waiting for the customer to send their logo files.",
  "Owner is out this week, picking it back up Monday.",
  "Needs a decision from the owner before we go further.",
];
const CALM = ["In progress, on track.", "No blockers right now.", "First draft shared, collecting feedback.", "Scheduled for next sprint."];
const PADDING =
  " Last reviewed in the weekly sync; no change to the plan, and the owner has the context needed to continue without further input from other teams.";

interface Planted {
  blockerId: string;
  blockedId: string;
}

function build(count: number, long: boolean, seed: number): { items: WorkItem[]; planted: Planted[] } {
  const random = seededRandom(seed);
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const used = new Set<string>();
  const items: WorkItem[] = [];
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    let name: string;
    do name = `${pick(CUSTOMERS)} ${pick(DELIVERABLES)}`;
    while (used.has(name));
    used.add(name);
    names.push(name);
    const calm = random() < 0.5;
    const text = calm ? pick(CALM) : pick(EXTERNAL_WAITING);
    const initiative = `${pick(CUSTOMERS)} program`;
    items.push({
      id: `${SOURCES[i % SOURCES.length]}:${i}`,
      source: SOURCES[i % SOURCES.length],
      externalId: String(i),
      title: name,
      status: "open",
      isDone: false,
      assignee: null,
      parent: { id: `init:${initiative}`, title: initiative },
      scope: `Deliver the ${name.toLowerCase()} for ${pick(TEAMS)}.${long ? PADDING : ""}`,
      team: pick(TEAMS),
      lastActivityNote: text + (long ? PADDING : ""),
      url: "https://example.com",
      dueDateMs: null,
      createdMs: null,
      closedMs: null,
      updatedMs: null,
    });
  }

  // Plant links: the blocked item's note names the blocker's title in words, never its id.
  const planted: Planted[] = [];
  const pairCount = Math.max(3, Math.round(count / 15));
  const order = items.map((_, i) => i).sort(() => random() - 0.5);
  for (let p = 0; p < pairCount; p++) {
    const blocker = items[order[2 * p]];
    const blocked = items[order[2 * p + 1]];
    const phrase = p % 2 === 0
      ? `Waiting on the ${blocker.title} to be finished before this can start.`
      : `Cannot schedule anything until the ${blocker.title} is cleared.`;
    blocked.lastActivityNote = phrase + (long ? PADDING : "");
    planted.push({ blockerId: blocker.id, blockedId: blocked.id });
  }
  return { items, planted };
}

async function run(count: number, long: boolean): Promise<void> {
  if (count > 600) throw new Error("Refusing more than 600 items in one measurement.");
  const { items, planted } = build(count, long, 7);
  resetInferenceMeter();
  const started = Date.now();
  const edges = await inferDependencyEdges(items);
  const seconds = (Date.now() - started) / 1000;
  const meter = getInferenceMeter();

  const key = (e: Planted) => `${e.blockerId}>${e.blockedId}`;
  const plantedKeys = new Set(planted.map(key));
  const reportedKeys = new Set(edges.map(key));
  const found = planted.filter((p) => reportedKeys.has(key(p))).length;
  const backwards = planted.filter((p) => !reportedKeys.has(key(p)) && reportedKeys.has(`${p.blockedId}>${p.blockerId}`)).length;
  const spurious = edges.filter((e) => !plantedKeys.has(key(e))).length;
  const positions = new Map(items.map((item, i) => [item.id, i]));
  const missedAt = planted
    .filter((p) => !reportedKeys.has(key(p)))
    .map((p) => positions.get(p.blockedId)!)
    .sort((a, b) => a - b);

  console.log(
    JSON.stringify({
      items: count,
      long,
      calls: meter.calls,
      failed: meter.failures,
      lastFailure: meter.lastFailure,
      inputTokens: meter.inputTokens,
      outputTokens: meter.outputTokens,
      inputPerItem: meter.inputTokens ? Math.round(meter.inputTokens / count) : null,
      seconds: Math.round(seconds * 10) / 10,
      planted: planted.length,
      found,
      foundBackwards: backwards,
      missed: planted.length - found - backwards,
      spuriousLinks: spurious,
      missedBlockedItemPositions: missedAt,
    }),
  );
}

/**
 * Incremental check: one full call, then a second call after 5 items change and 1 item is added, then a
 * third call forced to be full. Checks that (a) the second call is much smaller, (b) links planted earlier
 * are still returned, (c) links planted in the changed items are found, and (d) shows the known gap: an
 * UNCHANGED item whose note names an item that did not exist yet is not found until a full run.
 */
async function runIncremental(count: number): Promise<void> {
  const { items, planted } = build(count, false, 7);
  const involved = new Set(planted.flatMap((p) => [p.blockerId, p.blockedId]));
  const free = items.filter((item) => !involved.has(item.id));
  const [dangling, changeA, changeB, benign1, benign2, benign3, blockerA, blockerB] = free;

  // The dangling item waits on something that does not exist until the second call.
  dangling.lastActivityNote = "Waiting on the Zephyr onboarding pack to be finished before this can start.";
  clearInferenceMemory();
  const key = (e: Planted) => `${e.blockerId}>${e.blockedId}`;
  const report = async (label: string, list: WorkItem[], expect: Planted[]) => {
    resetInferenceMeter();
    const started = Date.now();
    const edges = await inferDependencyEdges(list);
    const meter = getInferenceMeter();
    const got = new Set(edges.map(key));
    console.log(
      JSON.stringify({
        step: label,
        calls: meter.calls,
        incremental: meter.incrementalCalls,
        reused: meter.reusedRebuilds,
        failed: meter.failures,
        lastFailure: meter.lastFailure,
        itemsSentInFull: meter.lastItemCount,
        inputTokens: meter.inputTokens,
        outputTokens: meter.outputTokens,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        expectedLinks: expect.length,
        foundExpected: expect.filter((e) => got.has(key(e))).length,
        totalLinksReturned: edges.length,
        notExpected: edges.filter((e) => !expect.some((x) => key(x) === key(e))).length,
      }),
    );
  };

  await report("1 full run", items, planted);

  // Second state: two changed items now wait on existing items; three get harmless new notes; one new item appears.
  const newPlanted: Planted[] = [
    { blockerId: blockerA.id, blockedId: changeA.id },
    { blockerId: blockerB.id, blockedId: changeB.id },
  ];
  const zephyr: WorkItem = { ...dangling, id: "clickup:zephyr", externalId: "zephyr", title: "Zephyr onboarding pack", scope: "Deliver the zephyr onboarding pack.", lastActivityNote: "In progress, on track." };
  const second = items.map((item) => {
    if (item.id === changeA.id) return { ...item, lastActivityNote: `Waiting on the ${blockerA.title} to be finished before this can start.` };
    if (item.id === changeB.id) return { ...item, lastActivityNote: `Cannot schedule anything until the ${blockerB.title} is cleared.` };
    if ([benign1.id, benign2.id, benign3.id].includes(item.id)) return { ...item, lastActivityNote: "Status reviewed, no change." };
    return item;
  });
  second.push(zephyr);
  const expectedSecond = [...planted, ...newPlanted];
  await report("2 incremental run (5 changed, 1 new)", second, expectedSecond);
  console.log(JSON.stringify({ gapLinkPlanted: `${zephyr.id}>${dangling.id}`, note: "found only if reported in step 2 or 3 above as an extra" }));
  await report("2b same state again (nothing changed)", second, expectedSecond);

  const gap: Planted = { blockerId: zephyr.id, blockedId: dangling.id };
  const expectedFull = [...expectedSecond, gap];
  process.env.INFERENCE_FULL_REFRESH_MS = "0";
  await report("3 forced full run", second, expectedFull);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) throw new Error("Give at least one size, e.g. 15 150 400 150:long");
  for (const arg of args) {
    const [n, flag] = arg.split(":");
    if (n === "inc") await runIncremental(Number(flag));
    else await run(Number(n), flag === "long");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.constructor.name}: ${error.message.slice(0, 200)}` : "unknown error");
  process.exit(1);
});

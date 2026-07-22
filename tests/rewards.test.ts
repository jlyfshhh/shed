import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_REWARD_CENTS, netBalanceCents, parseRewardCents, rewardForCompletion } from "../lib/rewards.ts";

test("non-earning members never accrue a reward", () => {
  assert.equal(rewardForCompletion(false, 500, 25), 0);
  assert.equal(rewardForCompletion(false, null, 25), 0);
});

test("earning members use the per-plan reward when set, else the default", () => {
  assert.equal(rewardForCompletion(true, 50, 25), 50);
  assert.equal(rewardForCompletion(true, null, 25), 25);
  assert.equal(rewardForCompletion(true, undefined, 25), 25);
});

test("a per-plan reward of zero earns nothing even for earners", () => {
  assert.equal(rewardForCompletion(true, 0, 25), 0);
});

test("balance is earned minus paid, and never negative", () => {
  assert.equal(netBalanceCents(300, 100), 200);
  assert.equal(netBalanceCents(100, 100), 0);
  assert.equal(netBalanceCents(100, 250), 0);
});

test("stored default reward parses and clamps, falling back to 25", () => {
  assert.equal(parseRewardCents("25"), 25);
  assert.equal(parseRewardCents("50"), 50);
  assert.equal(parseRewardCents(""), DEFAULT_REWARD_CENTS);
  assert.equal(parseRewardCents("-5"), DEFAULT_REWARD_CENTS);
  assert.equal(parseRewardCents("nonsense"), DEFAULT_REWARD_CENTS);
  assert.equal(parseRewardCents("99999999"), 100_000);
});

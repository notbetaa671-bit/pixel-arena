import test from "node:test";
import assert from "node:assert/strict";
import { angleDifference, clamp, distance, normalizeAngle, normalizeVector, randomSpawn, WORLD } from "../src/game.js";

test("normalizeVector keeps diagonal movement at unit speed", () => {
  const vector = normalizeVector(1, 1);
  assert.ok(Math.abs(Math.hypot(vector.x, vector.y) - 1) < 0.000001);
});

test("normalizeVector handles no input", () => {
  assert.deepEqual(normalizeVector(0, 0), { x: 0, y: 0 });
});

test("angles wrap around the -PI / PI boundary", () => {
  assert.ok(angleDifference(Math.PI - 0.05, -Math.PI + 0.05) < 0.11);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 0.000001);
});

test("distance and clamp are deterministic", () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-10, 0, 100), 0);
});

test("randomSpawn stays inside the playable bounds", () => {
  const spawn = randomSpawn(() => 0.5);
  assert.ok(spawn.x >= 120 && spawn.x <= WORLD.width - 120);
  assert.ok(spawn.y >= 120 && spawn.y <= WORLD.height - 120);
});


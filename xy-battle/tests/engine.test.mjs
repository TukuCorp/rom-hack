import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, MOVES, chooseMove, usePotion, attemptRun } from '../engine.mjs';

test('wild battle plays from selection through fainting and restart', () => {
  let state = createBattle();
  let seenAttack = false, seenFaint = false;
  for (let i = 0; i < 20 && state.status === 'active'; i++) {
    const result = chooseMove(state, 'water-pulse');
    seenAttack ||= result.events.some(e => e.type === 'attack');
    seenFaint ||= result.events.some(e => e.type === 'faint');
    state = result.state;
  }
  assert.equal(state.status, 'won');
  assert.equal(state.opponent.hp, 0);
  assert.ok(seenAttack && seenFaint);
  assert.equal(createBattle().status, 'active');
  assert.equal(createBattle().player.hp, createBattle().player.maxHp);
});
test('actions are immutable and consume PP, enemy retaliates', () => {
  const state = createBattle(), before = structuredClone(state);
  const { state: next, events } = chooseMove(state, MOVES[0].id);
  assert.deepEqual(state, before);
  assert.equal(next.pp[MOVES[0].id], state.pp[MOVES[0].id] - 1);
  assert.ok(next.player.hp < state.player.hp);
  assert.equal(events.filter(e => e.type === 'attack').length, 2);
});
test('depleted or unknown moves and terminal actions are rejected', () => {
  const state = createBattle();
  state.pp['water-pulse'] = 0;
  assert.throws(() => chooseMove(state, 'water-pulse'), /PP/);
  assert.throws(() => chooseMove(state, 'missing'), /Unknown/);
  assert.throws(() => chooseMove(attemptRun(createBattle()).state, 'water-pulse'), /over/);
});
test('potions heal at most max HP, consume a turn and can run out', () => {
  const state = createBattle(); state.player.hp = 50;
  const result = usePotion(state);
  assert.equal(result.state.potions, 1);
  assert.equal(result.events.find(e => e.type === 'hp').to, 100);
  assert.equal(result.state.turn, 2);
  assert.ok(result.state.player.hp <= state.player.maxHp);
  state.potions = 0;
  assert.throws(() => usePotion(state), /potions/);
});
test('opponent can win; neither HP can go below zero', () => {
  let state = createBattle(); state.player.hp = 1;
  state = chooseMove(state, 'quick-attack').state;
  assert.equal(state.status, 'lost');
  assert.equal(state.player.hp, 0);
  assert.ok(state.opponent.hp >= 0);
});
test('Struggle is available only when all moves have no PP', () => {
  const state = createBattle();
  assert.throws(() => chooseMove(state, 'struggle'), /PP/);
  for (const move of MOVES) state.pp[move.id] = 0;
  const result = chooseMove(state, 'struggle');
  assert.ok(result.events.some(e => e.type === 'attack' && e.move === 'Struggle'));
  assert.ok(result.state.player.hp < state.player.hp);
});
test('escaping ends the wild encounter', () => {
  const result = attemptRun(createBattle());
  assert.equal(result.state.status, 'escaped');
  assert.ok(result.events.some(e => e.type === 'message'));
});

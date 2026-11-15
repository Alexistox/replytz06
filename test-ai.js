const assert = require('assert');
const Ai = require('./ai');

function testNormalizeProvider() {
  assert.strictEqual(Ai.normalizeProvider('claude'), 'claude');
  assert.strictEqual(Ai.normalizeProvider('Anthropic'), 'claude');
  assert.strictEqual(Ai.normalizeProvider('grok'), 'grok');
  assert.strictEqual(Ai.normalizeProvider('xai'), 'grok');
  assert.strictEqual(Ai.normalizeProvider('openai'), 'openai');
  assert.strictEqual(Ai.normalizeProvider('gpt'), 'openai');
  assert.strictEqual(Ai.normalizeProvider('nope'), '');
}

function testProviderConfigOverride() {
  const cfg = Ai.getProviderConfig('claude', { aiModel: 'claude-test' });
  assert.strictEqual(cfg.provider, 'claude');
  assert.strictEqual(cfg.model, 'claude-test');
  assert.strictEqual(cfg.label, 'Claude');

  const grok = Ai.getProviderConfig('grok', null);
  assert.strictEqual(grok.provider, 'grok');
  assert.ok(grok.model);
}

function testHistoryStore() {
  const store = new Ai.ChatHistoryStore(2);
  store.push('1', 'user', 'a');
  store.push('1', 'assistant', 'b');
  store.push('1', 'user', 'c');
  store.push('1', 'assistant', 'd');
  store.push('1', 'user', 'e');
  store.push('1', 'assistant', 'f');
  const hist = store.get('1');
  assert.ok(hist.length <= 4);
  assert.strictEqual(hist[hist.length - 1].content, 'f');
  store.clear('1');
  assert.deepStrictEqual(store.get('1'), []);
}

function testDescribe() {
  const d = Ai.describeAiSetup({ aiProvider: 'grok' });
  assert.strictEqual(d.provider, 'grok');
  assert.strictEqual(typeof d.configured, 'boolean');
}

testNormalizeProvider();
testProviderConfigOverride();
testHistoryStore();
testDescribe();
console.log('✅ test-ai.js passed');

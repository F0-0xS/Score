const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// DOM minimal : il suffit de laisser app.js s’initialiser pour exposer ScoreTest.
const noop = () => {};
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const element = () => ({
  addEventListener: noop,
  classList,
  querySelector: () => null,
  querySelectorAll: () => [],
  focus: noop,
  value: "4",
  textContent: "",
  innerHTML: "",
  dataset: {},
  className: ""
});
const localData = new Map();
const documentStub = {
  querySelector: element,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: noop
};
const windowStub = {
  document: documentStub,
  addEventListener: noop,
  scrollTo: noop,
  confirm: () => true,
  crypto: { randomUUID: () => "test-id" }
};
const context = {
  window: windowStub,
  document: documentStub,
  navigator: {},
  location: { protocol: "http:", hostname: "localhost" },
  localStorage: {
    getItem: key => localData.get(key) ?? null,
    setItem: (key, value) => localData.set(key, value),
    removeItem: key => localData.delete(key)
  },
  Intl,
  Date,
  Math,
  Number,
  String,
  Array,
  Set,
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: noop
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("app.js", "utf8"), context);

const { parseFrenchNumber, parseScoreTranscript, parsePlayerNamesTranscript } = windowStub.ScoreTest;
const cases = new Map([
  ["zéro", 0],
  ["douze", 12],
  ["vingt-cinq", 25],
  ["soixante-quinze", 75],
  ["quatre-vingt-dix", 90],
  ["quatre-vingt-onze", 91],
  ["cent", 100],
  ["moins trois", -3],
  ["42", 42]
]);
for (const [spoken, expected] of cases) {
  assert.equal(parseFrenchNumber(spoken), expected, spoken);
}

const players = ["Marie", "Paul", "Sophie", "Thomas"].map(name => ({ name }));
assert.deepEqual(
  JSON.parse(JSON.stringify(parseScoreTranscript("Marie douze, Paul moins trois, Sofi vingt-cinq", players))),
  [
    { playerIndex: 0, name: "Marie", value: 12 },
    { playerIndex: 1, name: "Paul", value: -3 },
    { playerIndex: 2, name: "Sophie", value: 25 }
  ]
);

assert.deepEqual(
  JSON.parse(JSON.stringify(parsePlayerNamesTranscript("Marie Paul Sophie et Thomas"))),
  ["Marie", "Paul", "Sophie", "Thomas"]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(parsePlayerNamesTranscript("Jean Pierre, Marie et Sophie"))),
  ["Jean Pierre", "Marie", "Sophie"]
);

console.log("Tests du parseur vocal : OK");

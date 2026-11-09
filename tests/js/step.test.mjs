// web/lib/step.js: the STEP Bible's strings as the word sheet shows them. The inputs are what
// the test library's engine returns for H2617A (lexicon glosses).
import test from "node:test";
import assert from "node:assert/strict";
import { glossStem, foldGlosses } from "../../web/lib/step.js";

test("glossStem drops the little words a Hebrew word carries", () => {
  assert.equal(glossStem("covenant loyalty his"), "covenant loyalty");
  assert.equal(glossStem("according to covenant loyalty your"), "covenant loyalty");
  assert.equal(glossStem("and the covenant loyalty"), "covenant loyalty");
  assert.equal(glossStem("the covenant loyalties of"), "covenant loyalties");
  assert.equal(glossStem("[is] shepherd my"), "is shepherd");
  assert.equal(glossStem("rest<s>"), "rests");
  assert.equal(glossStem("loyalty"), "loyalty");
  assert.equal(glossStem("my"), "my"); // a gloss that is only a little word stays itself
});

test("foldGlosses joins the forms of hesed under its stem", () => {
  const glosses = [
    { gloss: "covenant loyalty his", n: 54 }, { gloss: "covenant loyalty", n: 44 }, { gloss: "covenant loyalty your", n: 32 },
    { gloss: "loyalty", n: 24 }, { gloss: "according to covenant loyalty your", n: 7 }, { gloss: "and covenant loyalty my", n: 5 },
    { gloss: "and the covenant loyalty", n: 5 }, { gloss: "the covenant loyalty of", n: 5 }, { gloss: "the covenant loyalties of", n: 5 },
    { gloss: "in covenant loyalty your", n: 4 }, { gloss: "covenant loyalty my", n: 4 }, { gloss: "and loyalty", n: 4 },
  ];
  assert.deepEqual(foldGlosses(glosses), [{ gloss: "covenant loyalty", n: 160 }, { gloss: "loyalty", n: 28 }, { gloss: "covenant loyalties", n: 5 }]);
  assert.deepEqual(foldGlosses([]), []);
  assert.deepEqual(foldGlosses(null), []);
});

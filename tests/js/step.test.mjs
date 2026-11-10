// web/lib/step.js: the STEP Bible's strings as the word sheet shows them. The inputs are what
// the test library's engine returns: the lexicon glosses of H2617A, and the grammar examples.
import test from "node:test";
import assert from "node:assert/strict";
import { glossStem, foldGlosses, exampleOf, grammarMeaning } from "../../web/lib/step.js";

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

// The grammar examples, as the test library's engine returns them (GL.api("morph")): STEP's
// TEHMC and TEGMC text with the outer quotes partly taken off. U+201A is STEP's low comma.
test("exampleOf: a Hebrew example with a sentence and its word keeps the sentence", () => {
  assert.equal(exampleOf("giving to‚ rich _and_ poor\": \"and"), "giving to, rich and poor"); // HC, Genesis 1:1's "and"
  assert.equal(exampleOf("it was _wisely_ given\": \"lately"), "it was wisely given"); // HD
  assert.equal(exampleOf("\"giving to‚ rich _and_ poor\": \"and\""), "giving to, rich and poor"); // both quotes kept
});

test("exampleOf: the preposition's two lists come out as one list, not as garbled quotes", () => {
  // HR, the be- of be.re.Shit in Genesis 1:1, which showed as (of, from, by, in": "of, to, from, in)
  assert.equal(exampleOf("_of‚ from‚ by‚ in_\": \"_of‚ to, from‚ in_"), "of, from, by, in");
  assert.equal(exampleOf("_of‚ from‚ by‚ in_"), "of, from, by, in"); // the Greek PREP
});

test("exampleOf: the object marker's ( ) is no example at all", () => {
  assert.equal(exampleOf("( )"), ""); // HTo, 'et in Genesis 1:1, which showed as (( ))
  assert.equal(exampleOf("!"), ""); // HSh, the emphatic suffix
  assert.equal(exampleOf(""), "");
  assert.equal(exampleOf(null), "");
  assert.equal(exampleOf("e.g."), "");
});

test("exampleOf: parentheses and open quotes that belong to the example stay, the sex STEP writes for a gender does not", () => {
  assert.equal(exampleOf("a (female) person (or thing)"), "a person (or thing)"); // HNcfsa, emunah
  assert.equal(exampleOf("a (female) person (or thing) of..."), "a person (or thing) of..."); // HNcfsc
  assert.equal(exampleOf("(male) people (or things) of..."), "people (or things) of..."); // HNcmpc
  assert.equal(exampleOf("late (male person or thing)"), "late (person or thing)"); // HAamsa
  assert.equal(exampleOf("\"they, them (males)"), "they, them"); // HPp3mp
  assert.equal(exampleOf("you (a female) did or do rise"), "you did or do rise"); // HVqp2fs
  assert.equal(exampleOf("a rising female"), "a rising one"); // HVqrfsa
  assert.equal(exampleOf("females being risen"), "ones being risen"); // HVNrfpa
  assert.equal(exampleOf("\"I, me"), "I, me"); // HPp1bs
});

// The meanings as the test library's engine returns them (GL.api("morph")).
test("grammarMeaning: a feminine noun is feminine in grammar, not a female thing", () => {
  // N-NSF, hupostasis in Hebrews 11:1
  assert.equal(grammarMeaning("a female PERSON OR THING that is doing something"), "a PERSON OR THING that is doing something (feminine in grammar)");
  // HNcfsc, the construct noun, as emunah's forms are parsed
  assert.equal(grammarMeaning("a reference to a female PERSON OR THING, combined with another term"), "a reference to a PERSON OR THING, combined with another term (feminine in grammar)");
  assert.equal(grammarMeaning("a reference to male PEOPLE OR THINGS"), "a reference to PEOPLE OR THINGS (masculine in grammar)"); // HNcmpa
  assert.equal(grammarMeaning("a neuter PERSON OR THING that is having something done to them"), "a PERSON OR THING that is having something done to them (neuter in grammar)"); // N-ASN
  assert.equal(grammarMeaning("a reference to a male or female PERSON OR THING"), "a reference to a PERSON OR THING (masculine or feminine in grammar)"); // HNcbsa
});

test("grammarMeaning: verbs, participles, names and STEP's slips", () => {
  assert.equal(grammarMeaning("performing an ACTION OR ACTIVITY that is done completely in the past or present by a male person or thing being discussed"),
    "performing an ACTION OR ACTIVITY that is done completely in the past or present by a person or thing being discussed (masculine in grammar)"); // HVqp3ms
  assert.equal(grammarMeaning("an ACTION that is happening - done by male people or things that are doing something"),
    "an ACTION that is happening - done by people or things that are doing something (masculine in grammar)"); // V-PAP-NPM
  assert.equal(grammarMeaning("the NAME of a male individual"), "the NAME of an individual (masculine in grammar)"); // HNpm
  assert.equal(grammarMeaning("a female LOCATION that something belongs to"), "a LOCATION that something belongs to (feminine in grammar)"); // N-GSF-L
  assert.equal(grammarMeaning("a reference to THEMSELVES: a male a person being spoken or written to"), "a reference to THEMSELVES: a person being spoken or written to (masculine in grammar)");
  // nothing about gender: left alone
  assert.equal(grammarMeaning("an ACTION that happened - by a person or thing being discussed"), "an ACTION that happened - by a person or thing being discussed"); // V-AAI-3S
  assert.equal(grammarMeaning("a conjunction"), "a conjunction");
  assert.equal(grammarMeaning(null), "");
});

test("exampleOf: Greek sentences lose their underlines", () => {
  assert.equal(exampleOf("a _woman_ giving teachings"), "a woman giving teachings"); // N-NSF
  assert.equal(exampleOf("_he/she/it taught _"), "he/she/it taught"); // V-AAI-3S, a stray space inside
  assert.equal(exampleOf("_not_ giving this _nor_ that"), "not giving this nor that"); // PRT-N
  assert.equal(exampleOf("Example: he/it did or does rise"), "he/it did or does rise"); // TEHMC's own line
});

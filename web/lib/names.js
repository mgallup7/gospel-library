// What passages are called, and which chapters repeat another.
// - A passage known by a name ("Moroni's promise", "the Beatitudes", "Lehi's dream") is found by
//   that name: the search shows the reference as a card to open, above whatever the words find.
// - A chapter that quotes another at length (the Isaiah chapters in the Book of Mormon, the sermon
//   at the temple beside the Sermon on the Mount) knows its twin, so the two can be read together.
// Both are small fixed tables: every reference here is checked by tests/js/names.test.mjs.

const NAMES = [
  // Book of Mormon
  ["Moroni's promise", "Moroni 10:3-5", ["moronis challenge", "the promise of moroni", "book of mormon promise"]],
  ["Lehi's dream", "1 Nephi 8", ["vision of the tree of life", "tree of life vision", "lehis vision of the tree of life", "dream of the tree of life", "the iron rod", "rod of iron dream"]],
  ["Nephi's vision", "1 Nephi 11", ["nephis vision of the tree of life"]],
  ["I will go and do", "1 Nephi 3:7", []],
  ["The Liahona", "1 Nephi 16:10", []],
  ["The psalm of Nephi", "2 Nephi 4:16-35", ["nephis psalm"]],
  ["Opposition in all things", "2 Nephi 2:11", []],
  ["The doctrine of Christ", "2 Nephi 31", []],
  ["The Isaiah chapters", "2 Nephi 12", ["isaiah chapters", "isaiah in the book of mormon", "isaiah chapters in 2 nephi"]],
  ["The allegory of the olive tree", "Jacob 5", ["allegory of the olive trees", "parable of the olive tree", "zenos allegory", "allegory of zenos", "the tame and wild olive tree"]],
  ["King Benjamin's address", "Mosiah 2", ["king benjamins sermon", "king benjamins speech", "king benjamins discourse", "benjamins address"]],
  ["The natural man", "Mosiah 3:19", ["natural man is an enemy to god"]],
  ["The waters of Mormon", "Mosiah 18", ["baptism at the waters of mormon", "the baptismal covenant"]],
  ["Alma's conversion", "Alma 36", ["conversion of alma", "alma the youngers conversion", "conversion of alma the younger"]],
  ["A mighty change of heart", "Alma 5:14", ["mighty change of heart", "the mighty change", "mighty change in your hearts"]],
  ["Alma on faith", "Alma 32", ["faith as a seed", "the seed of faith", "faith is like a seed", "experiment upon the word", "almas sermon on faith"]],
  ["The title of liberty", "Alma 46", ["captain moronis title of liberty"]],
  ["The stripling warriors", "Alma 56", ["stripling warriors", "two thousand stripling warriors", "2000 stripling warriors", "helamans stripling warriors", "sons of helaman", "the two thousand sons of helaman", "2000 young men"]],
  ["Samuel the Lamanite", "Helaman 13", ["samuel the lamanites prophecy", "samuel on the wall"]],
  ["Christ appears to the Nephites", "3 Nephi 11", ["the savior visits the nephites", "christ visits the nephites", "jesus appears to the nephites", "christ in america", "christ visits america", "the saviors visit to the americas"]],
  ["The sermon at the temple", "3 Nephi 12", ["sermon at the temple", "nephite sermon on the mount"]],
  ["The brother of Jared sees the Lord", "Ether 3", ["brother of jared sees the finger of the lord", "the finger of the lord", "brother of jared and the stones"]],
  ["Weak things become strong", "Ether 12:27", ["weak things made strong", "weakness becomes strength"]],
  ["The sacrament prayers", "Moroni 4", ["sacrament prayer", "sacrament prayers", "prayer on the bread", "blessing on the bread"]],
  ["Charity, the pure love of Christ", "Moroni 7:45-48", ["pure love of christ", "charity is the pure love of christ"]],
  ["Baptism of little children", "Moroni 8", ["little children need no baptism", "infant baptism"]],
  // Old Testament
  ["The Creation of the world", "Genesis 1", ["creation of the world", "the creation story", "the creation account"]],
  ["The Fall of Adam and Eve", "Genesis 3", ["fall of adam", "the fall of adam and eve", "adam and eve in the garden", "garden of eden"]],
  ["Noah and the flood", "Genesis 6", ["noahs ark", "noah and the ark"]],
  ["The tower of Babel", "Genesis 11", ["tower of babel"]],
  ["The Abrahamic covenant", "Genesis 17", ["abrahamic covenant", "covenant of abraham", "gods covenant with abraham"]],
  ["Jacob's ladder", "Genesis 28", ["jacobs dream"]],
  ["The burning bush", "Exodus 3", ["moses and the burning bush"]],
  ["The first Passover", "Exodus 12", []],
  ["The parting of the Red Sea", "Exodus 14", ["parting of the red sea", "crossing the red sea", "moses parts the red sea"]],
  ["The Ten Commandments", "Exodus 20", ["ten commandments", "10 commandments", "the decalogue"]],
  ["The Shema", "Deuteronomy 6:4-5", ["shema"]],
  ["David and Goliath", "1 Samuel 17", []],
  ["The Lord is my shepherd", "Psalm 23", ["the 23rd psalm", "23rd psalm", "twenty third psalm", "the shepherd psalm", "psalm of the shepherd"]],
  ["The suffering servant", "Isaiah 53", ["suffering servant", "man of sorrows"]],
  ["The valley of dry bones", "Ezekiel 37", ["valley of dry bones", "dry bones"]],
  ["The stick of Judah and the stick of Joseph", "Ezekiel 37:15-17", ["stick of judah", "stick of joseph", "two sticks", "the two sticks", "stick of ephraim"]],
  ["Nebuchadnezzar's dream", "Daniel 2", ["the stone cut without hands", "stone cut out of the mountain", "daniel interprets the dream"]],
  ["The fiery furnace", "Daniel 3", ["fiery furnace", "shadrach meshach and abednego"]],
  ["Daniel in the lions' den", "Daniel 6", ["daniel in the lions den", "daniel and the lions den", "lions den", "the lions den"]],
  ["The windows of heaven", "Malachi 3:8-10", ["windows of heaven", "law of tithing in malachi"]],
  ["Elijah's return", "Malachi 4:5-6", ["elijah will return", "hearts of the children", "turn the hearts of the fathers", "the spirit of elijah"]],
  // New Testament
  ["The Sermon on the Mount", "Matthew 5", ["sermon on the mount", "the sermon on the mount"]],
  ["The Beatitudes", "Matthew 5:3-12", ["beatitudes", "the beatitudes"]],
  ["The Lord's Prayer", "Matthew 6:9-13", ["lords prayer"]],
  ["The golden rule", "Matthew 7:12", ["golden rule"]],
  ["The parable of the sower", "Matthew 13", ["parable of the sower", "parable of the soils", "wheat and the tares", "parable of the wheat and the tares"]],
  ["The Transfiguration", "Matthew 17", ["transfiguration", "mount of transfiguration"]],
  ["The great commandments", "Matthew 22:36-40", ["great commandment", "the great commandment", "two great commandments", "the two great commandments", "first and great commandment", "greatest commandment", "the greatest commandment"]],
  ["The Olivet discourse", "Matthew 24", ["olivet discourse", "signs of the second coming", "signs of the times"]],
  ["The parable of the ten virgins", "Matthew 25:1-13", ["parable of the ten virgins", "ten virgins", "the ten virgins", "wise and foolish virgins"]],
  ["The parable of the talents", "Matthew 25:14-30", ["parable of the talents"]],
  ["The sheep and the goats", "Matthew 25:31-46", ["sheep and the goats", "sheep and goats", "parable of the sheep and the goats", "the least of these"]],
  ["The great commission", "Matthew 28:19-20", ["great commission"]],
  ["The good Samaritan", "Luke 10:25-37", ["good samaritan", "parable of the good samaritan"]],
  ["The lost sheep", "Luke 15:3-7", ["lost sheep", "parable of the lost sheep", "the ninety and nine", "ninety and nine"]],
  ["The prodigal son", "Luke 15:11-32", ["prodigal son", "parable of the prodigal son"]],
  ["The road to Emmaus", "Luke 24:13-35", ["road to emmaus"]],
  ["Nicodemus and being born again", "John 3", ["born of water and of the spirit"]],
  ["The woman at the well", "John 4", ["woman at the well", "the samaritan woman"]],
  ["The bread of life", "John 6", ["bread of life", "bread of life sermon", "feeding the five thousand", "feeding of the five thousand"]],
  ["The good shepherd", "John 10", ["good shepherd"]],
  ["The raising of Lazarus", "John 11", ["raising of lazarus"]],
  ["The Last Supper", "John 13", ["last supper", "washing of the feet", "jesus washes the disciples feet", "washing the feet"]],
  ["The intercessory prayer", "John 17", ["intercessory prayer", "great intercessory prayer", "the great intercessory prayer", "high priestly prayer"]],
  ["The day of Pentecost", "Acts 2", ["day of pentecost"]],
  ["The conversion of Saul", "Acts 9", ["conversion of saul", "conversion of paul", "pauls conversion", "road to damascus", "the road to damascus"]],
  ["Paul on charity", "1 Corinthians 13", ["the love chapter in corinthians", "charity chapter", "charity never faileth chapter", "pauls sermon on charity"]],
  ["The resurrection chapter", "1 Corinthians 15", ["resurrection chapter", "baptism for the dead in the bible"]],
  ["The fruit of the Spirit", "Galatians 5:22-23", ["fruit of the spirit", "fruits of the spirit", "the fruits of the spirit"]],
  ["The armor of God", "Ephesians 6:11-17", ["armor of god", "armour of god", "the armour of god", "whole armor of god", "whole armour of god", "put on the whole armor of god"]],
  ["The faith chapter", "Hebrews 11", ["faith chapter", "hall of faith", "by faith chapter"]],
  ["If any of you lack wisdom", "James 1:5", ["lack wisdom", "james 1 5 lack wisdom", "the verse joseph smith read"]],
  ["Faith without works", "James 2:14-26", ["faith without works", "faith without works is dead"]],
  // Doctrine and Covenants, Pearl of Great Price
  ["The First Vision", "Joseph Smith—History 1:14-20", ["first vision", "joseph smiths first vision", "the sacred grove"]],
  ["Moroni's visit to Joseph Smith", "Joseph Smith—History 1:30-47", ["moronis visit", "moroni appears to joseph smith", "angel moroni appears"]],
  ["A marvelous work", "D&C 4", ["a marvelous work is about to come forth", "the missionary section", "missionary section"]],
  ["The worth of souls", "D&C 18:10-16", ["worth of souls", "the worth of souls is great"]],
  ["The law of the Church", "D&C 42", ["law of the church", "law of consecration"]],
  ["The vision of the degrees of glory", "D&C 76", ["degrees of glory", "three degrees of glory", "the three degrees of glory", "kingdoms of glory", "the three kingdoms"]],
  ["The oath and covenant of the priesthood", "D&C 84:33-44", ["oath and covenant of the priesthood", "oath and covenant"]],
  ["The olive leaf", "D&C 88", ["olive leaf"]],
  ["The Word of Wisdom", "D&C 89", ["word of wisdom"]],
  ["The law of tithing", "D&C 119", ["law of tithing"]],
  ["Liberty Jail", "D&C 121", ["liberty jail", "letter from liberty jail"]],
  ["Unrighteous dominion", "D&C 121:34-46", ["unrighteous dominion", "rights of the priesthood"]],
  ["Eternal marriage", "D&C 132", ["eternal marriage", "celestial marriage", "new and everlasting covenant of marriage"]],
  ["The vision of the redemption of the dead", "D&C 138", ["vision of the redemption of the dead", "redemption of the dead", "joseph f smiths vision", "vision of the spirit world"]],
  ["Moses sees God face to face", "Moses 1", ["moses 1 vision", "vision of moses", "this is my work and my glory chapter"]],
  ["My work and my glory", "Moses 1:39", ["work and glory", "gods work and glory"]],
  ["Enoch and the city of Zion", "Moses 7", ["city of enoch", "enoch and zion", "enochs zion", "the god who weeps"]],
  ["The premortal council", "Abraham 3", ["premortal council", "council in heaven", "the council in heaven", "the intelligences", "noble and great ones"]],
  ["The Articles of Faith", "Articles of Faith 1", ["articles of faith", "13 articles of faith", "thirteen articles of faith"]],
];

// "Moroni's Promise?" and "moronis promise" are one key; "where is the lord's prayer" and "lehi's
// dream in the book of mormon" are the name with the asking taken off.
export function nameKey(text) {
  return String(text || "").toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/^(?:the|a|an)\s+/, "");
}
function asked(key) {
  return key.replace(/^(?:where is|where are|what is|what are|find|show me|show|open|read|look up|take me to)\s+/, "").replace(/^(?:the|a|an)\s+/, "")
    .replace(/\s+(?:in the (?:bible|book of mormon|scriptures|new testament|old testament|doctrine and covenants)|scripture|scriptures|verse|verses|passage|story)$/, "").trim();
}
let byKey = null;
function table() {
  if (byKey) return byKey;
  byKey = new Map();
  for (const [name, ref, also] of NAMES) for (const k of [name, ...also]) { const key = nameKey(k); if (key && !byKey.has(key)) byKey.set(key, { name, ref }); }
  return byKey;
}
/** The passage a search names, or null: { name, ref }. Only a whole match counts. */
export function passageNamed(query) {
  const key = nameKey(query);
  if (!key || key.length < 5) return null;
  const bare = asked(key);
  return table().get(key) || (bare.length >= 5 && table().get(bare)) || null;
}
export function allNames() { return NAMES.map(([name, ref, also]) => ({ name, ref, also })); }

// Chapters that repeat another at length: [book, first chapter, book, first chapter, how many, what the first is to the second].
const PARALLELS = [
  ["1-nephi", 20, "isaiah", 48, 2, "quotes"],
  ["2-nephi", 7, "isaiah", 50, 2, "quotes"],
  ["2-nephi", 12, "isaiah", 2, 13, "quotes"],
  ["2-nephi", 27, "isaiah", 29, 1, "draws on"],
  ["mosiah", 14, "isaiah", 53, 1, "quotes"],
  ["3-nephi", 22, "isaiah", 54, 1, "quotes"],
  ["3-nephi", 12, "matthew", 5, 3, "parallels"],
  ["3-nephi", 24, "malachi", 3, 2, "quotes"],
  ["joseph-smith-matthew", 1, "matthew", 24, 1, "is the inspired translation of"],
];
/** The chapters this one should be read beside: [{ slug, chapter, how }], how as a phrase ("quotes", "is quoted in"). */
export function parallelsOf(slug, chapter) {
  const out = [], c = Number(chapter);
  if (!slug || !c) return out;
  for (const [a, a0, b, b0, n, how] of PARALLELS) {
    if (slug === a && c >= a0 && c < a0 + n) out.push({ slug: b, chapter: b0 + (c - a0), how });
    if (slug === b && c >= b0 && c < b0 + n) out.push({ slug: a, chapter: a0 + (c - b0), how: how === "quotes" ? "is quoted in" : how === "draws on" ? "is drawn on in" : how === "parallels" ? "parallels" : "is translated anew in" });
  }
  return out;
}
export function allParallels() { return PARALLELS.map(([a, a0, b, b0, n]) => ({ a, a0, b, b0, n })); }

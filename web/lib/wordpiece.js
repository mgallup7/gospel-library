// A BERT WordPiece tokenizer, the uncased kind the search model uses, written
// to match the Hugging Face tokenizers library step for step: clean the text,
// space out CJK characters, lowercase and strip accents, split on whitespace
// and punctuation, then greedy longest-match pieces with "##" continuations.
// Mirrors what gospel_library/embed.py gets from tokenizer.json.

const CLS = "[CLS]", SEP = "[SEP]", UNK = "[UNK]", PAD = "[PAD]";

export class WordPiece {
  constructor(vocabText, { maxLength = 256, maxWordChars = 100 } = {}) {
    this.ids = new Map();
    const lines = vocabText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].replace(/\r$/, "");
      if (t === "" && i === lines.length - 1) break;
      if (!this.ids.has(t)) this.ids.set(t, i);
    }
    this.cls = this.ids.get(CLS); this.sep = this.ids.get(SEP); this.unk = this.ids.get(UNK); this.pad = this.ids.get(PAD) ?? 0;
    if (this.cls === undefined || this.sep === undefined || this.unk === undefined) throw new Error("the vocabulary lacks [CLS], [SEP] or [UNK]");
    this.maxLength = maxLength;
    this.maxWordChars = maxWordChars;
  }

  // ---- normalization (BertNormalizer: clean_text, handle_chinese_chars, lowercase + strip accents)
  normalize(text) {
    let out = "";
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0);
      if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
      if (isWhitespace(ch)) { out += " "; continue; }
      if (isCJK(cp)) { out += " " + ch + " "; continue; }
      out += ch;
    }
    // lowercase, then drop combining marks (strip_accents follows lowercase in the uncased model)
    out = out.toLowerCase().normalize("NFD");
    let s = "";
    for (const ch of out) if (!/\p{Mn}/u.test(ch)) s += ch;
    return s;
  }

  // ---- pre-tokenization (BertPreTokenizer): whitespace splits, each punctuation mark its own token
  words(text) {
    const out = [];
    let cur = "";
    for (const ch of text) {
      if (isWhitespace(ch)) { if (cur) { out.push(cur); cur = ""; } continue; }
      if (isPunctuation(ch)) { if (cur) { out.push(cur); cur = ""; } out.push(ch); continue; }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  // ---- word pieces
  pieces(word) {
    if ([...word].length > this.maxWordChars) return [this.unk];
    const out = [];
    let start = 0;
    const chars = [...word];
    while (start < chars.length) {
      let end = chars.length, found = null;
      while (start < end) {
        let sub = chars.slice(start, end).join("");
        if (start > 0) sub = "##" + sub;
        const id = this.ids.get(sub);
        if (id !== undefined) { found = id; break; }
        end--;
      }
      if (found === null) return [this.unk];
      out.push(found);
      start = end;
    }
    return out;
  }

  // ids with [CLS] and [SEP], truncated to maxLength
  encode(text) {
    const ids = [this.cls];
    for (const w of this.words(this.normalize(text))) {
      for (const id of this.pieces(w)) ids.push(id);
      if (ids.length >= this.maxLength - 1) break;
    }
    if (ids.length > this.maxLength - 1) ids.length = this.maxLength - 1;
    ids.push(this.sep);
    return ids;
  }
  tokens(text) {
    if (!this.rev) { this.rev = new Map(); for (const [t, i] of this.ids) this.rev.set(i, t); }
    return this.encode(text).map((i) => this.rev.get(i));
  }
}

function isWhitespace(ch) { return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || /\p{Zs}/u.test(ch); }
function isControl(ch) { if (ch === "\t" || ch === "\n" || ch === "\r") return false; return /\p{Cc}|\p{Cf}/u.test(ch); }
function isPunctuation(ch) {
  const cp = ch.codePointAt(0);
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return /\p{P}/u.test(ch);
}
function isCJK(cp) {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df) || (cp >= 0x2a700 && cp <= 0x2b73f)
    || (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f);
}

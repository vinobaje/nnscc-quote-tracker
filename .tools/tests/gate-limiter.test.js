/* The passcode limiter under a burst: sixty wrong guesses sent at once must
   not all be checked. Run: node .tools/tests/gate-limiter.test.js */
const fs = require("fs"), crypto = require("crypto");
const src = fs.readFileSync(require("path").join(__dirname, "../../functions/index.js"), "utf8");
function grab(sig) { const i = src.indexOf("\n" + sig); if (i < 0) throw new Error(sig); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
class HttpsError extends Error { constructor(code, m) { super(m); this.code = code; } }
const mk = new Function("crypto", "HttpsError", [grab("function gateFields"), grab("function masterFields"), grab("function scryptHex"),
  grab("async function gateVerify"), "return { gateVerify, scryptHex, gateFields };"].join("\n"));
const G = mk(crypto, HttpsError);
function store(data) {   /* a document whose transactions run one after another, as Firestore's do */
  let chain = Promise.resolve();
  const ref = { firestore: { runTransaction: (fn) => { const p = chain.then(async () => {
      let pending = null;
      const out = await fn({ get: async () => ({ exists: true, data: () => Object.assign({}, data) }), set: (r, upd) => { pending = upd; } });
      if (pending) Object.assign(data, pending);
      return out; });
    chain = p.catch(() => {}); return p; } },
    set: async (upd) => { await new Promise((r) => setTimeout(r, 1)); Object.assign(data, upd); } };
  return ref;
}
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };
(async () => {
  const f = G.gateFields(false), salt = "00112233445566778899aabbccddeeff";
  const fresh = () => ({ [f.hash]: G.scryptHex("right-one", salt), [f.salt]: salt });
  let data = fresh(), ref = store(data);
  let res = await Promise.all(Array.from({ length: 60 }, (_, i) => G.gateVerify(ref, false, "wrong" + i).then(() => "ok", (e) => e.code)));
  is([res.filter((c) => c === "permission-denied").length, res.filter((c) => c === "resource-exhausted").length], [5, 55], "a burst of 60: five are checked, 55 are refused unchecked");
  data = fresh(); ref = store(data);
  res = await Promise.all(Array.from({ length: 59 }, (_, i) => G.gateVerify(ref, false, "wrong" + i).then(() => "ok", (e) => e.code)).concat([G.gateVerify(ref, false, "right-one").then(() => "ok", (e) => e.code)]));
  is(res[59], "resource-exhausted", "the right passcode hidden at the end of a burst is not reached");
  data = fresh(); ref = store(data);
  is(await G.gateVerify(ref, false, "right-one").then(() => "ok", (e) => e.code), "ok", "the right passcode on its own opens");
  for (let i = 0; i < 4; i++) await G.gateVerify(ref, false, "no").catch(() => {});
  is(await G.gateVerify(ref, false, "right-one").then(() => "ok", (e) => e.code), "ok", "four wrong then right: opens, and the count starts again");
  is(data[f.fails], 0, "count cleared");
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();

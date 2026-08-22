/* Parse every inline <script> of a built page — syntax only. The scratchpad
   gets cleaned between sessions, so this lives with the repo instead. */
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(process.argv[2], "utf8");
const re = /<script(?![^>]*\ssrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g;
let m, n = 0;
while ((m = re.exec(src))) {
  n++;
  try { new vm.Script(m[1], { filename: "block" + n }); }
  catch (e) { console.log("SYNTAX ERROR in block " + n + ": " + e.message); process.exit(1); }
}
console.log("ok — " + n + " script block(s) parse");

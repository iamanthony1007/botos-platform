// test_soft_close_local.mjs
// Local unit test for the soft-close guard matchers. Extracts the two
// functions verbatim from sales-bot/src/index.js (so we test the shipped
// code, not a copy) and runs them against real production cases from the
// 2026-06-10 investigation plus the 4 staging-matrix cases.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./sales-bot/src/index.js", import.meta.url), "utf-8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  const end = src.indexOf(`__name(${name},`);
  if (start === -1 || end === -1) throw new Error(`cannot extract ${name}`);
  return src.slice(start, end);
}

const __name = () => {};
const looksLikeSoftClose = new Function("__name", `${extract("looksLikeSoftClose")}; return looksLikeSoftClose;`)(__name);
const looksLikeLeadPark = new Function("__name", `${extract("looksLikeLeadPark")}; return looksLikeLeadPark;`)(__name);

let pass = 0, fail = 0;
function t(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${actual}, want ${expected})`);
}

console.log("--- looksLikeSoftClose (bot last message) ---");
// real fired soft-closes from the prod scan: must match
t("screenshot lead bot ack", looksLikeSoftClose("No worries, enjoy the call. We'll pick this up another time."), true);
t("good luck sign-off", looksLikeSoftClose("You're welcome. Good luck with everything."), true);
t("get better soon", looksLikeSoftClose("No worries at all, hope you get better soon. "), true);
t("no dramas park", looksLikeSoftClose("No dramas at all. When things open up just let me know and we will find a time that works."), true);
t("talk soon", looksLikeSoftClose("Sweet, talk soon mate."), true);
t("pick it up tomorrow", looksLikeSoftClose("No worries mate Get some rest and we can pick it up tomorrow"), true);
// question gate: bot re-engaged, must NOT match (real prod legit nudges)
t("Q-gate: no worries + question", looksLikeSoftClose("No worries, mate. Have you given any of these a try before? "), false);
t("Q-gate: free content + question", looksLikeSoftClose("No worries, I share a lot of free content that might help when you're ready to dive deeper. What's the #1 thing you'd most want to see improve?"), false);
t("Q-gate: take your time + question", looksLikeSoftClose("No worries, take your time with it. Have you ever done any kind of mobility training before or is this your first crack at it?"), false);
t("Q-gate: all good + question", looksLikeSoftClose("All good. What is the main thing you are looking to improve right now, distance, consistency, or playing without those nagging aches?"), false);
// neutral bot messages: must not match
t("neutral coaching msg", looksLikeSoftClose("Yeah hip rotation is a big one for generating power through the ball."), false);
t("null safety", looksLikeSoftClose(null), false);

console.log("--- looksLikeLeadPark (lead last message) ---");
// real lead parks from the prod scan: must match
t("screenshot lead park", looksLikeLeadPark("About to get on a Teams call for work. Have a nice day"), true);
t("get back to you next week", looksLikeLeadPark("Lemme get back to you next week. Been plagued by tennis/golf elbow"), true);
t("will continue to follow", looksLikeLeadPark("I'm just interested in a general way and will continue to follow"), true);
t("opt-out wording", looksLikeLeadPark("Sorry, Shaun, I do not want to continue this thread. Thank you!"), true);
t("curly apostrophe dont", looksLikeLeadPark("I don’t want to chat right now"), true);
t("not at the moment", looksLikeLeadPark("No, I’m not at the moment. I can’t afford it right now."), true);
// non-parks: must NOT match (false-positive guard)
t("normal answer", looksLikeLeadPark("Mostly consistency off the tee"), false);
t("bare later", looksLikeLeadPark("I started playing 3 years ago, picked it up later in life"), false);
t("bare thanks", looksLikeLeadPark("Thanks, that makes sense"), false);
t("not sure yet", looksLikeLeadPark("Not sure yet"), false);
t("null safety", looksLikeLeadPark(null), false);

console.log("--- staging matrix preview ---");
const A = { bot: "No worries, enjoy the call. We'll pick this up another time.", user: "Ok cool" };
const B = { bot: "No worries mate, have you tried any of these before?", user: "Not sure yet" };
const C = { bot: "Enjoy the call! What are you working on in your game at the moment?", user: "About to get on a Teams call for work. Have a nice day" };
const D = { bot: "Got it. Have you done any mobility training before, or is this your first crack at it?", user: "Mostly consistency off the tee" };
t("(a) skip via bot sign-off", looksLikeSoftClose(A.bot) || looksLikeLeadPark(A.user), true);
t("(b) nudge: Q-gate holds", looksLikeSoftClose(B.bot) || looksLikeLeadPark(B.user), false);
t("(c) skip via lead park", looksLikeSoftClose(C.bot) || looksLikeLeadPark(C.user), true);
t("(d) nudge: normal drop", looksLikeSoftClose(D.bot) || looksLikeLeadPark(D.user), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

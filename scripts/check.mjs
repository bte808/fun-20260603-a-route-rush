import { readFile } from "node:fs/promises";
import {
  BOARD_SIZE,
  CHARGE_COUNT,
  createDailyRoute,
  formatShareResult,
  gradeFor,
  inBounds,
  simulateRoute
} from "../src/core.js";

const requiredFiles = [
  "index.html",
  "src/styles.css",
  "src/app.js",
  "src/core.js",
  "README.md",
  "LICENSE",
  "docs/preview.svg"
];

for (const file of requiredFiles) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  if (!text.trim()) throw new Error(`${file} is empty`);
}

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

if (!html.includes("Route Rush")) throw new Error("index.html must name the game");
if (!html.includes('id="board"')) throw new Error("index.html must expose the board");
if (!html.includes('id="command-queue"')) throw new Error("index.html must expose queued commands");
if (!html.includes('id="challenge-date"')) throw new Error("index.html must expose a challenge date picker");
if (!app.includes("window.RouteRush")) throw new Error("app.js must expose a browser smoke hook");
if (!app.includes("solveToday")) throw new Error("app.js must expose deterministic solve hook");
if (!app.includes("getChallengeLink")) throw new Error("app.js must expose challenge links");
if (!css.includes("@media (max-width: 430px)")) throw new Error("styles.css must include narrow mobile layout");
if (css.includes("font-size: clamp")) throw new Error("styles.css must not scale type with viewport width");
if (!readme.includes("Why it may be worth starring")) throw new Error("README must include star-oriented positioning");
if (!readme.includes("Inspiration sources")) throw new Error("README must cite public inspiration sources");
if (!readme.includes("How to run")) throw new Error("README must explain local running");

for (const dateKey of ["2026-06-03", "2026-06-04", "2026-12-31"]) {
  const puzzle = createDailyRoute(dateKey);
  assertPuzzle(dateKey, puzzle);

  const again = createDailyRoute(dateKey);
  if (JSON.stringify(puzzle.solution) !== JSON.stringify(again.solution)) {
    throw new Error(`${dateKey} solution is not deterministic`);
  }

  const perfect = simulateRoute(puzzle, puzzle.solution);
  if (!perfect.docked) throw new Error(`${dateKey} perfect route did not dock`);
  if (!perfect.allCharges) throw new Error(`${dateKey} perfect route missed sparks`);
  if (perfect.score !== puzzle.possibleScore) throw new Error(`${dateKey} possible score mismatch`);
  if (gradeFor(perfect.score, puzzle.possibleScore) !== "S") {
    throw new Error(`${dateKey} perfect route should grade S`);
  }

  const blocked = simulateRoute(puzzle, ["W"]);
  if (blocked.docked) throw new Error(`${dateKey} west-only route should not dock`);
  if (blocked.score >= perfect.score) throw new Error(`${dateKey} failed route scored too high`);
}

const puzzle = createDailyRoute("2026-06-03");
const result = simulateRoute(puzzle, puzzle.solution);
const share = formatShareResult({
  dateKey: puzzle.dateKey,
  score: result.score,
  possibleScore: puzzle.possibleScore,
  grade: gradeFor(result.score, puzzle.possibleScore),
  docked: result.docked,
  collectedCount: result.collectedCount,
  totalCharges: puzzle.charges.length,
  used: result.used
});

for (const phrase of ["Route Rush 2026-06-03", "S grade", "docked", "sparks", "moves"]) {
  if (!share.includes(phrase)) throw new Error(`share text missing ${phrase}: ${share}`);
}

console.log(
  `check passed: ${BOARD_SIZE}x${BOARD_SIZE}, ${puzzle.routeLength} par, ` +
    `${puzzle.blockers.length} blockers, ${puzzle.possibleScore} possible`
);

function assertPuzzle(dateKey, puzzle) {
  if (puzzle.dateKey !== dateKey) throw new Error(`date mismatch: ${puzzle.dateKey}`);
  if (puzzle.boardSize !== BOARD_SIZE) throw new Error("unexpected board size");
  if (puzzle.charges.length !== CHARGE_COUNT) throw new Error("unexpected charge count");
  if (puzzle.solution.length < 11 || puzzle.solution.length > 14) {
    throw new Error(`${dateKey} route length out of range: ${puzzle.solution.length}`);
  }
  if (puzzle.maxCommands < puzzle.solution.length) throw new Error("max commands below solution length");
  for (const cell of [puzzle.start, puzzle.goal, ...puzzle.charges, ...puzzle.blockers]) {
    if (!inBounds(cell.x, cell.y)) throw new Error(`cell out of bounds: ${JSON.stringify(cell)}`);
  }
}

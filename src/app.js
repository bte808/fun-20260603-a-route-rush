import {
  BOARD_SIZE,
  DIRECTION_ORDER,
  VECTORS,
  cellKey,
  createDailyRoute,
  formatShareResult,
  gradeFor,
  inBounds,
  normalizeDateKey,
  shanghaiDateKey,
  simulateRoute
} from "./core.js";

const params = new URL(window.location.href).searchParams;
const initialDate = normalizeDateKey(params.get("date") || shanghaiDateKey(new Date()));

const elements = {
  board: document.querySelector("#board"),
  dateInput: document.querySelector("#challenge-date"),
  dateChip: document.querySelector("#date-chip"),
  routeName: document.querySelector("#route-name"),
  sparkCount: document.querySelector("#spark-count"),
  parCount: document.querySelector("#par-count"),
  bestScore: document.querySelector("#best-score"),
  moveCount: document.querySelector("#move-count"),
  queue: document.querySelector("#command-queue"),
  status: document.querySelector("#status-line"),
  resultPanel: document.querySelector("#result-panel"),
  resultTitle: document.querySelector("#result-title"),
  resultMeta: document.querySelector("#result-meta"),
  scoreValue: document.querySelector("#score-value"),
  copyButton: document.querySelector("#copy-button"),
  copyLinkButton: document.querySelector("#copy-link-button"),
  loadDateButton: document.querySelector("#load-date-button"),
  runButton: document.querySelector("#run-button"),
  undoButton: document.querySelector("#undo-button"),
  resetButton: document.querySelector("#reset-button"),
  directionButtons: Array.from(document.querySelectorAll("[data-dir]"))
};

let puzzle = createDailyRoute(initialDate);
let commands = [];
let outcome = null;
let replayIndex = 0;
let animating = false;
let replayTimer = null;
let shareText = "";

loadDate(puzzle.dateKey, { updateUrl: true });

for (const button of elements.directionButtons) {
  button.addEventListener("click", () => addCommand(button.dataset.dir));
}

elements.queue.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-command]");
  if (!removeButton || animating) return;
  commands.splice(Number(removeButton.dataset.removeCommand), 1);
  clearOutcome();
  render();
});

elements.runButton.addEventListener("click", () => runRoute({ animate: true }));
elements.undoButton.addEventListener("click", () => {
  if (animating) return;
  commands.pop();
  clearOutcome();
  render();
});
elements.resetButton.addEventListener("click", () => {
  commands = [];
  clearOutcome();
  render();
});
elements.loadDateButton.addEventListener("click", () => {
  loadDate(elements.dateInput.value || shanghaiDateKey(new Date()), { updateUrl: true });
});
elements.dateInput.addEventListener("change", () => {
  loadDate(elements.dateInput.value || shanghaiDateKey(new Date()), { updateUrl: true });
});
elements.copyButton.addEventListener("click", () => copyText(shareText || buildShareText(), elements.copyButton, "Copied"));
elements.copyLinkButton.addEventListener("click", () => copyText(getChallengeLink(), elements.copyLinkButton, "Link copied"));

document.addEventListener("keydown", (event) => {
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (["input", "textarea"].includes(activeTag)) return;

  const keyMap = {
    ArrowUp: "N",
    w: "N",
    W: "N",
    ArrowRight: "E",
    d: "E",
    D: "E",
    ArrowDown: "S",
    s: "S",
    S: "S",
    ArrowLeft: "W",
    a: "W",
    A: "W"
  };

  if (keyMap[event.key]) {
    event.preventDefault();
    addCommand(keyMap[event.key]);
  } else if (event.key === "Backspace") {
    event.preventDefault();
    commands.pop();
    clearOutcome();
    render();
  } else if (event.key === "Enter" && commands.length > 0) {
    event.preventDefault();
    runRoute({ animate: true });
  }
});

function loadDate(dateKey, { updateUrl } = { updateUrl: false }) {
  stopReplay();
  puzzle = createDailyRoute(dateKey);
  commands = [];
  clearOutcome();
  elements.dateInput.value = puzzle.dateKey;
  if (updateUrl) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("date", puzzle.dateKey);
    window.history.replaceState({}, "", nextUrl);
  }
  render();
}

function addCommand(dir) {
  if (animating || !Object.hasOwn(VECTORS, dir) || commands.length >= puzzle.maxCommands) return;
  commands.push(dir);
  clearOutcome();
  render();
}

function runRoute({ animate } = { animate: true }) {
  if (commands.length === 0) return null;
  stopReplay();
  outcome = simulateRoute(puzzle, commands);
  shareText = buildShareText(outcome);
  saveBest(outcome.score);

  if (!animate) {
    replayIndex = outcome.trail.length - 1;
    animating = false;
    render();
    return outcome;
  }

  replayIndex = 0;
  animating = true;
  render();
  replayTimer = window.setInterval(() => {
    replayIndex += 1;
    if (replayIndex >= outcome.trail.length - 1) {
      stopReplay({ keepOutcome: true });
    }
    render();
  }, 150);
  return outcome;
}

function stopReplay({ keepOutcome } = { keepOutcome: true }) {
  if (replayTimer) window.clearInterval(replayTimer);
  replayTimer = null;
  animating = false;
  if (!keepOutcome) outcome = null;
}

function clearOutcome() {
  stopReplay({ keepOutcome: false });
  replayIndex = 0;
  shareText = "";
}

function render() {
  renderHeader();
  renderBoard();
  renderQueue();
  renderControls();
  renderResult();
}

function renderHeader() {
  elements.dateChip.textContent = puzzle.dateKey;
  elements.routeName.textContent = puzzle.name;
  elements.sparkCount.textContent = `${puzzle.charges.length}`;
  elements.parCount.textContent = `${puzzle.par}`;
  elements.bestScore.textContent = `${getBest()}`;
  elements.moveCount.textContent = `${commands.length}/${puzzle.maxCommands}`;
}

function renderBoard() {
  const blockerKeys = new Set(puzzle.blockers.map((cell) => cellKey(cell.x, cell.y)));
  const chargeKeys = new Set(puzzle.charges.map((cell) => cellKey(cell.x, cell.y)));
  const visibleTrail = getVisibleTrail();
  const trailKeys = new Set(visibleTrail.map((cell) => cellKey(cell.x, cell.y)));
  const collectedKeys = new Set(visibleTrail.map((cell) => cellKey(cell.x, cell.y)).filter((key) => chargeKeys.has(key)));
  const active = visibleTrail[visibleTrail.length - 1] || puzzle.start;
  const crashKey = outcome?.crash && !animating && inBounds(outcome.crash.x, outcome.crash.y)
    ? cellKey(outcome.crash.x, outcome.crash.y)
    : null;

  elements.board.style.setProperty("--board-size", BOARD_SIZE);
  elements.board.innerHTML = "";

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const key = cellKey(x, y);
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = `${x}`;
      cell.dataset.y = `${y}`;
      cell.setAttribute("role", "gridcell");

      if (trailKeys.has(key)) cell.classList.add("trail");
      if (blockerKeys.has(key)) cell.classList.add("blocker");
      if (chargeKeys.has(key)) cell.classList.add("charge");
      if (collectedKeys.has(key)) cell.classList.add("collected");
      if (crashKey === key) cell.classList.add("crash");
      if (x === puzzle.start.x && y === puzzle.start.y) cell.classList.add("start");
      if (x === puzzle.goal.x && y === puzzle.goal.y) cell.classList.add("goal");
      if (x === active.x && y === active.y) cell.classList.add("active");

      cell.innerHTML = cellMarkup({
        isStart: x === puzzle.start.x && y === puzzle.start.y,
        isGoal: x === puzzle.goal.x && y === puzzle.goal.y,
        isBlocker: blockerKeys.has(key),
        isCharge: chargeKeys.has(key),
        isCollected: collectedKeys.has(key),
        isActive: x === active.x && y === active.y,
        isCrash: crashKey === key
      });
      elements.board.append(cell);
    }
  }

  const status = outcome ? resultStatus(outcome) : "Queue route commands, then run the shuttle.";
  elements.status.textContent = status;
}

function renderQueue() {
  elements.queue.innerHTML = "";
  if (commands.length === 0) {
    const empty = document.createElement("p");
    empty.className = "queue-empty";
    empty.textContent = "No commands queued";
    elements.queue.append(empty);
    return;
  }

  commands.forEach((dir, index) => {
    const chip = document.createElement("button");
    chip.className = "command-chip";
    chip.type = "button";
    chip.dataset.removeCommand = `${index}`;
    chip.setAttribute("aria-label", `Remove ${VECTORS[dir].label} command ${index + 1}`);
    chip.innerHTML = `${directionIcon(dir)}<span>${index + 1}</span>`;
    elements.queue.append(chip);
  });
}

function renderControls() {
  const commandFull = commands.length >= puzzle.maxCommands;
  for (const button of elements.directionButtons) {
    button.disabled = commandFull || animating;
  }
  elements.runButton.disabled = commands.length === 0 || animating;
  elements.undoButton.disabled = commands.length === 0 || animating;
  elements.resetButton.disabled = commands.length === 0 || animating;
  elements.copyButton.disabled = !outcome || animating;
}

function renderResult() {
  const showResult = Boolean(outcome && !animating);
  elements.resultPanel.hidden = !showResult;
  if (!showResult) return;

  const grade = gradeFor(outcome.score, puzzle.possibleScore);
  elements.resultTitle.textContent = outcome.docked ? "Docked" : "Route missed";
  elements.scoreValue.textContent = `${outcome.score}`;
  elements.resultMeta.textContent = [
    `${grade} grade`,
    `${outcome.collectedCount}/${puzzle.charges.length} sparks`,
    `${outcome.used} moves`,
    `${outcome.distance} cells away`
  ].join(" / ");
}

function getVisibleTrail() {
  if (!outcome) return [{ ...puzzle.start }];
  const lastIndex = animating ? replayIndex : outcome.trail.length - 1;
  return outcome.trail.slice(0, Math.max(1, lastIndex + 1));
}

function cellMarkup({ isStart, isGoal, isBlocker, isCharge, isCollected, isActive, isCrash }) {
  const parts = [];
  if (isBlocker) parts.push('<span class="block-core" aria-hidden="true"></span>');
  if (isCharge) parts.push(`<span class="spark ${isCollected ? "spark-collected" : ""}" aria-hidden="true"></span>`);
  if (isGoal) parts.push('<span class="dock-ring" aria-hidden="true"></span>');
  if (isStart) parts.push('<span class="start-pad" aria-hidden="true"></span>');
  if (isCrash) parts.push('<span class="crash-mark" aria-hidden="true"></span>');
  if (isActive) parts.push('<span class="shuttle" aria-hidden="true"></span>');
  return parts.join("");
}

function directionIcon(dir) {
  const rotation = { N: 0, E: 90, S: 180, W: 270 }[dir];
  return `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" style="transform: rotate(${rotation}deg)">
      <path d="M12 4 5 15h5v5h4v-5h5L12 4Z"></path>
    </svg>
  `;
}

function resultStatus(result) {
  if (animating) return "Running route replay.";
  if (result.docked) {
    return result.allCharges ? "Clean dock with every spark collected." : "Docked with sparks still on the board.";
  }
  if (result.status === "blocked") return "Blocked route: adjust the queue and rerun.";
  if (result.status === "edge") return "Edge route: turn before leaving the grid.";
  return "Route stopped short of the dock.";
}

function buildShareText(result = outcome) {
  if (!result) return "";
  return formatShareResult({
    dateKey: puzzle.dateKey,
    score: result.score,
    possibleScore: puzzle.possibleScore,
    grade: gradeFor(result.score, puzzle.possibleScore),
    docked: result.docked,
    collectedCount: result.collectedCount,
    totalCharges: puzzle.charges.length,
    used: result.used
  });
}

async function copyText(text, button, copiedLabel) {
  if (!text) return;
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = copiedLabel;
  } catch {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    button.textContent = original;
  }, 1100);
}

function getChallengeLink() {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("date", puzzle.dateKey);
  return nextUrl.href;
}

function getBest() {
  try {
    return Number(window.localStorage.getItem(bestKey()) || 0);
  } catch {
    return 0;
  }
}

function saveBest(score) {
  try {
    if (score > getBest()) window.localStorage.setItem(bestKey(), `${score}`);
  } catch {
    // Local storage is optional for this toy.
  }
}

function bestKey() {
  return `route-rush-best:${puzzle.dateKey}`;
}

window.RouteRush = {
  addCommand,
  createDailyRoute,
  getChallengeLink,
  getShareText: () => shareText || buildShareText(),
  getSolution: () => puzzle.solution.slice(),
  getState: () => ({
    dateKey: puzzle.dateKey,
    routeName: puzzle.name,
    commands: commands.slice(),
    maxCommands: puzzle.maxCommands,
    par: puzzle.par,
    possibleScore: puzzle.possibleScore,
    outcome,
    animating,
    boardCells: elements.board.querySelectorAll(".cell").length,
    resultOpen: !elements.resultPanel.hidden,
    shareText: shareText || buildShareText()
  }),
  loadDate,
  run: (options = { animate: false }) => runRoute(options),
  setCommands: (nextCommands) => {
    commands = nextCommands.filter((command) => Object.hasOwn(VECTORS, command)).slice(0, puzzle.maxCommands);
    clearOutcome();
    render();
  },
  simulateRoute,
  solveToday: () => {
    commands = puzzle.solution.slice();
    return runRoute({ animate: false });
  }
};

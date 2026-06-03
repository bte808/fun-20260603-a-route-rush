export const BOARD_SIZE = 7;
export const CHARGE_COUNT = 4;
export const MIN_ROUTE_STEPS = 11;
export const MAX_ROUTE_STEPS = 14;

export const VECTORS = {
  N: { dx: 0, dy: -1, label: "North" },
  E: { dx: 1, dy: 0, label: "East" },
  S: { dx: 0, dy: 1, label: "South" },
  W: { dx: -1, dy: 0, label: "West" }
};

export const DIRECTION_ORDER = ["N", "E", "S", "W"];

const ROUTE_NAMES = [
  "Sparkline",
  "Side Step",
  "Voltage",
  "Shortcut",
  "Switchback",
  "Relay",
  "Overpass",
  "Latch",
  "Glider",
  "Arcade"
];

export function createDailyRoute(dateKey = shanghaiDateKey(new Date())) {
  const normalizedDate = normalizeDateKey(dateKey);
  const seed = seedFromString(`route-rush:${normalizedDate}`);
  const rng = mulberry32(seed);
  const solutionRoute = generateSolutionRoute(rng);
  const routeKeys = new Set(solutionRoute.path.map((cell) => cellKey(cell.x, cell.y)));
  const charges = chooseCharges(solutionRoute.path, rng);
  const chargeKeys = new Set(charges.map((cell) => cellKey(cell.x, cell.y)));
  const blockers = chooseBlockers({ routeKeys, chargeKeys, rng });
  const maxCommands = Math.min(MAX_ROUTE_STEPS + 3, solutionRoute.commands.length + 3);
  const name = `${ROUTE_NAMES[Math.floor(rng() * ROUTE_NAMES.length)]} Route`;
  const puzzle = {
    dateKey: normalizedDate,
    name,
    boardSize: BOARD_SIZE,
    start: solutionRoute.path[0],
    goal: solutionRoute.path[solutionRoute.path.length - 1],
    solution: solutionRoute.commands,
    routeLength: solutionRoute.commands.length,
    maxCommands,
    charges,
    blockers,
    seed
  };
  const perfect = simulateRoute(puzzle, puzzle.solution);

  return {
    ...puzzle,
    possibleScore: perfect.score,
    par: puzzle.solution.length
  };
}

export function shanghaiDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function normalizeDateKey(dateKey) {
  if (typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return dateKey;
  }
  return shanghaiDateKey(new Date());
}

export function simulateRoute(puzzle, requestedCommands) {
  const commands = requestedCommands
    .slice(0, puzzle.maxCommands)
    .filter((command) => Object.hasOwn(VECTORS, command));
  const blockerKeys = new Set(puzzle.blockers.map((cell) => cellKey(cell.x, cell.y)));
  const chargeKeys = new Set(puzzle.charges.map((cell) => cellKey(cell.x, cell.y)));
  const collected = new Set();
  const trail = [{ ...puzzle.start, step: 0, command: null }];
  let x = puzzle.start.x;
  let y = puzzle.start.y;
  let status = "stopped";
  let crash = null;

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const vector = VECTORS[command];
    const nx = x + vector.dx;
    const ny = y + vector.dy;
    const nextKey = cellKey(nx, ny);

    if (!inBounds(nx, ny)) {
      status = "edge";
      crash = { x: nx, y: ny, step: index + 1, reason: "edge" };
      break;
    }

    if (blockerKeys.has(nextKey)) {
      status = "blocked";
      crash = { x: nx, y: ny, step: index + 1, reason: "blocked" };
      break;
    }

    x = nx;
    y = ny;
    if (chargeKeys.has(nextKey)) collected.add(nextKey);
    trail.push({ x, y, step: index + 1, command });

    if (sameCell({ x, y }, puzzle.goal)) {
      status = "docked";
      break;
    }
  }

  const docked = sameCell({ x, y }, puzzle.goal);
  if (docked) status = "docked";
  const collectedCount = collected.size;
  const distance = manhattan({ x, y }, puzzle.goal);
  const used = Math.max(0, trail.length - 1);
  const score = scoreOutcome({
    puzzle,
    collectedCount,
    distance,
    docked,
    used,
    crashed: Boolean(crash)
  });

  return {
    commands,
    trail,
    crash,
    status,
    docked,
    score,
    used,
    distance,
    collected: Array.from(collected),
    collectedCount,
    allCharges: collectedCount === puzzle.charges.length
  };
}

export function gradeFor(score, possibleScore) {
  const ratio = possibleScore > 0 ? score / possibleScore : 0;
  if (ratio >= 0.94) return "S";
  if (ratio >= 0.8) return "A";
  if (ratio >= 0.62) return "B";
  if (ratio >= 0.42) return "C";
  return "D";
}

export function formatShareResult({ dateKey, score, possibleScore, grade, docked, collectedCount, totalCharges, used }) {
  return [
    `Route Rush ${dateKey}`,
    `${grade} grade`,
    `${score}/${possibleScore} pts`,
    docked ? "docked" : "still routing",
    `${collectedCount}/${totalCharges} sparks`,
    `${used} moves`
  ].join(" - ");
}

export function cellKey(x, y) {
  return `${x},${y}`;
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
}

export function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function scoreOutcome({ puzzle, collectedCount, distance, docked, used, crashed }) {
  const moveScore = used * 16;
  const sparkScore = collectedCount * 135;
  const dockScore = docked ? 620 : Math.max(0, 180 - distance * 28);
  const fullSparkBonus = collectedCount === puzzle.charges.length ? 260 : 0;
  const efficiency = docked ? Math.max(0, 190 - Math.max(0, used - puzzle.routeLength) * 38) : 0;
  const crashPenalty = crashed ? 95 : 0;
  return Math.max(0, dockScore + sparkScore + moveScore + fullSparkBonus + efficiency - crashPenalty);
}

function generateSolutionRoute(rng) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const targetSteps = randomInt(rng, MIN_ROUTE_STEPS, MAX_ROUTE_STEPS);
    const startY = randomInt(rng, 0, BOARD_SIZE - 1);
    let x = 0;
    let y = startY;
    const path = [{ x, y }];
    const commands = [];
    const visited = new Set([cellKey(x, y)]);

    for (let column = 0; column < BOARD_SIZE - 1; column += 1) {
      const eastMovesLeft = BOARD_SIZE - 1 - column;

      while (commands.length + eastMovesLeft < targetSteps) {
        const verticalsStillNeeded = targetSteps - commands.length - eastMovesLeft;
        const futureColumns = BOARD_SIZE - 2 - column;
        const mustMove = verticalsStillNeeded > futureColumns * 2;
        if (!mustMove && rng() < 0.28) break;

        const dir = chooseVerticalDirection({ x, y, visited, rng });
        if (!dir) break;
        ({ x, y } = appendMove({ dir, x, y, path, commands, visited }));
      }

      ({ x, y } = appendMove({ dir: "E", x, y, path, commands, visited }));
    }

    while (commands.length < targetSteps) {
      const dir = chooseVerticalDirection({ x, y, visited, rng });
      if (!dir) break;
      ({ x, y } = appendMove({ dir, x, y, path, commands, visited }));
    }

    if (commands.length >= MIN_ROUTE_STEPS && commands.length <= MAX_ROUTE_STEPS) {
      return { path, commands };
    }
  }

  throw new Error("could not generate a playable route");
}

function appendMove({ dir, x, y, path, commands, visited }) {
  const vector = VECTORS[dir];
  const nx = x + vector.dx;
  const ny = y + vector.dy;
  if (!inBounds(nx, ny)) throw new Error(`invalid route move ${dir}`);
  const key = cellKey(nx, ny);
  if (visited.has(key)) throw new Error(`route revisited ${key}`);
  commands.push(dir);
  path.push({ x: nx, y: ny });
  visited.add(key);
  return { x: nx, y: ny };
}

function chooseVerticalDirection({ x, y, visited, rng }) {
  const options = [];
  if (y > 0 && !visited.has(cellKey(x, y - 1))) options.push("N");
  if (y < BOARD_SIZE - 1 && !visited.has(cellKey(x, y + 1))) options.push("S");
  return shuffle(options, rng)[0] || null;
}

function chooseCharges(path, rng) {
  const candidates = shuffle(path.slice(1, -1), rng);
  return candidates.slice(0, CHARGE_COUNT).sort((a, b) => a.y - b.y || a.x - b.x);
}

function chooseBlockers({ routeKeys, chargeKeys, rng }) {
  const candidates = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const key = cellKey(x, y);
      if (!routeKeys.has(key) && !chargeKeys.has(key)) candidates.push({ x, y });
    }
  }

  const count = 10 + randomInt(rng, 0, 3);
  return shuffle(candidates, rng).slice(0, count).sort((a, b) => a.y - b.y || a.x - b.x);
}

function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function shuffle(items, rng) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function seedFromString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function nextRandom() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

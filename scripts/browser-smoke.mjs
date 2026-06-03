import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url =
  process.env.ROUTE_RUSH_URL ||
  "http://localhost:5223/index.html?date=2026-06-03&v=browser-smoke";
const chromePath =
  process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = Number(process.env.CDP_PORT || await findFreePort());
const userDataDir = await mkdtemp(join(tmpdir(), "route-rush-chrome-"));

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-address=127.0.0.1",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  "about:blank"
], {
  stdio: "ignore"
});

try {
  await waitForChrome(port);
  const desktop = await runViewport({ width: 1280, height: 860, mobile: false });
  const mobile = await runViewport({ width: 390, height: 844, mobile: true });
  console.log(
    `browser smoke passed: desktop ${desktop.score} pts ${desktop.collectedCount}/4 sparks, ` +
      `mobile overflow ${mobile.scrollWidth}/${mobile.clientWidth}`
  );
} finally {
  chrome.kill("SIGTERM");
  await waitForExit(chrome);
  await rm(userDataDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 120 });
}

async function runViewport(viewport) {
  const target = await createTarget("about:blank");
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.mobile ? 2 : 1,
    mobile: viewport.mobile
  });
  await cdp.send("Page.navigate", { url });
  await cdp.waitFor("Page.loadEventFired", 10000);

  const loaded = await evaluate(cdp, `(() => {
    const root = document.documentElement;
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent,
      boardCells: document.querySelectorAll('.cell').length,
      dateValue: document.querySelector('#challenge-date')?.value,
      runDisabled: document.querySelector('#run-button')?.disabled,
      routeName: document.querySelector('#route-name')?.textContent,
      visibleBoard: visible('#board'),
      visibleControls: visible('.dir-pad'),
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth
    };

    function visible(selector) {
      const element = document.querySelector(selector);
      if (!element) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top < window.innerHeight;
    }
  })()`);

  if (
    loaded.title !== "Route Rush" ||
    loaded.h1 !== "Route Rush" ||
    loaded.boardCells !== 49 ||
    loaded.dateValue !== "2026-06-03" ||
    loaded.runDisabled !== true ||
    !loaded.routeName.endsWith("Route") ||
    !loaded.visibleBoard ||
    !loaded.visibleControls ||
    loaded.scrollWidth > loaded.clientWidth
  ) {
    throw new Error(`unexpected load state: ${JSON.stringify(loaded)}`);
  }

  await evaluate(cdp, `(() => {
    document.querySelector('[data-dir="E"]').click();
    document.querySelector('[data-dir="S"]').click();
    return window.RouteRush.getState();
  })()`);

  const queued = await evaluate(cdp, `window.RouteRush.getState()`);
  if (queued.commands.length !== 2 || documentState(queued).resultOpen) {
    throw new Error(`command queue failed: ${JSON.stringify(queued)}`);
  }

  const solved = await evaluate(cdp, `window.RouteRush.solveToday()`);
  const state = await evaluate(cdp, `(() => {
    const appState = window.RouteRush.getState();
    const root = document.documentElement;
    return {
      ...appState,
      score: appState.outcome.score,
      docked: appState.outcome.docked,
      collectedCount: appState.outcome.collectedCount,
      used: appState.outcome.used,
      resultOpen: !document.querySelector('#result-panel').hidden,
      copyDisabled: document.querySelector('#copy-button').disabled,
      shareText: window.RouteRush.getShareText(),
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      boardBox: rect('#board'),
      controlsBox: rect('.dir-pad')
    };

    function rect(selector) {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height), top: Math.round(box.top) };
    }
  })()`);

  if (!solved.docked || !state.docked || state.collectedCount !== 4 || state.score < 1400) {
    throw new Error(`solution did not finish: ${JSON.stringify(state)}`);
  }
  if (!state.resultOpen || state.copyDisabled) {
    throw new Error(`finished controls are wrong: ${JSON.stringify(state)}`);
  }
  if (
    !state.shareText.includes("Route Rush 2026-06-03") ||
    !state.shareText.includes("S grade") ||
    !state.shareText.includes("docked")
  ) {
    throw new Error(`share text is missing context: ${JSON.stringify(state)}`);
  }
  if (state.scrollWidth > state.clientWidth) {
    throw new Error(`horizontal overflow: ${JSON.stringify(state)}`);
  }
  if (state.boardBox.width < (viewport.mobile ? 300 : 440) || state.controlsBox.height < 120) {
    throw new Error(`main UI is not visible enough: ${JSON.stringify(state)}`);
  }

  await cdp.close();
  return state;
}

function documentState(state) {
  return {
    resultOpen: state.resultOpen
  };
}

async function waitForChrome(debugPort) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Chrome remote debugging port did not become ready");
}

async function fetchJson(requestUrl) {
  const response = await fetch(requestUrl);
  if (!response.ok) throw new Error(`${requestUrl} returned ${response.status}`);
  return response.json();
}

async function createTarget(targetUrl) {
  const requestUrl = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`;
  const response = await fetch(requestUrl, { method: "PUT" });
  if (!response.ok) throw new Error(`${requestUrl} returned ${response.status}`);
  return response.json();
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
      return;
    }

    const waiting = listeners.get(message.method);
    if (waiting) {
      listeners.delete(message.method);
      waiting.resolve(message.params || {});
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, 10000);
      });
    },
    waitFor(method, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(method);
          reject(new Error(`${method} timed out`));
        }, timeout);
        listeners.set(method, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          }
        });
      });
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function waitForExit(child) {
  await new Promise((resolve) => child.once("exit", resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const COLS = 19;
const ROWS = 13;
const PLAYER_STEP_MS = 120;
const KEY_COUNT = 3;

type Vec = { x: number; y: number };
type Status = "ready" | "playing" | "paused" | "won" | "lost";
type Key = Vec & { id: number };

type World = {
  grid: boolean[][];
  start: Vec;
  exit: Vec;
  ghostStart: Vec;
  keys: Key[];
};

const DIRS: Record<string, Vec> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const KEY_DIRS: Record<string, keyof typeof DIRS> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function generateWorld(): World {
  const grid: boolean[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => true),
  );
  const start: Vec = { x: 1, y: 1 };
  grid[start.y][start.x] = false;

  const stack: Vec[] = [start];
  const carveDirs: Vec[] = [
    { x: 0, y: -2 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    { x: -2, y: 0 },
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const candidates = shuffle(carveDirs)
      .map((d) => ({ x: current.x + d.x, y: current.y + d.y }))
      .filter(
        (n) =>
          n.x > 0 &&
          n.x < COLS - 1 &&
          n.y > 0 &&
          n.y < ROWS - 1 &&
          grid[n.y][n.x],
      );

    if (candidates.length === 0) {
      stack.pop();
      continue;
    }

    const next = candidates[0];
    grid[next.y][next.x] = false;
    grid[(current.y + next.y) / 2][(current.x + next.x) / 2] = false;
    stack.push(next);
  }

  for (let y = 1; y < ROWS - 1; y += 1) {
    for (let x = 1; x < COLS - 1; x += 1) {
      if (!grid[y][x]) continue;
      const horizontal = !grid[y][x - 1] && !grid[y][x + 1];
      const vertical = !grid[y - 1][x] && !grid[y + 1][x];
      if ((horizontal || vertical) && Math.random() < 0.16) {
        grid[y][x] = false;
      }
    }
  }

  const floors: Vec[] = [];
  for (let y = 1; y < ROWS - 1; y += 1) {
    for (let x = 1; x < COLS - 1; x += 1) {
      if (!grid[y][x]) floors.push({ x, y });
    }
  }

  const dist = distancesFrom(grid, start);
  let exit = start;
  let farthest = -1;
  for (const cell of floors) {
    const d = dist[cell.y][cell.x];
    if (d > farthest) {
      farthest = d;
      exit = cell;
    }
  }

  const pool = shuffle(
    floors.filter(
      (c) =>
        dist[c.y][c.x] > 2 &&
        !(c.x === exit.x && c.y === exit.y) &&
        !(c.x === start.x && c.y === start.y),
    ),
  );

  const keys: Key[] = [];
  for (const cell of pool) {
    if (keys.length >= KEY_COUNT) break;
    const spaced = keys.every(
      (k) => Math.abs(k.x - cell.x) + Math.abs(k.y - cell.y) >= 4,
    );
    if (spaced || keys.length === KEY_COUNT - 1) {
      keys.push({ ...cell, id: keys.length });
    }
  }
  let filler = 0;
  while (keys.length < KEY_COUNT && filler < pool.length) {
    keys.push({ ...pool[filler], id: keys.length });
    filler += 1;
  }

  return { grid, start, exit, ghostStart: exit, keys };
}

function distancesFrom(grid: boolean[][], from: Vec): number[][] {
  const dist = grid.map((row) => row.map(() => -1));
  const queue: Vec[] = [{ ...from }];
  dist[from.y][from.x] = 0;

  for (let i = 0; i < queue.length; i += 1) {
    const cell = queue[i];
    const steps = dist[cell.y][cell.x];
    for (const dir of Object.values(DIRS)) {
      const nx = cell.x + dir.x;
      const ny = cell.y + dir.y;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (grid[ny][nx]) continue;
      if (dist[ny][nx] !== -1) continue;
      dist[ny][nx] = steps + 1;
      queue.push({ x: nx, y: ny });
    }
  }

  return dist;
}

function hasLineOfSight(grid: boolean[][], a: Vec, b: Vec, maxSteps: number) {
  let x0 = a.x;
  let y0 = a.y;
  const x1 = b.x;
  const y1 = b.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let steps = 0;

  while (true) {
    if (x0 === x1 && y0 === y1) return steps <= maxSteps;
    if (steps > maxSteps) return false;
    if (!(x0 === a.x && y0 === a.y) && grid[y0][x0]) return false;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
    steps += 1;
  }
}

function formatTime(ms: number) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export default function AsylumEscape() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatusState] = useState<Status>("ready");
  const [keysCollected, setKeysCollected] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [bestMs, setBestMs] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [alerted, setAlerted] = useState(false);
  const [muted, setMuted] = useState(false);

  const statusRef = useRef<Status>("ready");
  const gridRef = useRef<boolean[][]>([]);
  const playerRef = useRef<Vec>({ x: 1, y: 1 });
  const ghostRef = useRef<Vec>({ x: 1, y: 1 });
  const keyRef = useRef<Key[]>([]);
  const exitRef = useRef<Vec>({ x: 1, y: 1 });
  const playerVisRef = useRef<Vec>({ x: 1, y: 1 });
  const ghostVisRef = useRef<Vec>({ x: 1, y: 1 });
  const playerAccRef = useRef(0);
  const ghostAccRef = useRef(0);
  const elapsedRef = useRef(0);
  const bestRef = useRef<number | null>(null);
  const alertRef = useRef(false);
  const heldRef = useRef<Set<string>>(new Set());
  const lastDirRef = useRef<keyof typeof DIRS | null>(null);
  const mutedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStatus = useCallback((next: Status) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const showToast = useCallback((message: string, ms = 1600) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);

  const tone = useCallback(
    (
      frequency: number,
      duration: number,
      type: OscillatorType = "sine",
      volume = 0.05,
      slideTo?: number,
    ) => {
      if (mutedRef.current) return;
      try {
        if (!audioRef.current) {
          audioRef.current = new AudioContext();
        }
        const ctx = audioRef.current;
        if (ctx.state === "suspended") void ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        if (slideTo) {
          osc.frequency.exponentialRampToValueAtTime(
            slideTo,
            ctx.currentTime + duration,
          );
        }
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          ctx.currentTime + duration,
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration + 0.02);
      } catch {
        // Audio is a nice-to-have; ignore failures.
      }
    },
    [],
  );

  const setupGame = useCallback(() => {
    const world = generateWorld();
    gridRef.current = world.grid;
    playerRef.current = { ...world.start };
    playerVisRef.current = { ...world.start };
    ghostRef.current = { ...world.ghostStart };
    ghostVisRef.current = { ...world.ghostStart };
    exitRef.current = { ...world.exit };
    keyRef.current = world.keys.map((k) => ({ ...k }));
    playerAccRef.current = 0;
    ghostAccRef.current = 0;
    elapsedRef.current = 0;
    alertRef.current = false;
    setAlerted(false);
    setKeysCollected(0);
    setElapsedMs(0);
    setStatus("ready");
    setToast(null);
  }, [setStatus]);

  const startGame = useCallback(() => {
    setupGame();
    setStatus("playing");
    tone(220, 0.18, "sawtooth", 0.04, 440);
  }, [setupGame, setStatus, tone]);

  const finish = useCallback(
    (won: boolean) => {
      if (statusRef.current !== "playing") return;
      const ms = elapsedRef.current;
      setElapsedMs(ms);
      if (won) {
        const currentBest = bestRef.current;
        if (currentBest === null || ms < currentBest) {
          bestRef.current = ms;
          setBestMs(ms);
          try {
            window.localStorage.setItem("madman-best", String(ms));
          } catch {
            // Storage may be unavailable.
          }
        }
        tone(523, 0.12, "triangle", 0.06);
        setTimeout(() => tone(659, 0.12, "triangle", 0.06), 110);
        setTimeout(() => tone(784, 0.22, "triangle", 0.06), 220);
      } else {
        tone(180, 0.4, "sawtooth", 0.06, 60);
      }
      setStatus(won ? "won" : "lost");
    },
    [setStatus, tone],
  );

  const pressDir = useCallback((dir: keyof typeof DIRS) => {
    heldRef.current.add(dir);
    lastDirRef.current = dir;
  }, []);

  const releaseDir = useCallback((dir: keyof typeof DIRS) => {
    heldRef.current.delete(dir);
  }, []);

  const togglePause = useCallback(() => {
    if (statusRef.current === "playing") {
      setStatus("paused");
    } else if (statusRef.current === "paused") {
      setStatus("playing");
    }
  }, [setStatus]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("madman-best");
      if (stored) {
        const value = Number(stored);
        if (Number.isFinite(value) && value > 0) {
          bestRef.current = value;
          // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted best time after mount
          setBestMs(value);
        }
      }
    } catch {
      // Storage may be unavailable.
    }
  }, []);

  useEffect(() => {
    if (status !== "playing") return;
    const id = window.setInterval(() => {
      setElapsedMs(elapsedRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = KEY_DIRS[event.code];
      if (dir) {
        event.preventDefault();
        pressDir(dir);
        return;
      }
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        if (statusRef.current === "ready") {
          startGame();
        } else if (statusRef.current === "paused") {
          setStatus("playing");
        } else if (
          statusRef.current === "won" ||
          statusRef.current === "lost"
        ) {
          startGame();
        }
        return;
      }
      if (event.code === "KeyP" || event.code === "Escape") {
        event.preventDefault();
        togglePause();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const dir = KEY_DIRS[event.code];
      if (dir) {
        event.preventDefault();
        releaseDir(dir);
      }
    };

    const onBlur = () => {
      heldRef.current.clear();
      lastDirRef.current = null;
      if (statusRef.current === "playing") {
        setStatus("paused");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [pressDir, releaseDir, setStatus, startGame, togglePause]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    setupGame();

    let raf = 0;
    let lastFrame = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const heldDirection = (): keyof typeof DIRS | null => {
      const last = lastDirRef.current;
      if (last && heldRef.current.has(last)) return last;
      for (const dir of Object.keys(DIRS) as (keyof typeof DIRS)[]) {
        if (heldRef.current.has(dir)) return dir;
      }
      return null;
    };

    const stepPlayer = (dir: Vec) => {
      const grid = gridRef.current;
      const player = playerRef.current;
      const nx = player.x + dir.x;
      const ny = player.y + dir.y;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return;
      if (grid[ny][nx]) return;

      playerRef.current = { x: nx, y: ny };

      const keyIndex = keyRef.current.findIndex(
        (k) => k.x === nx && k.y === ny,
      );
      if (keyIndex !== -1) {
        keyRef.current.splice(keyIndex, 1);
        setKeysCollected(KEY_COUNT - keyRef.current.length);
        tone(900, 0.12, "triangle", 0.06, 1320);
        if (keyRef.current.length === 0) {
          showToast("THE GATE IS OPEN — RUN", 2200);
          tone(1200, 0.25, "sine", 0.05, 1600);
        } else {
          showToast(`Key found — ${keyRef.current.length} left`);
        }
      }

      const ghost = ghostRef.current;
      if (ghost.x === nx && ghost.y === ny) {
        finish(false);
        return;
      }

      const exit = exitRef.current;
      if (nx === exit.x && ny === exit.y) {
        if (keyRef.current.length === 0) {
          finish(true);
        } else {
          showToast(`Locked — ${keyRef.current.length} key(s) missing`);
          tone(110, 0.14, "square", 0.04);
        }
      }
    };

    const stepGhost = () => {
      const player = playerRef.current;
      const ghost = ghostRef.current;
      const dist = distancesFrom(gridRef.current, player);

      let best: Vec | null = null;
      let bestScore = Infinity;
      for (const dir of Object.values(DIRS)) {
        const nx = ghost.x + dir.x;
        const ny = ghost.y + dir.y;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        if (gridRef.current[ny][nx]) continue;
        const score = dist[ny][nx];
        if (score !== -1 && score < bestScore) {
          bestScore = score;
          best = { x: nx, y: ny };
        }
      }

      if (best) {
        ghostRef.current = best;
        if (best.x === player.x && best.y === player.y) {
          finish(false);
        }
      }
    };

    const update = (dt: number) => {
      if (statusRef.current !== "playing") {
        const ease = 1 - Math.exp(-dt / 60);
        playerVisRef.current = {
          x: playerVisRef.current.x +
            (playerRef.current.x - playerVisRef.current.x) * ease,
          y: playerVisRef.current.y +
            (playerRef.current.y - playerVisRef.current.y) * ease,
        };
        ghostVisRef.current = {
          x:
            ghostVisRef.current.x +
            (ghostRef.current.x - ghostVisRef.current.x) * ease,
          y:
            ghostVisRef.current.y +
            (ghostRef.current.y - ghostVisRef.current.y) * ease,
        };
        return;
      }

      elapsedRef.current += dt;

      const dir = heldDirection();
      playerAccRef.current += dt;
      if (dir && playerAccRef.current >= PLAYER_STEP_MS) {
        playerAccRef.current -= PLAYER_STEP_MS;
        stepPlayer(DIRS[dir]);
        if (statusRef.current !== "playing") {
          return;
        }
      }

      const keysLeft = keyRef.current.length;
      const collected = KEY_COUNT - keysLeft;
      let ghostInterval = 240 - collected * 20;
      if (alertRef.current) ghostInterval -= 20;
      ghostAccRef.current += dt;
      if (ghostAccRef.current >= ghostInterval) {
        ghostAccRef.current -= ghostInterval;
        stepGhost();
        if (statusRef.current !== "playing") {
          return;
        }
      }

      const ease = 1 - Math.exp(-dt / 60);
      playerVisRef.current = {
        x:
          playerVisRef.current.x +
          (playerRef.current.x - playerVisRef.current.x) * ease,
        y:
          playerVisRef.current.y +
          (playerRef.current.y - playerVisRef.current.y) * ease,
      };
      ghostVisRef.current = {
        x:
          ghostVisRef.current.x +
          (ghostRef.current.x - ghostVisRef.current.x) * ease,
        y:
          ghostVisRef.current.y +
          (ghostRef.current.y - ghostVisRef.current.y) * ease,
      };

      const ghost = ghostRef.current;
      const player = playerRef.current;
      const dx = Math.abs(ghost.x - player.x);
      const dy = Math.abs(ghost.y - player.y);
      const visible =
        dx + dy <= 10 &&
        hasLineOfSight(gridRef.current, player, ghost, 8);
      if (visible !== alertRef.current) {
        alertRef.current = visible;
        setAlerted(visible);
        if (visible) tone(70, 0.09, "square", 0.025);
      }
    };

    const drawKey = (
      x: number,
      y: number,
      size: number,
      time: number,
      alpha = 1,
    ) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      const bob = Math.sin(time / 320 + x * 1.7 + y) * size * 0.08;
      const cx = x + size / 2;
      const cy = y + size / 2 + bob;
      ctx.shadowColor = "rgba(245, 200, 90, 0.9)";
      ctx.shadowBlur = size * 0.55;
      ctx.fillStyle = "#f5c85a";
      ctx.beginPath();
      ctx.arc(
        cx - size * 0.12,
        cy - size * 0.14,
        size * 0.16,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.strokeStyle = "#f5c85a";
      ctx.lineWidth = Math.max(1.5, size * 0.09);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.02, cy - size * 0.08);
      ctx.lineTo(cx + size * 0.24, cy + size * 0.16);
      ctx.moveTo(cx + size * 0.12, cy + size * 0.02);
      ctx.lineTo(cx + size * 0.22, cy - size * 0.06);
      ctx.moveTo(cx + size * 0.18, cy + size * 0.09);
      ctx.lineTo(cx + size * 0.28, cy + size * 0.01);
      ctx.stroke();
      ctx.restore();
    };

    const render = (time: number) => {
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth === 0 || cssHeight === 0) return;

      const dpr = canvas.width / cssWidth;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const grid = gridRef.current;
      if (grid.length === 0) return;

      const tile = Math.min(cssWidth / COLS, cssHeight / ROWS);
      const ox = (cssWidth - tile * COLS) / 2;
      const oy = (cssHeight - tile * ROWS) / 2;

      ctx.fillStyle = "#07060a";
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          const px = ox + x * tile;
          const py = oy + y * tile;
          if (grid[y][x]) {
            ctx.fillStyle = (x + y) % 2 === 0 ? "#241d2e" : "#221b2b";
            ctx.fillRect(px, py, tile + 0.5, tile + 0.5);
            ctx.fillStyle = "rgba(255,255,255,0.05)";
            ctx.fillRect(px, py, tile + 0.5, Math.max(1, tile * 0.06));
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(
              px,
              py + tile - Math.max(1, tile * 0.06),
              tile + 0.5,
              Math.max(1, tile * 0.06),
            );
          } else {
            ctx.fillStyle = (x + y) % 2 === 0 ? "#121019" : "#100e16";
            ctx.fillRect(px, py, tile + 0.5, tile + 0.5);
            ctx.fillStyle = "rgba(255,255,255,0.018)";
            ctx.fillRect(px, py, tile + 0.5, 1);
          }
        }
      }

      const exit = exitRef.current;
      const ex = ox + exit.x * tile;
      const ey = oy + exit.y * tile;
      const unlocked = keyRef.current.length === 0;
      const glow = 0.5 + 0.5 * Math.sin(time / 400);
      ctx.fillStyle = unlocked ? "#12452c" : "#3a1520";
      ctx.fillRect(ex + tile * 0.12, ey + tile * 0.12, tile * 0.76, tile * 0.76);
      ctx.strokeStyle = unlocked
        ? `rgba(80, 240, 150, ${0.55 + glow * 0.4})`
        : `rgba(230, 90, 90, ${0.4 + glow * 0.3})`;
      ctx.lineWidth = Math.max(1.5, tile * 0.07);
      ctx.strokeRect(
        ex + tile * 0.12,
        ey + tile * 0.12,
        tile * 0.76,
        tile * 0.76,
      );
      if (!unlocked) {
        ctx.strokeStyle = "rgba(230, 120, 120, 0.75)";
        ctx.lineWidth = Math.max(1, tile * 0.05);
        for (let i = 1; i <= 3; i += 1) {
          const bx = ex + (tile * i) / 4;
          ctx.beginPath();
          ctx.moveTo(bx, ey + tile * 0.14);
          ctx.lineTo(bx, ey + tile * 0.86);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = `rgba(120, 255, 180, ${0.25 + glow * 0.35})`;
        ctx.font = `600 ${Math.round(tile * 0.3)}px "Geist Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("EXIT", ex + tile / 2, ey + tile / 2);
      }

      for (const key of keyRef.current) {
        drawKey(ox + key.x * tile, oy + key.y * tile, tile, time);
      }

      const ghost = ghostVisRef.current;
      const gx = ox + (ghost.x + 0.5) * tile;
      const gy = oy + (ghost.y + 0.5) * tile;
      const ghostGlow = ctx.createRadialGradient(gx, gy, 0, gx, gy, tile * 1.6);
      ghostGlow.addColorStop(0, "rgba(220, 50, 60, 0.5)");
      ghostGlow.addColorStop(1, "rgba(220, 50, 60, 0)");
      ctx.fillStyle = ghostGlow;
      ctx.fillRect(gx - tile * 1.6, gy - tile * 1.6, tile * 3.2, tile * 3.2);

      const bob = Math.sin(time / 260) * tile * 0.05;
      ctx.fillStyle = "#c73545";
      ctx.beginPath();
      ctx.arc(gx, gy + bob, tile * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#14080c";
      ctx.beginPath();
      ctx.arc(gx - tile * 0.12, gy + bob - tile * 0.05, tile * 0.055, 0, Math.PI * 2);
      ctx.arc(gx + tile * 0.12, gy + bob - tile * 0.05, tile * 0.055, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#14080c";
      ctx.lineWidth = Math.max(1, tile * 0.05);
      ctx.beginPath();
      for (let i = 0; i <= 4; i += 1) {
        const sx = gx - tile * 0.16 + (i * tile * 0.32) / 4;
        const sy = gy + bob + tile * 0.1 + (i % 2 === 0 ? 0 : tile * 0.04);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      if (alertRef.current) {
        ctx.fillStyle = "#ff5a5a";
        ctx.font = `700 ${Math.round(tile * 0.45)}px "Geist Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("!", gx, gy - tile * 0.5 + bob);
      }

      const player = playerVisRef.current;
      const px = ox + (player.x + 0.5) * tile;
      const py = oy + (player.y + 0.5) * tile;
      const aura = ctx.createRadialGradient(px, py, 0, px, py, tile * 1.9);
      aura.addColorStop(0, "rgba(150, 230, 255, 0.32)");
      aura.addColorStop(1, "rgba(150, 230, 255, 0)");
      ctx.fillStyle = aura;
      ctx.fillRect(px - tile * 1.9, py - tile * 1.9, tile * 3.8, tile * 3.8);
      ctx.fillStyle = "#d8f4ff";
      ctx.beginPath();
      ctx.arc(px, py, tile * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7fe6ff";
      ctx.beginPath();
      ctx.arc(px, py, tile * 0.14, 0, Math.PI * 2);
      ctx.fill();

      const darkness = ctx.createRadialGradient(
        px,
        py,
        tile * 1.1,
        px,
        py,
        tile * 6.4,
      );
      darkness.addColorStop(0, "rgba(2, 1, 5, 0)");
      darkness.addColorStop(0.45, "rgba(2, 1, 5, 0.12)");
      darkness.addColorStop(0.75, "rgba(2, 1, 5, 0.6)");
      darkness.addColorStop(1, "rgba(2, 1, 5, 0.94)");
      ctx.fillStyle = darkness;
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      for (const key of keyRef.current) {
        drawKey(ox + key.x * tile, oy + key.y * tile, tile, time, 0.5);
      }
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.2 * glow;
      ctx.shadowColor = unlocked ? "rgba(80, 240, 150, 0.8)" : "rgba(230, 80, 80, 0.6)";
      ctx.shadowBlur = tile * 0.7;
      ctx.strokeStyle = unlocked ? "#4dfca0" : "#e06060";
      ctx.lineWidth = Math.max(1, tile * 0.05);
      ctx.strokeRect(
        ex + tile * 0.2,
        ey + tile * 0.2,
        tile * 0.6,
        tile * 0.6,
      );
      ctx.restore();

      const ghostDx = ghost.x - player.x;
      const ghostDy = ghost.y - player.y;
      const ghostDistance = Math.hypot(ghostDx, ghostDy);
      if (ghostDistance < 5) {
        const intensity = (1 - ghostDistance / 5) * 0.42;
        const danger = ctx.createRadialGradient(
          cssWidth / 2,
          cssHeight / 2,
          Math.min(cssWidth, cssHeight) * 0.2,
          cssWidth / 2,
          cssHeight / 2,
          Math.max(cssWidth, cssHeight) * 0.72,
        );
        danger.addColorStop(0, "rgba(120, 0, 0, 0)");
        danger.addColorStop(
          1,
          `rgba(150, 0, 10, ${intensity + 0.08 * Math.sin(time / 180)})`,
        );
        ctx.fillStyle = danger;
        ctx.fillRect(0, 0, cssWidth, cssHeight);
      }

      if (statusRef.current === "playing") {
        const ghostMarkerX = ox + (ghost.x + 0.5) * tile;
        const ghostMarkerY = oy + (ghost.y + 0.5) * tile;
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(time / 300);
        ctx.fillStyle = "#ff3b4e";
        ctx.beginPath();
        ctx.arc(ghostMarkerX, ghostMarkerY, Math.max(1.5, tile * 0.07), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(now - lastFrame, 100);
      lastFrame = now;
      update(dt);
      render(now);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [finish, setStatus, setupGame, showToast, tone]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const overlay = (() => {
    if (status === "ready") {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#07060a]/82 px-6 text-center backdrop-blur-[3px]">
          <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-red-400/80">
            Ward 13 · 03:00 AM
          </p>
          <h2 className="text-4xl font-black uppercase tracking-[0.18em] text-zinc-100 sm:text-5xl">
            Asylum
            <span className="block bg-gradient-to-r from-red-500 via-rose-300 to-red-600 bg-clip-text text-transparent">
              Escape
            </span>
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-zinc-400">
            He hears every step. Gather{" "}
            <span className="font-semibold text-amber-300">3 keys</span>, avoid
            the madman, and reach the glowing gate.
          </p>
          <button
            type="button"
            onClick={startGame}
            className="group relative rounded-full bg-red-600 px-9 py-3 text-xs font-bold uppercase tracking-[0.3em] text-white shadow-[0_0_40px_-8px_rgba(239,68,68,0.9)] transition hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-400"
          >
            Enter the ward
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
            WASD / Arrows · P to pause
          </p>
        </div>
      );
    }

    if (status === "paused") {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#07060a]/80 backdrop-blur-sm">
          <p className="text-2xl font-black uppercase tracking-[0.3em] text-zinc-200">
            Paused
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
            He is still coming
          </p>
          <button
            type="button"
            onClick={togglePause}
            className="rounded-full border border-zinc-600 px-8 py-2.5 text-xs font-bold uppercase tracking-[0.3em] text-zinc-200 transition hover:border-zinc-300 hover:text-white"
          >
            Resume
          </button>
        </div>
      );
    }

    if (status === "won" || status === "lost") {
      const won = status === "won";
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#07060a]/85 px-6 text-center backdrop-blur-sm">
          <p
            className={`font-mono text-[10px] uppercase tracking-[0.5em] ${
              won ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {won ? "Ward cleared" : "He found you"}
          </p>
          <h2
            className={`text-4xl font-black uppercase tracking-[0.14em] sm:text-5xl ${
              won ? "text-emerald-300" : "text-red-400"
            }`}
          >
            {won ? "Escaped" : "Caught"}
          </h2>
          <div className="flex items-center gap-6 font-mono text-xs text-zinc-400">
            <span>
              TIME{" "}
              <span className="text-zinc-100">{formatTime(elapsedMs)}</span>
            </span>
            <span>
              BEST{" "}
              <span className="text-zinc-100">
                {bestMs === null ? "—" : formatTime(bestMs)}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={startGame}
            className="mt-2 rounded-full bg-red-600 px-9 py-3 text-xs font-bold uppercase tracking-[0.3em] text-white shadow-[0_0_40px_-8px_rgba(239,68,68,0.9)] transition hover:bg-red-500"
          >
            Run again
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
            Press space to restart
          </p>
        </div>
      );
    }

    return null;
  })();

  return (
    <div className="mx-auto w-full max-w-[min(64rem,calc((100dvh-13rem)*19/13))]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.55em] text-red-500/80">
            Madman
          </p>
          <h1 className="mt-1 text-2xl font-black uppercase tracking-[0.2em] text-zinc-100 sm:text-3xl">
            Asylum<span className="text-red-500"> Escape</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2">
            <span className="mr-1 hidden font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500 sm:inline">
              Keys
            </span>
            {Array.from({ length: KEY_COUNT }).map((_, index) => (
              <span
                key={index}
                className={`h-2.5 w-2.5 rotate-45 rounded-[2px] transition ${
                  index < keysCollected
                    ? "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.8)]"
                    : "bg-zinc-700"
                }`}
              />
            ))}
          </div>
          <div className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-xs tabular-nums text-zinc-200">
            {formatTime(elapsedMs)}
          </div>
          <div className="hidden rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500 sm:block">
            Best{" "}
            <span className="text-zinc-300">
              {bestMs === null ? "—" : formatTime(bestMs)}
            </span>
          </div>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
          >
            {muted ? "Muted" : "Sound"}
          </button>
          <button
            type="button"
            onClick={togglePause}
            aria-label={status === "paused" ? "Resume" : "Pause"}
            className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
          >
            {status === "paused" ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-black shadow-[0_30px_120px_-30px_rgba(220,38,38,0.35)]">
        <div className="relative aspect-[19/13] w-full">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full touch-none"
            aria-label="Asylum Escape maze"
          />

          {alerted && status === "playing" ? (
            <div className="pointer-events-none absolute inset-0 border-2 border-red-600/50 [animation:danger-pulse_1.4s_ease-in-out_infinite]" />
          ) : null}

          {toast ? (
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
              <div className="rounded-full border border-zinc-700/70 bg-black/80 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-200 backdrop-blur">
                {toast}
              </div>
            </div>
          ) : null}

          {overlay}
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div className="grid grid-cols-3 gap-1.5 sm:hidden">
          <span />
          <button
            type="button"
            aria-label="Move up"
            onPointerDown={(event) => {
              event.preventDefault();
              pressDir("up");
            }}
            onPointerUp={() => releaseDir("up")}
            onPointerLeave={() => releaseDir("up")}
            onPointerCancel={() => releaseDir("up")}
            className="flex h-12 w-14 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-lg text-zinc-300 active:border-red-500 active:text-red-300"
          >
            ↑
          </button>
          <span />
          <button
            type="button"
            aria-label="Move left"
            onPointerDown={(event) => {
              event.preventDefault();
              pressDir("left");
            }}
            onPointerUp={() => releaseDir("left")}
            onPointerLeave={() => releaseDir("left")}
            onPointerCancel={() => releaseDir("left")}
            className="flex h-12 w-14 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-lg text-zinc-300 active:border-red-500 active:text-red-300"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Move down"
            onPointerDown={(event) => {
              event.preventDefault();
              pressDir("down");
            }}
            onPointerUp={() => releaseDir("down")}
            onPointerLeave={() => releaseDir("down")}
            onPointerCancel={() => releaseDir("down")}
            className="flex h-12 w-14 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-lg text-zinc-300 active:border-red-500 active:text-red-300"
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="Move right"
            onPointerDown={(event) => {
              event.preventDefault();
              pressDir("right");
            }}
            onPointerUp={() => releaseDir("right")}
            onPointerLeave={() => releaseDir("right")}
            onPointerCancel={() => releaseDir("right")}
            className="flex h-12 w-14 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-lg text-zinc-300 active:border-red-500 active:text-red-300"
          >
            →
          </button>
        </div>

        <p className="hidden max-w-md font-mono text-[10px] uppercase leading-relaxed tracking-[0.18em] text-zinc-600 sm:block">
          WASD / arrows to move · P or Esc to pause · Collect 3 keys, then reach
          the gate. If the madman sees you, he moves faster.
        </p>

        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              alerted ? "bg-red-500" : "bg-emerald-500"
            }`}
          />
          {alerted ? "He sees you" : "Hidden"}
        </div>
      </div>
    </div>
  );
}

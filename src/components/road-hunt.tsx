"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ROAD_MAX = 16;
const LANES = [2, 6, 10, 14];
const CAR_W = 2.2;
const CAR_L = 4.2;
const MAX_SPEED = 52;
const ACCEL = 20;
const BRAKE = 34;
const DRAG = 4;
const MAX_DAMAGE = 4;
const ESCAPE_GAP = 140;
const METERS_PER_UNIT = 8;
const BEST_KEY = "madman-road-hunt-best";

type Status = "ready" | "playing" | "paused" | "won" | "lost";
type LossReason = "wrecked" | "escaped";
type Action = "accel" | "brake" | "left" | "right";

type Player = {
  x: number;
  y: number;
  speed: number;
  damage: number;
  invulnUntil: number;
  steer: number;
};

type Target = {
  x: number;
  y: number;
  speed: number;
  lane: number;
  nextLaneAt: number;
};

type TrafficCar = {
  x: number;
  y: number;
  speed: number;
  width: number;
  length: number;
  color: string;
  roof: string;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

type Shake = {
  amount: number;
  until: number;
};

const TRAFFIC_COLORS: Array<[string, string]> = [
  ["#d8d3c5", "#b9b3a3"],
  ["#6b7f96", "#55677b"],
  ["#8f4a42", "#733a34"],
  ["#4f6b4b", "#3d5439"],
  ["#c9a45c", "#ab8a49"],
  ["#3b3d45", "#2c2e34"],
  ["#a9b7c4", "#8b98a5"],
];

const ACTION_KEYS: Record<string, Action> = {
  ArrowUp: "accel",
  KeyW: "accel",
  ArrowDown: "brake",
  KeyS: "brake",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hash(n: number) {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function formatTime(ms: number) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function carOverlap(
  ax: number,
  ay: number,
  aw: number,
  al: number,
  bx: number,
  by: number,
  bw: number,
  bl: number,
) {
  return Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(ay - by) < (al + bl) / 2;
}

function createTrafficCar(lane: number, y: number, speed: number): TrafficCar {
  const [color, roof] =
    TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)];
  const truck = Math.random() < 0.14;
  return {
    x: LANES[lane],
    y,
    speed,
    width: truck ? 2.6 : CAR_W,
    length: truck ? 6.4 : CAR_L,
    color,
    roof,
  };
}

export default function RoadHunt() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatusState] = useState<Status>("ready");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [bestMs, setBestMs] = useState<number | null>(null);
  const [hud, setHud] = useState({ speed: 0, gap: 0, damage: 0 });
  const [lossReason, setLossReason] = useState<LossReason>("escaped");
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const statusRef = useRef<Status>("ready");
  const playerRef = useRef<Player>({
    x: 6,
    y: 0,
    speed: 38,
    damage: 0,
    invulnUntil: 0,
    steer: 0,
  });
  const targetRef = useRef<Target>({
    x: 10,
    y: 40,
    speed: 38,
    lane: 2,
    nextLaneAt: 2200,
  });
  const trafficRef = useRef<TrafficCar[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef<Shake>({ amount: 0, until: 0 });
  const spawnCursorRef = useRef(28);
  const elapsedRef = useRef(0);
  const bestRef = useRef<number | null>(null);
  const heldRef = useRef<Set<Action>>(new Set());
  const mutedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railCooldownRef = useRef(0);
  const overshootRef = useRef(false);

  const setStatus = useCallback((next: Status) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const showToast = useCallback((message: string, ms = 1500) => {
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
        if (!audioRef.current) audioRef.current = new AudioContext();
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
        // Audio is optional.
      }
    },
    [],
  );

  const setupGame = useCallback(() => {
    playerRef.current = {
      x: 6,
      y: 0,
      speed: 38,
      damage: 0,
      invulnUntil: 0,
      steer: 0,
    };
    targetRef.current = {
      x: 10,
      y: 40,
      speed: 38,
      lane: 2,
      nextLaneAt: 2200,
    };
    trafficRef.current = [];
    particlesRef.current = [];
    shakeRef.current = { amount: 0, until: 0 };
    spawnCursorRef.current = 30;
    elapsedRef.current = 0;
    railCooldownRef.current = 0;
    overshootRef.current = false;
    setLossReason("escaped");

    for (let y = 22; y < 76; y += 11 + Math.random() * 6) {
      const lane =
        Math.abs(y - 40) < 9
          ? [0, 1, 3][Math.floor(Math.random() * 3)]
          : Math.floor(Math.random() * LANES.length);
      trafficRef.current.push(
        createTrafficCar(lane, y, 22 + Math.random() * 10),
      );
    }

    setElapsedMs(0);
    setHud({ speed: 137, gap: 40 * METERS_PER_UNIT, damage: 0 });
    setStatus("ready");
    setToast(null);
  }, [setStatus]);

  const startGame = useCallback(() => {
    setupGame();
    setStatus("playing");
    tone(140, 0.25, "sawtooth", 0.05, 60);
  }, [setupGame, setStatus, tone]);

  const finish = useCallback(
    (won: boolean, reason: LossReason = "escaped") => {
      if (statusRef.current !== "playing") return;
      const ms = elapsedRef.current;
      setElapsedMs(ms);
      if (won) {
        const currentBest = bestRef.current;
        if (currentBest === null || ms < currentBest) {
          bestRef.current = ms;
          setBestMs(ms);
          try {
            window.localStorage.setItem(BEST_KEY, String(ms));
          } catch {
            // Storage may be unavailable.
          }
        }
        tone(392, 0.12, "triangle", 0.06);
        setTimeout(() => tone(523, 0.12, "triangle", 0.06), 110);
        setTimeout(() => tone(659, 0.2, "triangle", 0.06), 220);
      } else {
        setLossReason(reason);
        tone(170, 0.45, "sawtooth", 0.06, 55);
      }
      setStatus(won ? "won" : "lost");
    },
    [setStatus, tone],
  );

  const press = useCallback((action: Action) => {
    heldRef.current.add(action);
  }, []);

  const release = useCallback((action: Action) => {
    heldRef.current.delete(action);
  }, []);

  const togglePause = useCallback(() => {
    if (statusRef.current === "playing") {
      setStatus("paused");
    } else if (statusRef.current === "paused") {
      setStatus("playing");
    }
  }, [setStatus]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(BEST_KEY);
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
      const player = playerRef.current;
      const target = targetRef.current;
      setElapsedMs(elapsedRef.current);
      setHud({
        speed: Math.round(player.speed * 3.6),
        gap: Math.round((target.y - player.y) * METERS_PER_UNIT),
        damage: player.damage,
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = ACTION_KEYS[event.code];
      if (action) {
        event.preventDefault();
        press(action);
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
      const action = ACTION_KEYS[event.code];
      if (action) {
        event.preventDefault();
        release(action);
      }
    };

    const onBlur = () => {
      heldRef.current.clear();
      if (statusRef.current === "playing") setStatus("paused");
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [press, release, setStatus, startGame, togglePause]);

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

    const spawnSparks = (x: number, y: number, count: number) => {
      for (let i = 0; i < count; i += 1) {
        const life = 240 + Math.random() * 280;
        particlesRef.current.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 16,
          vy: (Math.random() - 0.5) * 16,
          life,
          maxLife: life,
          color: Math.random() < 0.5 ? "#ffd36b" : "#ff8a4c",
          size: 0.1 + Math.random() * 0.22,
        });
      }
    };

    const spawnTraffic = () => {
      const player = playerRef.current;
      const target = targetRef.current;
      while (spawnCursorRef.current < player.y + 80) {
        const spawnY = spawnCursorRef.current;
        const available = LANES.map((_, index) => index).filter((lane) => {
          const laneX = LANES[lane];
          const blocked = trafficRef.current.some(
            (car) =>
              Math.abs(car.x - laneX) < 2.4 && Math.abs(car.y - spawnY) < 9,
          );
          const targetBlocked =
            Math.abs(target.x - laneX) < 2.4 &&
            Math.abs(target.y - spawnY) < 9;
          return !blocked && !targetBlocked;
        });
        if (available.length === 0) {
          spawnCursorRef.current += 3;
          continue;
        }
        const lane = available[Math.floor(Math.random() * available.length)];
        const slow = Math.random() < 0.18;
        trafficRef.current.push(
          createTrafficCar(
            lane,
            spawnY,
            slow ? 17 + Math.random() * 5 : 22 + Math.random() * 11,
          ),
        );
        spawnCursorRef.current += 8 + Math.random() * 13;
      }
      if (trafficRef.current.length > 26) {
        trafficRef.current.splice(0, trafficRef.current.length - 26);
      }
    };

    const updateTraffic = (dt: number) => {
      const player = playerRef.current;
      for (const car of trafficRef.current) {
        car.y += car.speed * dt;
      }
      trafficRef.current = trafficRef.current.filter(
        (car) => car.y > player.y - 22,
      );
    };

    const updateTarget = (dt: number) => {
      const player = playerRef.current;
      const target = targetRef.current;
      const gap = target.y - player.y;

      let desired = 38 + Math.sin(elapsedRef.current / 1000) * 2.5;
      if (gap < 15) desired = 50;
      else if (gap > 55) desired = 34;

      for (const car of trafficRef.current) {
        if (
          Math.abs(car.x - target.x) < 2.4 &&
          car.y > target.y &&
          car.y - target.y < 11
        ) {
          desired = Math.min(desired, car.speed - 2);
        }
      }

      target.speed += clamp(desired - target.speed, -20 * dt, 24 * dt);
      target.y += target.speed * dt;

      if (elapsedRef.current > target.nextLaneAt) {
        const options = LANES.map((_, index) => index).filter(
          (lane) => lane !== target.lane,
        );
        const safe = options.filter((lane) => {
          const laneX = LANES[lane];
          return !trafficRef.current.some(
            (car) =>
              Math.abs(car.x - laneX) < 2.6 &&
              car.y > target.y - 6 &&
              car.y - target.y < 12,
          );
        });
        if (safe.length > 0) {
          target.lane = safe[Math.floor(Math.random() * safe.length)];
        }
        target.nextLaneAt = elapsedRef.current + 1400 + Math.random() * 1800;
      }

      target.x += clamp(LANES[target.lane] - target.x, -6 * dt, 6 * dt);
    };

    const hitRail = (player: Player) => {
      const now = elapsedRef.current;
      if (now < railCooldownRef.current) return;
      railCooldownRef.current = now + 600;
      player.speed *= 0.86;
      shakeRef.current = { amount: 6, until: now + 220 };
      spawnSparks(player.x, player.y - 1.4, 6);
      tone(220, 0.12, "square", 0.03, 140);
    };

    const updatePlayer = (dt: number) => {
      const player = playerRef.current;
      const accel = heldRef.current.has("accel");
      const brake = heldRef.current.has("brake");
      const left = heldRef.current.has("left");
      const right = heldRef.current.has("right");

      if (accel) player.speed += ACCEL * dt;
      else if (brake) player.speed -= BRAKE * dt;
      else player.speed -= DRAG * dt;

      player.speed = clamp(player.speed, 0, MAX_SPEED);
      player.steer = (right ? 1 : 0) - (left ? 1 : 0);
      const grip = clamp(player.speed / 30, 0.35, 1);
      player.x += player.steer * 8.4 * grip * dt;

      const minX = CAR_W / 2 + 0.25;
      const maxX = ROAD_MAX - CAR_W / 2 - 0.25;
      if (player.x < minX) {
        player.x = minX;
        if (player.steer < 0) hitRail(player);
      } else if (player.x > maxX) {
        player.x = maxX;
        if (player.steer > 0) hitRail(player);
      }

      player.y += player.speed * dt;
    };

    const collideTraffic = () => {
      const player = playerRef.current;
      for (const car of trafficRef.current) {
        if (
          !carOverlap(
            player.x,
            player.y,
            CAR_W,
            CAR_L,
            car.x,
            car.y,
            car.width,
            car.length,
          )
        ) {
          continue;
        }
        if (elapsedRef.current < player.invulnUntil) continue;

        player.damage += 1;
        player.speed = Math.min(player.speed * 0.5, car.speed + 3);
        player.invulnUntil = elapsedRef.current + 1000;
        car.speed = Math.max(12, car.speed * 0.7);
        if (player.y < car.y) {
          player.y = car.y - (CAR_L + car.length) / 2 - 0.4;
        }
        shakeRef.current = { amount: 15, until: elapsedRef.current + 350 };
        spawnSparks(
          (player.x + car.x) / 2,
          (player.y + car.y) / 2,
          16,
        );
        tone(80, 0.22, "square", 0.07, 38);
        showToast(player.damage >= MAX_DAMAGE ? "WRECKED" : "CRASH", 700);

        if (player.damage >= MAX_DAMAGE) {
          finish(false, "wrecked");
        }
        break;
      }
    };

    const updateParticles = (dt: number) => {
      const particles = particlesRef.current;
      for (const particle of particles) {
        particle.life -= dt * 1000;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 0.94;
        particle.vy *= 0.94;
      }
      particlesRef.current = particles.filter((p) => p.life > 0);
    };

    const update = (dt: number) => {
      updateParticles(dt);

      if (statusRef.current !== "playing") return;

      elapsedRef.current += dt * 1000;
      updatePlayer(dt);
      updateTraffic(dt);
      spawnTraffic();
      updateTarget(dt);
      collideTraffic();

      const player = playerRef.current;
      const target = targetRef.current;

      if (carOverlap(
        player.x,
        player.y,
        CAR_W,
        CAR_L,
        target.x,
        target.y,
        CAR_W,
        CAR_L,
      )) {
        finish(true);
        return;
      }

      if (target.y - player.y > ESCAPE_GAP) {
        finish(false, "escaped");
        return;
      }

      if (target.y < player.y - 1) {
        if (!overshootRef.current) {
          overshootRef.current = true;
          showToast("Overshot — brake and swing back", 1800);
        }
      } else if (target.y > player.y + 2) {
        overshootRef.current = false;
      }
    };

    const drawCar = (
      screenX: number,
      screenY: number,
      scale: number,
      width: number,
      length: number,
      color: string,
      roof: string,
      angle: number,
      isPlayer: boolean,
    ) => {
      const w = width * scale;
      const l = length * scale;
      ctx.save();
      ctx.translate(screenX + scale * 0.55, screenY + scale * 0.75);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(28, 24, 20, 0.24)";
      ctx.beginPath();
      ctx.roundRect(-w / 2, -l / 2, w, l, w * 0.16);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.rotate(angle);

      ctx.fillStyle = "#17181c";
      for (const side of [-1, 1]) {
        for (const offset of [-0.28, 0.28]) {
          ctx.beginPath();
          ctx.roundRect(
            side * (w / 2 - scale * 0.09) - scale * 0.12,
            offset * l - scale * 0.22,
            scale * 0.24,
            scale * 1.15,
            scale * 0.07,
          );
          ctx.fill();
        }
      }

      const body = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      body.addColorStop(0, color);
      body.addColorStop(0.45, roof);
      body.addColorStop(1, color);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -l / 2, w, l, w * 0.18);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = Math.max(1, scale * 0.04);
      ctx.beginPath();
      ctx.roundRect(-w / 2 + 1, -l / 2 + 1, w - 2, l - 2, w * 0.16);
      ctx.stroke();

      ctx.fillStyle = "rgba(26, 34, 45, 0.92)";
      ctx.beginPath();
      ctx.roundRect(
        -w * 0.36,
        -l * 0.3,
        w * 0.72,
        l * 0.22,
        scale * 0.12,
      );
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(
        -w * 0.34,
        l * 0.16,
        w * 0.68,
        l * 0.16,
        scale * 0.1,
      );
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(-w * 0.36, -l * 0.06, w * 0.72, l * 0.1);

      ctx.fillStyle = isPlayer ? "#ffe9a8" : "#f6f2d8";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(
          side * w * 0.36 - w * 0.09,
          -l / 2 + scale * 0.08,
          w * 0.14,
          scale * 0.16,
          scale * 0.05,
        );
        ctx.fill();
      }
      ctx.fillStyle = "#a52121";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(
          side * w * 0.36 - w * 0.09,
          l / 2 - scale * 0.24,
          w * 0.14,
          scale * 0.16,
          scale * 0.05,
        );
        ctx.fill();
      }
      ctx.restore();
    };

    const render = (time: number) => {
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth === 0 || cssHeight === 0) return;

      const dpr = canvas.width / cssWidth;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const player = playerRef.current;
      const target = targetRef.current;
      const scale = Math.min(cssWidth / 40, cssHeight / 24);
      const centerX = cssWidth / 2;
      const playerScreenY = cssHeight * 0.73;
      const roadLeft = centerX - 8 * scale;
      const roadRight = centerX + 8 * scale;

      const shake = shakeRef.current;
      let shakeX = 0;
      let shakeY = 0;
      if (elapsedRef.current < shake.until) {
        const strength = shake.amount * (1 - (shake.until - elapsedRef.current) / 350);
        shakeX = (Math.random() - 0.5) * strength;
        shakeY = (Math.random() - 0.5) * strength;
      }
      ctx.save();
      ctx.translate(shakeX, shakeY);

      const worldToScreenX = (x: number) => centerX + (x - 8) * scale;
      const worldToScreenY = (y: number) =>
        playerScreenY - (y - player.y) * scale;

      const topWorld = player.y + playerScreenY / scale;
      const bottomWorld = player.y - (cssHeight - playerScreenY) / scale;

      const grass = ctx.createLinearGradient(0, 0, 0, cssHeight);
      grass.addColorStop(0, "#8aa85c");
      grass.addColorStop(0.55, "#7b9a52");
      grass.addColorStop(1, "#6d8a49");
      ctx.fillStyle = grass;
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      const sun = ctx.createRadialGradient(
        cssWidth * 0.16,
        -cssHeight * 0.15,
        0,
        cssWidth * 0.16,
        -cssHeight * 0.15,
        cssWidth * 0.9,
      );
      sun.addColorStop(0, "rgba(255, 238, 196, 0.55)");
      sun.addColorStop(0.4, "rgba(255, 215, 150, 0.16)");
      sun.addColorStop(1, "rgba(255, 205, 130, 0)");
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      const treeStart = Math.floor(bottomWorld / 6) - 1;
      const treeEnd = Math.ceil(topWorld / 6) + 1;
      for (let i = treeStart; i <= treeEnd; i += 1) {
        for (const side of [0, 1]) {
          const baseX = side === 0 ? -3.4 : 19.4;
          const jitterX = (hash(i * 3 + side * 7) - 0.5) * 4;
          const jitterY = (hash(i * 5 + side * 11) - 0.5) * 3.4;
          const treeWorldX = baseX + jitterX;
          const treeWorldY = i * 6 + jitterY;
          const sx = worldToScreenX(treeWorldX);
          const sy = worldToScreenY(treeWorldY);
          if (sy < -scale * 3 || sy > cssHeight + scale * 3) continue;
          const radius = scale * (0.95 + hash(i + side * 3) * 0.75);
          ctx.fillStyle = "rgba(48, 54, 28, 0.3)";
          ctx.beginPath();
          ctx.ellipse(
            sx + radius * 1.8,
            sy + radius * 1.5,
            radius * 1.05,
            radius * 0.72,
            0.4,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.fillStyle = hash(i * 2 + side) < 0.5 ? "#4f7439" : "#5d8341";
          ctx.beginPath();
          ctx.arc(sx, sy, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(185, 210, 120, 0.32)";
          ctx.beginPath();
          ctx.arc(
            sx - radius * 0.28,
            sy - radius * 0.32,
            radius * 0.55,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }

      for (const side of [-1, 1]) {
        const shoulderX =
          side < 0 ? roadLeft - scale * 1.1 : roadRight;
        ctx.fillStyle = "#c8bb9c";
        ctx.fillRect(shoulderX, 0, scale * 1.1, cssHeight);
        ctx.fillStyle = "rgba(120, 110, 85, 0.3)";
        for (let i = treeStart; i <= treeEnd; i += 1) {
          const postY =
            worldToScreenY(i * 4 + (side < 0 ? 0 : 2));
          ctx.fillRect(shoulderX + scale * 0.1, postY, scale * 0.12, scale * 0.5);
        }
      }

      const asphalt = ctx.createLinearGradient(
        roadLeft,
        0,
        roadRight,
        0,
      );
      asphalt.addColorStop(0, "#4a4c52");
      asphalt.addColorStop(0.15, "#585a61");
      asphalt.addColorStop(0.85, "#585a61");
      asphalt.addColorStop(1, "#46484e");
      ctx.fillStyle = asphalt;
      ctx.fillRect(roadLeft, 0, roadRight - roadLeft, cssHeight);

      ctx.fillStyle = "rgba(255, 244, 220, 0.55)";
      ctx.fillRect(roadLeft + scale * 0.28, 0, scale * 0.16, cssHeight);
      ctx.fillRect(roadRight - scale * 0.44, 0, scale * 0.16, cssHeight);

      const dashStart = Math.floor(bottomWorld / 5) * 5;
      for (let y = dashStart; y < topWorld + 5; y += 5) {
        const sy = worldToScreenY(y);
        for (const laneX of [4, 8, 12]) {
          const sx = worldToScreenX(laneX);
          ctx.fillStyle = "rgba(250, 248, 238, 0.62)";
          ctx.fillRect(
            sx - scale * 0.07,
            sy - scale * 1.1,
            scale * 0.14,
            scale * 1.9,
          );
        }
      }

      const visibleTraffic = trafficRef.current.filter((car) => {
        const sy = worldToScreenY(car.y);
        return sy > -scale * 10 && sy < cssHeight + scale * 10;
      });

      for (const car of visibleTraffic) {
        drawCar(
          worldToScreenX(car.x),
          worldToScreenY(car.y),
          scale,
          car.width,
          car.length,
          car.color,
          car.roof,
          0,
          false,
        );
      }

      const targetAngle = clamp(
        (LANES[target.lane] - target.x) * 0.05,
        -0.12,
        0.12,
      );
      drawCar(
        worldToScreenX(target.x),
        worldToScreenY(target.y),
        scale,
        CAR_W,
        CAR_L,
        "#e6e2d4",
        "#cfcabb",
        targetAngle,
        false,
      );

      drawCar(
        worldToScreenX(player.x),
        worldToScreenY(player.y),
        scale,
        CAR_W,
        CAR_L,
        "#5c151b",
        "#7d1f26",
        player.steer * 0.13,
        true,
      );

      for (const particle of particlesRef.current) {
        const alpha = clamp(particle.life / particle.maxLife, 0, 1);
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(
          worldToScreenX(particle.x),
          worldToScreenY(particle.y),
          particle.size * scale,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const targetScreenX = worldToScreenX(target.x);
      const targetScreenY = worldToScreenY(target.y);
      if (targetScreenY < scale * 2) {
        const pulse = 0.6 + 0.4 * Math.sin(time / 180);
        const markerX = clamp(targetScreenX, roadLeft + scale, roadRight - scale);
        ctx.fillStyle = `rgba(190, 30, 45, ${pulse})`;
        ctx.beginPath();
        ctx.moveTo(markerX, scale * 0.4);
        ctx.lineTo(markerX - scale * 0.45, scale * 1.15);
        ctx.lineTo(markerX + scale * 0.45, scale * 1.15);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(190, 30, 45, ${pulse})`;
        ctx.font = `700 ${Math.round(scale * 0.5)}px "Geist Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("THEM", markerX, scale * 1.3);
      } else if (targetScreenY < cssHeight) {
        const bob = Math.sin(time / 220) * scale * 0.12;
        ctx.fillStyle = "rgba(180, 25, 40, 0.9)";
        ctx.beginPath();
        ctx.moveTo(targetScreenX, targetScreenY - scale * 3 - bob);
        ctx.lineTo(targetScreenX - scale * 0.5, targetScreenY - scale * 3.8 - bob);
        ctx.lineTo(targetScreenX + scale * 0.5, targetScreenY - scale * 3.8 - bob);
        ctx.closePath();
        ctx.fill();
        ctx.font = `700 ${Math.round(scale * 0.42)}px "Geist Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("THEM", targetScreenX, targetScreenY - scale * 4.0 - bob);
      } else {
        const pulse = 0.6 + 0.4 * Math.sin(time / 180);
        const markerX = clamp(targetScreenX, roadLeft + scale, roadRight - scale);
        ctx.fillStyle = `rgba(190, 30, 45, ${pulse})`;
        ctx.beginPath();
        ctx.moveTo(markerX, cssHeight - scale * 0.4);
        ctx.lineTo(markerX - scale * 0.45, cssHeight - scale * 1.15);
        ctx.lineTo(markerX + scale * 0.45, cssHeight - scale * 1.15);
        ctx.closePath();
        ctx.fill();
        ctx.font = `700 ${Math.round(scale * 0.5)}px "Geist Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("THEM", markerX, cssHeight - scale * 1.3);
      }

      const glare = ctx.createLinearGradient(
        0,
        0,
        cssWidth * 0.75,
        cssHeight,
      );
      glare.addColorStop(0, "rgba(255, 228, 170, 0.17)");
      glare.addColorStop(0.35, "rgba(255, 228, 170, 0.05)");
      glare.addColorStop(1, "rgba(255, 228, 170, 0)");
      ctx.fillStyle = glare;
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      const vignette = ctx.createRadialGradient(
        cssWidth / 2,
        cssHeight * 0.55,
        Math.min(cssWidth, cssHeight) * 0.35,
        cssWidth / 2,
        cssHeight * 0.55,
        Math.max(cssWidth, cssHeight) * 0.75,
      );
      vignette.addColorStop(0, "rgba(30, 22, 10, 0)");
      vignette.addColorStop(1, "rgba(30, 22, 10, 0.28)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      if (player.damage >= MAX_DAMAGE - 1) {
        const danger = 0.1 + 0.05 * Math.sin(time / 160);
        ctx.fillStyle = `rgba(170, 10, 20, ${danger})`;
        ctx.fillRect(0, 0, cssWidth, cssHeight);
      }

      ctx.restore();
    };

    const frame = (now: number) => {
      const dt = Math.min(now - lastFrame, 50) / 1000;
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#1a1408]/55 px-6 text-center backdrop-blur-[2px]">
          <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-amber-200/90">
            Route 13 · 06:12 AM
          </p>
          <h2 className="text-4xl font-black uppercase tracking-[0.16em] text-zinc-50 drop-shadow-[0_2px_20px_rgba(0,0,0,0.7)] sm:text-6xl">
            Road
            <span className="block bg-gradient-to-r from-red-500 via-rose-300 to-amber-300 bg-clip-text text-transparent">
              Hunt
            </span>
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-zinc-200/90">
            You are the madman. They left at dawn with a full tank. Follow them
            onto the highway and run them down before the hills swallow the
            road.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300/80">
            <span>W / ↑ gas</span>
            <span>S / ↓ brake</span>
            <span>A D steer</span>
            <span>Ram their car</span>
          </div>
          <button
            type="button"
            onClick={startGame}
            className="mt-1 rounded-full bg-red-600 px-9 py-3 text-xs font-bold uppercase tracking-[0.3em] text-white shadow-[0_0_40px_-8px_rgba(239,68,68,0.9)] transition hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-300"
          >
            Start the engine
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-400/70">
            Space to start · P to pause
          </p>
        </div>
      );
    }

    if (status === "paused") {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#1a1408]/60 backdrop-blur-sm">
          <p className="text-2xl font-black uppercase tracking-[0.3em] text-zinc-100">
            Paused
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-400">
            The engine is still warm
          </p>
          <button
            type="button"
            onClick={togglePause}
            className="rounded-full border border-zinc-500/70 px-8 py-2.5 text-xs font-bold uppercase tracking-[0.3em] text-zinc-100 transition hover:border-zinc-200"
          >
            Resume
          </button>
        </div>
      );
    }

    if (status === "won" || status === "lost") {
      const won = status === "won";
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#1a1408]/70 px-6 text-center backdrop-blur-sm">
          <p
            className={`font-mono text-[10px] uppercase tracking-[0.5em] ${
              won ? "text-amber-300" : "text-red-400"
            }`}
          >
            {won ? "Chase over" : lossReason === "wrecked" ? "Car wrecked" : "Lost the trail"}
          </p>
          <h2
            className={`text-4xl font-black uppercase tracking-[0.14em] sm:text-5xl ${
              won ? "text-amber-200" : "text-red-400"
            }`}
          >
            {won ? "Caught" : lossReason === "wrecked" ? "Wrecked" : "They got away"}
          </h2>
          <p className="max-w-sm text-xs leading-relaxed text-zinc-300/80">
            {won
              ? "The chase ends in a spray of glass and morning dust."
              : lossReason === "wrecked"
                ? "Too many bad hits. The car gave out before you did."
                : "They vanished over the hills with your headlights in the mirror."}
          </p>
          <div className="mt-1 flex items-center gap-6 font-mono text-xs text-zinc-400">
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
            Chase again
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            Press space to restart
          </p>
        </div>
      );
    }

    return null;
  })();

  return (
    <div className="mx-auto w-full max-w-[min(68rem,calc((100dvh-13rem)*16/9))]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.55em] text-red-500/80">
            Madman
          </p>
          <h1 className="mt-1 text-2xl font-black uppercase tracking-[0.2em] text-zinc-100 sm:text-3xl">
            Road<span className="text-red-500"> Hunt</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-xs tabular-nums text-zinc-100">
            {hud.speed} <span className="text-[9px] text-zinc-500">KM/H</span>
          </div>
          <div className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-xs tabular-nums text-zinc-100">
            {hud.gap <= 0 ? "—" : hud.gap}{" "}
            <span className="text-[9px] text-zinc-500">M</span>
          </div>
          <div
            aria-label={`Damage ${hud.damage} of ${MAX_DAMAGE}`}
            className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2.5"
          >
            {Array.from({ length: MAX_DAMAGE }).map((_, index) => (
              <span
                key={index}
                className={`h-2 w-4 rounded-sm transition ${
                  index < hud.damage ? "bg-red-500" : "bg-zinc-700"
                }`}
              />
            ))}
          </div>
          <div className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-xs tabular-nums text-zinc-200">
            {formatTime(elapsedMs)}
          </div>
          <div className="hidden rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500 md:block">
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

      <div className="relative overflow-hidden rounded-2xl border border-amber-900/40 bg-black shadow-[0_30px_120px_-30px_rgba(190,80,30,0.4)]">
        <div className="relative aspect-[16/9] w-full">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full touch-none"
            aria-label="Road Hunt driving game"
          />

          {toast ? (
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
              <div className="rounded-full border border-amber-200/30 bg-black/70 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-100 backdrop-blur">
                {toast}
              </div>
            </div>
          ) : null}

          {overlay}
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2 sm:hidden">
          <button
            type="button"
            aria-label="Steer left"
            onPointerDown={(event) => {
              event.preventDefault();
              press("left");
            }}
            onPointerUp={() => release("left")}
            onPointerLeave={() => release("left")}
            onPointerCancel={() => release("left")}
            className="flex h-12 w-14 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-lg text-zinc-300 active:border-amber-400 active:text-amber-300"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Steer right"
            onPointerDown={(event) => {
              event.preventDefault();
              press("right");
            }}
            onPointerUp={() => release("right")}
            onPointerLeave={() => release("right")}
            onPointerCancel={() => release("right")}
            className="flex h-12 w-14 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-lg text-zinc-300 active:border-amber-400 active:text-amber-300"
          >
            →
          </button>
          <button
            type="button"
            aria-label="Brake"
            onPointerDown={(event) => {
              event.preventDefault();
              press("brake");
            }}
            onPointerUp={() => release("brake")}
            onPointerLeave={() => release("brake")}
            onPointerCancel={() => release("brake")}
            className="ml-2 flex h-12 w-16 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 font-mono text-[10px] uppercase tracking-wider text-zinc-300 active:border-red-400 active:text-red-300"
          >
            Brake
          </button>
          <button
            type="button"
            aria-label="Accelerate"
            onPointerDown={(event) => {
              event.preventDefault();
              press("accel");
            }}
            onPointerUp={() => release("accel")}
            onPointerLeave={() => release("accel")}
            onPointerCancel={() => release("accel")}
            className="flex h-12 w-16 items-center justify-center rounded-xl border border-amber-600/60 bg-amber-950/40 font-mono text-[10px] uppercase tracking-wider text-amber-200 active:border-amber-300 active:text-amber-100"
          >
            Gas
          </button>
        </div>

        <p className="hidden max-w-lg font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-zinc-500 sm:block">
          W / ↑ accelerate · S / ↓ brake · A D steer · Space to start · P to
          pause. Dodge traffic, stay off the guardrail, and put your bumper into
          their car.
        </p>

        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              hud.damage >= MAX_DAMAGE - 1 ? "bg-red-500" : "bg-amber-400"
            }`}
          />
          {hud.damage >= MAX_DAMAGE - 1 ? "Car failing" : "In pursuit"}
        </div>
      </div>
    </div>
  );
}

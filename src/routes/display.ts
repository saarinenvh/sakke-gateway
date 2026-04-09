import type { FastifyInstance } from "fastify";
import { registerSSEClient, broadcastState, getCurrentState } from "../services/displayState.js";

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sakke</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0d0d1a; overflow: hidden; }
    canvas { display: block; }
    #label {
      position: fixed;
      bottom: 48px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255,255,255,0.25);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      font-weight: 300;
      letter-spacing: 6px;
      text-transform: uppercase;
      transition: opacity 0.5s;
    }
  </style>
</head>
<body>
  <canvas id="c"></canvas>
  <div id="label">idle</div>
  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const label = document.getElementById('label');

    let W, H, cx, cy, R;
    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      cx = W / 2; cy = H / 2;
      R = Math.min(W, H) * 0.22;
    }
    resize();
    window.addEventListener('resize', resize);

    // --- State ---
    let state = 'idle';
    let t = 0;
    let amplitude = 0;
    let simPhase = 0;
    let simAmp = 0;

    // --- Colors ---
    const PALETTE = {
      idle:      { r: 120, g: 140, b: 255 },
      listening: { r: 60,  g: 255, b: 255 },
      thinking:  { r: 210, g: 100, b: 255 },
      speaking:  { r: 130, g: 210, b: 255 },
    };
    let cur = { ...PALETTE.idle };
    let tgt = { ...PALETTE.idle };

    function lerp(a, b, k) { return a + (b - a) * k; }

    // --- Mic / Audio ---
    let analyser = null;
    let freqData = null;

    async function initMic() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaStreamSource(stream);
        analyser = ac.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        src.connect(analyser);
        freqData = new Uint8Array(analyser.frequencyBinCount);
        console.log('[sakke] mic ready');
      } catch (e) {
        console.warn('[sakke] mic unavailable, using simulation:', e.message);
      }
    }
    initMic();

    function getMicAmplitude() {
      if (!analyser) return null;
      analyser.getByteFrequencyData(freqData);
      // Weight towards speech frequencies (300-3000hz)
      const binHz = 24000 / freqData.length;
      let sum = 0, count = 0;
      for (let i = 0; i < freqData.length; i++) {
        const hz = i * binHz;
        if (hz >= 200 && hz <= 4000) { sum += freqData[i]; count++; }
      }
      return count > 0 ? sum / (count * 255) : 0;
    }

    function getAmplitude() {
      if (state !== 'speaking') return 0;
      const mic = getMicAmplitude();
      if (mic !== null) return mic;
      // Simulated speech-like rhythm
      simPhase += 0.07;
      const raw = Math.sin(simPhase * 4.1) * 0.4
                + Math.sin(simPhase * 1.7) * 0.35
                + Math.sin(simPhase * 7.3) * 0.15
                + 0.1;
      const target = Math.max(0, Math.min(1, raw));
      simAmp += (target - simAmp) * 0.25;
      return simAmp;
    }

    // --- Drawing helpers ---
    function orb(radius, alpha) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0,   \`rgba(\${cur.r},\${cur.g},\${cur.b},\${alpha})\`);
      g.addColorStop(0.45,\`rgba(\${cur.r},\${cur.g},\${cur.b},\${alpha * 0.55})\`);
      g.addColorStop(1,   \`rgba(\${cur.r},\${cur.g},\${cur.b},0)\`);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    function glow(radius, strength) {
      const g = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 2.8);
      g.addColorStop(0, \`rgba(\${cur.r},\${cur.g},\${cur.b},\${strength})\`);
      g.addColorStop(1, \`rgba(\${cur.r},\${cur.g},\${cur.b},0)\`);
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 2.8, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    function ring(radius, lineWidth, alpha) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = \`rgba(\${cur.r},\${cur.g},\${cur.b},\${alpha})\`;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    function arc(radius, lineWidth, alpha, start, len) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + len);
      ctx.strokeStyle = \`rgba(\${cur.r},\${cur.g},\${cur.b},\${alpha})\`;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    // --- Animation loop ---
    function draw() {
      requestAnimationFrame(draw);

      ctx.clearRect(0, 0, W, H);

      // Smooth color
      cur.r = lerp(cur.r, tgt.r, 0.04);
      cur.g = lerp(cur.g, tgt.g, 0.04);
      cur.b = lerp(cur.b, tgt.b, 0.04);

      const amp = getAmplitude();
      amplitude += (amp - amplitude) * 0.18;

      t += 0.016;

      if (state === 'idle') {
        const p = Math.sin(t * 0.7) * 0.5 + 0.5;
        const s = R * (0.88 + p * 0.12);
        glow(s, 0.32 + p * 0.12);
        orb(s, 0.85 + p * 0.15);
        ring(s * 1.15, 1.5, 0.3 + p * 0.2);

      } else if (state === 'listening') {
        const p = Math.sin(t * 2.8) * 0.5 + 0.5;
        glow(R, 0.45);
        orb(R, 1.0);
        ring(R * 1.15, 2, 0.75 + p * 0.25);
        ring(R * 1.4, 1.5, 0.4 + p * 0.2);
        ring(R * 1.7, 1, 0.2 + p * 0.1);

      } else if (state === 'thinking') {
        const p = Math.sin(t * 1.8) * 0.5 + 0.5;
        glow(R, 0.38 + p * 0.12);
        orb(R * 0.92, 0.9 + p * 0.1);
        for (let i = 0; i < 3; i++) {
          const rot = t * 1.1 + i * (Math.PI * 2 / 3);
          arc(R * 1.3 + i * 10, 3 - i * 0.5, 1.0 - i * 0.2, rot, Math.PI * 0.45);
        }

      } else if (state === 'speaking') {
        const scale = 0.88 + amplitude * 0.65;
        const s = R * scale;
        glow(s, 0.38 + amplitude * 0.22);
        orb(s, 1.0);
        ring(s * 1.18, 2.5, 0.5 + amplitude * 0.5);
        if (amplitude > 0.1) {
          const a = (amplitude - 0.1) / 0.9;
          ring(s * 1.45, 1.5, a * 0.7);
          ring(s * 1.8, 1, a * 0.4);
        }
      }
    }
    draw();

    // --- SSE ---
    function connect() {
      const es = new EventSource('/display/events');
      es.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.state !== state) {
          state = d.state;
          tgt = { ...PALETTE[state] };
          label.textContent = state;
          simPhase = 0; simAmp = 0;
        }
      };
      es.onerror = () => { es.close(); setTimeout(connect, 3000); };
    }
    connect();
  </script>
</body>
</html>`;

export async function displayRoutes(app: FastifyInstance): Promise<void> {
  app.get("/display", async (_req, reply) => {
    reply.type("text/html").send(HTML);
  });

  app.get("/display/events", (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (data: string) => { try { raw.write(data); } catch {} };
    const unregister = registerSSEClient(send);
    req.raw.on("close", unregister);
  });

  // HA automation calls this when voice pipeline state changes
  app.post("/display/state", async (req, reply) => {
    const { state } = req.body as { state: string };
    const valid = ["idle", "listening", "thinking", "speaking"];
    if (valid.includes(state)) {
      broadcastState(state as any);
      return { ok: true };
    }
    return reply.code(400).send({ error: "invalid state" });
  });

  app.get("/display/state", async () => ({ state: getCurrentState() }));
}

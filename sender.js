// sender.js
const { exec } = require('child_process');
const WebSocket = require('ws');
const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

const TWITCH_HLS = process.env.TWITCH_HLS; // e.g. https://usher.ttvnw.net/api/channel/hls/YOUR_CHANNEL.m3u8
const GRID_W = parseInt(process.env.GRID_W || '32', 10);
const GRID_H = parseInt(process.env.GRID_H || '18', 10);
const FPS = parseFloat(process.env.FPS || '1'); // frames per second
const WS_URL = process.env.WS_URL; // wss://... (relay)
const TOKEN = process.env.WS_TOKEN; // same as WS_SECRET
const TEMP_DIR = path.join(__dirname, 'tmp_frames');

if (!TWITCH_HLS || !WS_URL || !TOKEN) {
  console.error('Missing required env vars: TWITCH_HLS, WS_URL, WS_TOKEN');
  process.exit(1);
}

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

let ws;
let lastGrid = null;

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.on('open', () => console.log('Connected to relay', WS_URL));
  ws.on('close', () => {
    console.log('Relay closed, reconnecting in 3s');
    setTimeout(connectWS, 3000);
  });
  ws.on('error', (e) => {
    console.error('WS error', e.message || e);
    ws.close();
  });
}

function ffmpegCaptureOnce(outFile, cb) {
  // capture one frame scaled to GRID_W x GRID_H
  const cmd = `ffmpeg -hide_banner -loglevel error -y -i "${TWITCH_HLS}" -frames:v 1 -vf scale=${GRID_W}:${GRID_H} "${outFile}"`;
  exec(cmd, (err) => cb(err));
}

async function readGridFromFile(file) {
  const img = await Jimp.read(file);
  const grid = [];
  for (let y = 0; y < GRID_H; y++) {
    const row = [];
    for (let x = 0; x < GRID_W; x++) {
      const rgba = Jimp.intToRGBA(img.getPixelColor(x, y));
      row.push([rgba.r, rgba.g, rgba.b]);
    }
    grid.push(row);
  }
  return grid;
}

function diffGrids(oldGrid, newGrid) {
  const diffs = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const o = oldGrid?.[y]?.[x];
      const n = newGrid[y][x];
      if (!o || o[0] !== n[0] || o[1] !== n[1] || o[2] !== n[2]) {
        diffs.push({ x, y, color: n });
      }
    }
  }
  return diffs;
}

async function captureLoop() {
  const outFile = path.join(TEMP_DIR, `frame_${Date.now()}.png`);
  ffmpegCaptureOnce(outFile, async (err) => {
    if (err) {
      console.error('ffmpeg capture error:', err.message || err);
      setTimeout(captureLoop, 1000);
      return;
    }
    try {
      const grid = await readGridFromFile(outFile);
      let payload = null;
      const diffs = diffGrids(lastGrid, grid);
      if (diffs.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
        // send diffs if small, otherwise send full
        if (diffs.length < (GRID_W * GRID_H) * 0.6) {
          payload = { token: TOKEN, type: 'diff', w: GRID_W, h: GRID_H, diffs };
        } else {
          payload = { token: TOKEN, type: 'full', w: GRID_W, h: GRID_H, grid };
        }
        ws.send(JSON.stringify(payload));
      }
      lastGrid = grid;
    } catch (e) {
      console.error('Error processing frame:', e);
    } finally {
      try { fs.unlinkSync(outFile); } catch (e) {}
      setTimeout(captureLoop, 1000 / Math.max(FPS, 1));
    }
  });
}

connectWS();
setTimeout(captureLoop, 2000);

// Regenerate every apps/<slug>/index.html as a thin page driven by the shared
// Bad Apple "anywhere" forms API (shared/badapple-anywhere.js).
// Each app picks a form + theming; the API does all rendering + synced sound.
//   node tools/gen_apps.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// slug, title, tag, accent  +  per-app form config
const APPS = [
  ['terminal','Terminal','ASCII art in a CRT shell','#33ff66',{form:'ascii',bg:'#020a02'}],
  ['google-maps','Google Maps','Silhouette as city blocks','#4285f4',{form:'elements',black:'🟦',bg:'#0b1f33'}],
  ['chess','Chess','Pieces become pixels','#d9a066',{form:'elements',black:'♟️',bg:'#262421'}],
  ['minesweeper','Minesweeper','A mine in every dark cell','#e53935',{form:'elements',black:'💣',white:'🟦',bg:'#bdbdbd'}],
  ['spreadsheet','Spreadsheet','Conditional formatting','#0f9d58',{form:'elements',black:'🟩',bg:'#0b160b'}],
  ['file-explorer','File Explorer','Marching file selection','#2b88d8',{form:'elements',black:'📄',bg:'#0c1420'}],
  ['game-of-life',"Conway's Life",'Cells flicker alive','#18e0c8',{form:'elements',black:'⬛',white:'⬜',bg:'#111111'}],
  ['vscode','VS Code','Watch the minimap','#3aa0ff',{form:'ascii',bg:'#0d1117'}],
  ['discord','Discord','Pixel-canvas embed','#5865f2',{form:'elements',black:'💬',bg:'#1a1c22'}],
  ['matrix','Matrix Rain','A figure in the rain','#00ff41',{form:'ascii',bg:'#000000'}],
  ['stocks','Trading Terminal','Live market heatmap','#ffae00',{form:'elements',black:'📈',bg:'#0a0f0a'}],
  ['piano-roll','Piano Roll','Made of MIDI notes','#19c37d',{form:'elements',black:'🎵',bg:'#0a0a14'}],
  ['weather-radar','Weather Radar','Doppler silhouette','#ff5252',{form:'elements',black:'🟥',bg:'#001018'}],
  ['launchpad','RGB Launchpad','Pads light up and dance','#ff2d95',{form:'elements',black:'🟪',bg:'#08080c'}],
  ['cctv','CCTV Feed','CAM 04 • ● REC','#66ff99',{form:'video',bg:'#000000'}],
  ['ms-paint','MS Paint','Drawn in black & white','#ffffff',{form:'video',bg:'#ffffff'}],
  ['oscilloscope','Oscilloscope','Phosphor beam & persistence','#38f08a',{form:'video',bg:'#001b0e'}],
  ['subway-map','Subway Map','Stations form the figure','#ff7a1a',{form:'elements',black:'🔵',bg:'#0c0c0c'}],
  ['youtube','YouTube',"It's literally YouTube",'#ff3d3d',{form:'video',bg:'#0f0f0f'}],
  ['gameboy','Game Boy','Native 160×144 DMG green','#9bbc0f',{form:'video',bg:'#0f380f'}],
  ['windows-xp','Windows XP','Bliss + Media Player','#4aa3ff',{form:'video',bg:'#1f5bbf'}],
  ['ios-home','iOS Home Screen','Icons form the figure','#0a84ff',{form:'elements',black:'📱',bg:'#101018'}],
  ['split-flap','Split-Flap Board','Departures board flips','#f5c518',{form:'elements',black:'🔳',bg:'#0a0a0a'}],
  ['scoreboard','Scoreboard','Stadium LED jumbotron','#ff7b00',{form:'elements',black:'🟧',bg:'#050505'}],
  ['ti-calculator','TI-84 Calculator','96×64 graphing LCD','#7cb342',{form:'ascii',bg:'#1a1f12'}],
  ['nokia-3310','Nokia 3310','84×48 · Snake included','#8fbf3f',{form:'ascii',bg:'#0d1a05'}],
  ['hex-editor','Hex Editor','Hidden in the bytes','#4ec9b0',{form:'ascii',bg:'#06121a'}],
  ['qr-code','QR Code','Scannable-ish modules','#ffffff',{form:'elements',black:'⬛',white:'⬜',bg:'#ffffff'}],
  ['winamp','Winamp',"Whips the llama's ass",'#b6ff00',{form:'ascii',bg:'#101010'}],
  ['tiktok','TikTok','Vertical, with hearts','#fe2c55',{form:'video',bg:'#000000'}],
  ['lite-brite','Lite-Brite','Glowing pegboard','#ff4fd8',{form:'elements',black:'🟡',bg:'#000000'}],
  ['etch-a-sketch','Etch A Sketch','Etched in aluminum','#e23b3b',{form:'video',bg:'#b0b4b8'}],
  ['crt-tv','CRT Television','Curved glass + static','#62d0ff',{form:'video',bg:'#000000'}],
  ['zoom','Zoom Call','12 tiles, one figure','#2d8cff',{form:'video',bg:'#1a1d21'}],
];

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function optsLiteral(cfg){
  const o = { form: cfg.form, target: 'stage' };
  if (cfg.black != null) o.black = cfg.black;
  if (cfg.white != null) o.white = cfg.white;
  if (cfg.form === 'elements') o.cols = cfg.cols || 48;
  if (cfg.form === 'ascii') { o.cols = cfg.cols || 120; o.rows = cfg.rows || 64; }
  return JSON.stringify(o);
}

function page(slug, title, tag, accent, cfg){
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Bad Apple!!</title>
<style>
  html,body{margin:0;height:100%;background:${cfg.bg};color:#dfe3ea;font:14px system-ui,'Segoe UI',sans-serif;overflow:hidden}
  .topbar{position:fixed;top:0;left:0;right:0;height:42px;display:flex;align-items:center;gap:10px;
    padding:0 14px;background:rgba(0,0,0,.5);border-bottom:1px solid rgba(255,255,255,.12);
    z-index:2147483600;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
  .topbar a{color:#9fb0c4;text-decoration:none;font-weight:600}
  .topbar a:hover{color:#fff}
  .topbar .dot{width:10px;height:10px;border-radius:50%;background:${accent}}
  .topbar .t{font-weight:700;color:${accent}}
  .topbar .tag{color:#7a8599;margin-left:auto;font-size:12.5px}
  #stage{position:fixed;left:0;right:0;top:42px;bottom:0}
</style>
</head>
<body>
<div class="topbar">
  <a href="../../index.html">← Gallery</a>
  <span class="dot"></span><span class="t">${esc(title)}</span>
  <span class="tag">${esc(tag)}</span>
</div>
<div id="stage"></div>
<script>window.BADAPPLE_OPTS = ${optsLiteral(cfg)};</script>
<script src="../../shared/frames-data.js"></script>
<script src="../../shared/badapple.js"></script>
<script src="../../shared/badapple-anywhere.js"></script>
</body>
</html>
`;
}

let n = 0;
for (const [slug, title, tag, accent, cfg] of APPS){
  const dir = join(ROOT, 'apps', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(slug, title, tag, accent, cfg));
  n++;
}
console.log('Generated ' + n + ' app pages via the anywhere forms API.');

/**
 * Encadra Frame Maker — reference implementation (app logic)
 *
 * 指示書（../README.md）の参照実装です。構成・データ形式・振る舞いが正本です。
 * Space へ移植する場合は、保存先だけを Space のストレージに置き換え、
 * レイヤーのデータ形式と合成・検証・書き出しの振る舞いはこの実装に合わせてください。
 *
 * データ形式:
 *   state = {
 *     version: 'v0.9',            // 対応する指示書の版（§0の版記録）
 *     lang: 'ja' | 'en',
 *     theme: string,              // デザイン全体で1つ（ファイル名とギャラリー記録に使う）
 *     ratio: '4:5',               // 現在の比率
 *     bg: 'checker'|'dummy'|'white'|'black',
 *     images: { [imageId]: dataURL },        // 画像はIDで一度だけ保持する
 *     layers: Layer[],            // 配列の先頭が一番下の層
 *     templates: { [name]: Layer[] のスナップショット },
 *     gallery: GalleryItem[],     // 最新60件
 *   }
 *   Layer = { id, type, name, visible, opacity, ...種類ごとの属性 }
 *   GalleryItem = { thumb(dataURL), ratio, datetime, theme, fileName, layers のスナップショット }
 *   スナップショットは画像そのものではなく imageId への参照を持つ（画像を複製しない）。
 *
 * MIT License — see ../LICENSE
 */
'use strict';

/* ================= i18n（UIの既定言語はユーザーの言語。最低限 英語への切替を持つ） ================= */

const SHEET_VERSION = 'v0.9';

const STR = {
  ja: {
    howto: '使い方: 1) テーマを決めて依頼文をコピー 2) 自分のMuseに渡して画像を作ってもらう 3) できた画像がレイヤーに入ると仕上がる',
    theme: 'テーマ', ratio: '比率', verify: '書き出し前検証',
    exportOne: 'この比率で書き出す', exportAll: '5比率まとめて書き出す（ZIP）',
    layers: 'レイヤー', request: 'Museへの依頼文',
    reqArt: 'アート層用', reqMotif: 'モチーフ層用', reqCopy: '依頼文をコピー',
    templates: 'テンプレート', tplSave: '保存', gallery: 'フレームギャラリー',
    addArt: '＋ AI生成アート', addMotif: '＋ AI生成モチーフ', addBasic: '＋ 基本フレーム', addText: '＋ テキスト',
    bgChecker: 'チェッカー', bgDummy: 'ダミー写真', bgWhite: '白', bgBlack: '黒',
    art: 'AI生成アート', motif: 'AI生成モチーフ', basic: '基本フレーム', text: 'テキスト',
    footer: '書き出したフレームPNGは、Encadraのカスタムフレームに登録して使います（登録時にアプリ内へコピーされるので、元のファイルを消しても残ります）。',
    version: '対応している指示書の版: ',
  },
  en: {
    howto: 'How to use: 1) Pick a theme and copy a request 2) Ask your Muse to generate the image 3) The image lands in a layer and the frame is done',
    theme: 'Theme', ratio: 'Ratio', verify: 'Pre-export checks',
    exportOne: 'Export this ratio', exportAll: 'Export all 5 ratios (ZIP)',
    layers: 'Layers', request: 'Request text for Muse',
    reqArt: 'For art layer', reqMotif: 'For motif layer', reqCopy: 'Copy request',
    templates: 'Templates', tplSave: 'Save', gallery: 'Frame gallery',
    addArt: '+ AI art', addMotif: '+ AI motif', addBasic: '＋ Basic frame', addText: '+ Text',
    bgChecker: 'Checker', bgDummy: 'Dummy photo', bgWhite: 'White', bgBlack: 'Black',
    art: 'AI art', motif: 'AI motif', basic: 'Basic frame', text: 'Text',
    footer: 'Register the exported frame PNG as an Encadra custom frame (it is copied into the app, so deleting the original file is fine).',
    version: 'Instruction sheet version: ',
  },
};
const t = (k) => STR[state.lang][k] || k;

/* ================= 状態と保存 ================= */

const STORE_KEY = 'encadra-frame-maker-reference-v1';

let uidCounter = 1;
const uid = (p) => `${p}_${Date.now().toString(36)}_${uidCounter++}`;

function defaultBasic() {
  return {
    id: uid('basic'), type: 'basic', name: '', visible: true, opacity: 1,
    template: 'double', color: '#e8590c', thicknessPct: 2, bandPct: 16, motif: 'none',
  };
}

let state = {
  version: SHEET_VERSION,
  lang: 'ja',
  theme: '',
  ratio: '4:5',
  bg: 'checker',
  images: {},
  layers: [Object.assign(defaultBasic(), { name: '基本フレーム 1' })],
  templates: {},
  gallery: [],
};

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    // 画像が大きく localStorage に収まらない場合はメモリ上のみで続行する
    // （Space への移植時は Space のストレージを使うため、この制限は持ち込まない）
    console.warn('save failed (storage full?)', e);
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.layers)) state = parsed;
  } catch (e) { /* 壊れた保存は無視して既定で始める */ }
}

/* ================= 画像の読み込み ================= */

const imageCache = new Map(); // imageId -> HTMLImageElement

function imageElement(imageId) {
  if (imageCache.has(imageId)) return imageCache.get(imageId);
  const img = new Image();
  img.src = state.images[imageId] || '';
  imageCache.set(imageId, img);
  return img;
}

function storeImage(dataURL) {
  const id = uid('img');
  state.images[id] = dataURL;
  imageCache.delete(id);
  return id;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ================= ダミー写真（作成時に生成して同梱する。実在の人物は使わない） ================= */

let dummyCanvas = null;
function makeDummyPhoto() {
  // 風景のダミーを描画で生成する（外部画像を持ち込まない）
  const c = document.createElement('canvas');
  c.width = 1920; c.height = 1280;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, 900);
  sky.addColorStop(0, '#8ec9e8'); sky.addColorStop(1, '#eaf6fd');
  x.fillStyle = sky; x.fillRect(0, 0, 1920, 900);
  x.fillStyle = '#f7d774';
  x.beginPath(); x.arc(1580, 240, 110, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#7fa6c9';
  x.beginPath(); x.moveTo(0, 900); x.lineTo(420, 420); x.lineTo(760, 900); x.closePath(); x.fill();
  x.fillStyle = '#5d84ad';
  x.beginPath(); x.moveTo(560, 900); x.lineTo(1020, 330); x.lineTo(1420, 900); x.closePath(); x.fill();
  x.fillStyle = '#ffffff';
  x.beginPath(); x.moveTo(935, 415); x.lineTo(1020, 330); x.lineTo(1105, 415); x.lineTo(1050, 400); x.lineTo(1020, 435); x.lineTo(985, 398); x.closePath(); x.fill();
  x.fillStyle = '#6a9a5f'; x.fillRect(0, 900, 1920, 380);
  x.fillStyle = '#59824f';
  for (let i = 0; i < 40; i++) {
    const px = (i * 173) % 1920, ph = 40 + (i * 37) % 90;
    x.beginPath(); x.moveTo(px, 900 + ph); x.lineTo(px + 18, 900); x.lineTo(px + 36, 900 + ph); x.closePath(); x.fill();
  }
  return c;
}
function getDummyPhoto() {
  if (!dummyCanvas) dummyCanvas = makeDummyPhoto();
  return dummyCanvas;
}

/* ================= レイヤーの描画 =================
   合成規則: 配列の先頭が一番下。書き出し寸法で描き、プレビューは縮小表示する。
   サイズ指定は原則「キャンバスの短辺に対する%」で持ち、比率が変わっても相対サイズを保つ。 */

const E = window.FrameEngine;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** アート層: 全面フィット（引き伸ばし）で描き、フィットモードの処理を適用する */
function renderArtLayer(layer, W, H) {
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const img = imageElement(layer.imageId);
  if (!img || !img.complete || img.naturalWidth === 0) return c;
  x.drawImage(img, 0, 0, W, H);
  const imageData = x.getImageData(0, 0, W, H);
  if (layer.fit === 'keyout') E.applyKeyout(imageData);
  else if (layer.fit === 'edge') E.applyEdgeMask(imageData);
  else if (layer.fit === 'cutout') { E.applyKeyout(imageData); E.applyCenterCutout(imageData); }
  else if (layer.fit === 'band') { E.applyKeyout(imageData); E.applyBandOnly(imageData, { side: layer.bandSide || 'top' }); }
  x.putImageData(imageData, 0, 0);
  return c;
}

const ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
function anchorPoint(anchor, W, H, w, h) {
  const ax = anchor[1] === 'l' ? 0 : anchor[1] === 'c' ? (W - w) / 2 : W - w;
  const ay = anchor[0] === 't' ? 0 : anchor[0] === 'm' ? (H - h) / 2 : H - h;
  return { x: ax, y: ay };
}

/** モチーフ層: サイズは短辺に対する%。白背景素材はキーアウトしてから置く */
function renderMotifLayer(layer, W, H) {
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const img = imageElement(layer.imageId);
  if (!img || !img.complete || img.naturalWidth === 0) return c;
  const short = Math.min(W, H);
  const w = Math.round(short * (layer.sizePct / 100));
  const h = Math.round(w * (img.naturalHeight / img.naturalWidth));
  const src = makeCanvas(img.naturalWidth, img.naturalHeight);
  const sx = src.getContext('2d');
  sx.drawImage(img, 0, 0);
  if (layer.keyout) {
    const d = sx.getImageData(0, 0, src.width, src.height);
    E.applyKeyout(d);
    sx.putImageData(d, 0, 0);
  }
  const p = anchorPoint(layer.pos, W, H, w, h);
  x.drawImage(src, p.x, p.y, w, h);
  return c;
}

/** 基本フレーム層の描画モチーフ（ドット／星／ハート／ダイヤ） */
function drawMotifShape(x, kind, cx, cy, s, color) {
  x.fillStyle = color;
  x.beginPath();
  if (kind === 'dot') {
    x.arc(cx, cy, s / 2, 0, Math.PI * 2);
  } else if (kind === 'diamond') {
    x.moveTo(cx, cy - s / 2); x.lineTo(cx + s / 2, cy); x.lineTo(cx, cy + s / 2); x.lineTo(cx - s / 2, cy); x.closePath();
  } else if (kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? s / 2 : s / 5;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
  } else if (kind === 'heart') {
    x.moveTo(cx, cy + s * 0.35);
    x.bezierCurveTo(cx - s * 0.6, cy - s * 0.1, cx - s * 0.3, cy - s * 0.55, cx, cy - s * 0.2);
    x.bezierCurveTo(cx + s * 0.3, cy - s * 0.55, cx + s * 0.6, cy - s * 0.1, cx, cy + s * 0.35);
  }
  x.fill();
}

/** 基本フレーム層: テンプレート6種。太さ・帯の高さは短辺に対する% */
function renderBasicLayer(layer, W, H) {
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const short = Math.min(W, H);
  const th = Math.max(1, Math.round(short * (layer.thicknessPct / 100)));
  const bandH = Math.round(H * (layer.bandPct / 100));
  x.strokeStyle = layer.color;
  x.fillStyle = layer.color;
  x.lineWidth = th;

  if (layer.template === 'double') {
    x.strokeRect(th / 2, th / 2, W - th, H - th);
    const i2 = th * 2.2;
    x.strokeRect(i2, i2, W - i2 * 2, H - i2 * 2);
  } else if (layer.template === 'frame-band') {
    x.strokeRect(th / 2, th / 2, W - th, H - th);
    x.fillRect(0, H - bandH, W, bandH);
  } else if (layer.template === 'band') {
    x.fillRect(0, H - bandH, W, bandH);
  } else if (layer.template === 'corners') {
    const len = Math.round(short * 0.12);
    const inset = th;
    x.beginPath();
    for (const [cx, cy, dx, dy] of [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1]]) {
      x.moveTo(cx + dx * len, cy);
      x.lineTo(cx, cy);
      x.lineTo(cx, cy + dy * len);
    }
    x.stroke();
  } else if (layer.template === 'edge-motifs') {
    const kind = layer.motif === 'none' ? 'dot' : layer.motif;
    const s = th * 2.4, gap = s * 1.8, inset = th * 1.6;
    for (let px = inset; px <= W - inset; px += gap) {
      drawMotifShape(x, kind, px, inset, s, layer.color);
      drawMotifShape(x, kind, px, H - inset, s, layer.color);
    }
    for (let py = inset + gap; py <= H - inset - gap; py += gap) {
      drawMotifShape(x, kind, inset, py, s, layer.color);
      drawMotifShape(x, kind, W - inset, py, s, layer.color);
    }
  } else if (layer.template === 'minimal') {
    x.lineWidth = Math.max(1, Math.round(th / 2));
    const i = Math.round(short * 0.015);
    x.strokeRect(i, i, W - i * 2, H - i * 2);
  }

  // 描画モチーフ（縁まわり飾り以外）: 下帯や下辺に沿って等間隔に置く
  if (layer.motif !== 'none' && layer.template !== 'edge-motifs') {
    const s = th * 2.2, gap = s * 1.9;
    const y = (layer.template === 'frame-band' || layer.template === 'band')
      ? H - bandH / 2
      : H - th * 2.4;
    for (let px = gap; px <= W - gap; px += gap) {
      drawMotifShape(x, layer.motif, px, y, s, layer.template === 'frame-band' || layer.template === 'band' ? '#ffffff' : layer.color);
    }
  }
  return c;
}

const FONTS = {
  gothic: 'sans-serif',
  mincho: 'serif',
  round: '"Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", sans-serif',
  hand: '"Hiragino Mincho ProN", "Comic Sans MS", cursive',
};

/** テキスト層: 生成画像に文字を入れさせないための担当。9アンカー、サイズは短辺に対する% */
function renderTextLayer(layer, W, H) {
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const short = Math.min(W, H);
  const mainSize = Math.round(short * (layer.sizePct / 100));
  const subSize = Math.round(mainSize * 0.55);
  const pad = Math.round(short * 0.04);
  const lines = [];
  if (layer.main) lines.push({ text: layer.main, size: mainSize });
  if (layer.sub) lines.push({ text: layer.sub, size: subSize });
  if (lines.length === 0) return c;
  const lineGap = Math.round(mainSize * 0.35);
  const blockH = lines.reduce((a, l) => a + l.size, 0) + lineGap * (lines.length - 1);
  let maxW = 0;
  for (const l of lines) {
    x.font = `${l.size}px ${FONTS[layer.font] || FONTS.gothic}`;
    maxW = Math.max(maxW, x.measureText(l.text).width);
  }
  const blockW = Math.ceil(maxW);
  const origin = anchorPoint(layer.anchor, W, H, blockW + pad * 2, blockH + pad * 2);
  const boxX = origin.x, boxY = origin.y;

  if (layer.bandBg) {
    x.fillStyle = layer.bandColor;
    x.fillRect(boxX, boxY, blockW + pad * 2, blockH + pad * 2);
  }
  let cy = boxY + pad;
  for (const l of lines) {
    x.font = `${l.size}px ${FONTS[layer.font] || FONTS.gothic}`;
    x.textBaseline = 'top';
    const tw = x.measureText(l.text).width;
    let tx = boxX + pad;
    if (layer.align === 'center') tx = boxX + (blockW + pad * 2 - tw) / 2;
    else if (layer.align === 'right') tx = boxX + pad + (blockW - tw);
    if (layer.halo) {
      x.lineWidth = Math.max(2, Math.round(l.size / 7));
      x.lineJoin = 'round';
      x.strokeStyle = layer.haloColor;
      x.strokeText(l.text, tx, cy);
    }
    x.fillStyle = layer.color;
    x.fillText(l.text, tx, cy);
    cy += l.size + lineGap;
  }
  return c;
}

function renderLayer(layer, W, H) {
  if (layer.type === 'art') return renderArtLayer(layer, W, H);
  if (layer.type === 'motif') return renderMotifLayer(layer, W, H);
  if (layer.type === 'basic') return renderBasicLayer(layer, W, H);
  if (layer.type === 'text') return renderTextLayer(layer, W, H);
  return makeCanvas(W, H);
}

/**
 * 全レイヤーを合成する。
 * @param opts.excludeMotif 検証用: モチーフ層を除いて合成する（§5-2）
 * @param opts.onlyMotif    検証用: モチーフ層だけを合成する（警告判定）
 */
function compose(W, H, opts = {}) {
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    if (opts.excludeMotif && layer.type === 'motif') continue;
    if (opts.onlyMotif && layer.type !== 'motif') continue;
    x.globalAlpha = layer.opacity;
    x.drawImage(renderLayer(layer, W, H), 0, 0);
  }
  x.globalAlpha = 1;
  return c;
}

/* ================= プレビュー ================= */

function drawChecker(x, W, H, cell) {
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#c9ced6';
  for (let yy = 0; yy < H; yy += cell) {
    for (let xx = 0; xx < W; xx += cell) {
      if (((xx / cell) + (yy / cell)) % 2 === 0) x.fillRect(xx, yy, cell, cell);
    }
  }
}

function renderPreview() {
  const { width: W, height: H } = E.SIZES[state.ratio];
  const frame = compose(W, H);
  const pv = document.getElementById('preview');
  const scale = Math.min(1, 480 / W, 600 / H);
  pv.width = Math.round(W * scale);
  pv.height = Math.round(H * scale);
  const x = pv.getContext('2d');
  if (state.bg === 'checker') drawChecker(x, pv.width, pv.height, 16);
  else if (state.bg === 'white') { x.fillStyle = '#fff'; x.fillRect(0, 0, pv.width, pv.height); }
  else if (state.bg === 'black') { x.fillStyle = '#000'; x.fillRect(0, 0, pv.width, pv.height); }
  else if (state.bg === 'dummy') x.drawImage(getDummyPhoto(), 0, 0, pv.width, pv.height);
  x.drawImage(frame, 0, 0, pv.width, pv.height);
  renderVerify();
}

/* ================= 検証（§5。結果を表示し、失敗したら書き出さない） ================= */

function currentValidation() {
  const { width: W, height: H } = E.SIZES[state.ratio];
  const withoutMotif = compose(W, H, { excludeMotif: true });
  const motifOnly = compose(W, H, { onlyMotif: true });
  const ctx = withoutMotif.getContext('2d');
  const mtx = motifOnly.getContext('2d');
  return E.validateExport(
    ctx.getImageData(0, 0, W, H), state.ratio,
    mtx.getImageData(0, 0, W, H));
}

function renderVerify() {
  const v = currentValidation();
  const el = document.getElementById('verifyResults');
  const mark = (ok) => ok ? '<span class="ok">✓</span>' : '<span class="ng">✗</span>';
  el.innerHTML =
    `${mark(v.sizeOk)} 実寸チェック（${E.SIZES[state.ratio].width}×${E.SIZES[state.ratio].height}）<br>` +
    `${mark(v.centerOk)} 中央の完全透過チェック（中央内の不透明ピクセル: ${v.centerOpaquePx}）<br>` +
    `${mark(v.drawingOk)} 描画チェック<br>` +
    (v.motifWarning
      ? `<span class="warn">⚠ モチーフが中央にかかっています（${v.motifCenterPx}px）。意図した配置か目で確認してください</span>`
      : 'モチーフの中央警告なし');
  return v;
}

/* ================= 書き出しとギャラリー ================= */

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function snapshotLayers() {
  return JSON.parse(JSON.stringify(state.layers));
}

async function recordGallery(canvas, ratio) {
  // サムネイルはチェッカー背景に合成して長辺約480px
  const { width: W, height: H } = E.SIZES[ratio];
  const s = 480 / Math.max(W, H);
  const th = makeCanvas(Math.round(W * s), Math.round(H * s));
  const tx = th.getContext('2d');
  drawChecker(tx, th.width, th.height, 12);
  tx.drawImage(canvas, 0, 0, th.width, th.height);
  state.gallery.unshift({
    thumb: th.toDataURL('image/png'),
    ratio,
    datetime: new Date().toISOString(),
    theme: state.theme,
    fileName: E.fileNameFor(ratio, state.theme),
    layers: snapshotLayers(),
  });
  state.gallery = state.gallery.slice(0, 60); // 60件を超えたら古い順に自動削除
  save();
  renderGallery();
}

async function exportRatio(ratio, { record = true } = {}) {
  const { width: W, height: H } = E.SIZES[ratio];
  const saved = state.ratio;
  state.ratio = ratio;
  const v = currentValidation();
  state.ratio = saved;
  if (!v.ok) {
    alert(`検証に失敗したため書き出しません（実寸:${v.sizeOk} 中央透過:${v.centerOk} 描画:${v.drawingOk}）`);
    return null;
  }
  const canvas = compose(W, H);
  if (record) await recordGallery(canvas, ratio);
  return canvas;
}

async function exportOne() {
  const canvas = await exportRatio(state.ratio);
  if (canvas) download(await canvasToBlob(canvas), E.fileNameFor(state.ratio, state.theme));
}

/* 最小の ZIP 書き出し（無圧縮ストア形式。外部ライブラリに依存しない） */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  // files: [{ name, bytes: Uint8Array }]
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 filename
    local.setUint16(8, 0, true);      // store
    local.setUint32(14, crc, true);
    local.setUint32(18, f.bytes.length, true);
    local.setUint32(22, f.bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, f.bytes);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.bytes.length, true);
    cen.setUint32(24, f.bytes.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + f.bytes.length;
  }
  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

async function exportAll() {
  const files = [];
  for (const ratio of E.RATIOS) {
    const canvas = await exportRatio(ratio);
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    files.push({ name: E.fileNameFor(ratio, state.theme), bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  download(makeZip(files), 'encadra-frames.zip');
}

function renderGallery() {
  const g = document.getElementById('gallery');
  g.innerHTML = '';
  state.gallery.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'gItem';
    div.innerHTML = `<img src="${item.thumb}" alt="">
      <div>${item.ratio} / ${new Date(item.datetime).toLocaleString()}</div>
      <div>${item.fileName}</div>
      <div class="row">
        <button data-act="restore">呼び出す</button>
        <button data-act="redl">再ダウンロード</button>
        <button data-act="del">削除</button>
      </div>`;
    div.querySelectorAll('button').forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.act === 'restore') {
          state.layers = JSON.parse(JSON.stringify(item.layers));
          state.theme = item.theme;
          state.ratio = item.ratio;
          save(); refreshAll();
        } else if (b.dataset.act === 'redl') {
          state.layers = JSON.parse(JSON.stringify(item.layers));
          const canvas = await exportRatio(item.ratio, { record: false });
          if (canvas) download(await canvasToBlob(canvas), item.fileName);
          refreshAll();
        } else if (b.dataset.act === 'del') {
          if (confirm('この記録を削除しますか？')) {
            state.gallery.splice(idx, 1);
            save(); renderGallery();
          }
        }
      };
    });
    g.appendChild(div);
  });
}

/* ================= テンプレート ================= */

function renderTemplates() {
  const el = document.getElementById('templateList');
  el.innerHTML = '';
  for (const name of Object.keys(state.templates)) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${name}</span>`;
    const loadB = document.createElement('button');
    loadB.textContent = '読み込み';
    loadB.onclick = () => {
      state.layers = JSON.parse(JSON.stringify(state.templates[name]));
      save(); refreshAll();
    };
    const delB = document.createElement('button');
    delB.textContent = '削除';
    delB.onclick = () => { delete state.templates[name]; save(); renderTemplates(); };
    row.append(loadB, delB);
    el.appendChild(row);
  }
}

/* ================= Museへの依頼文（§2.2の雛形どおりに組み立てる） ================= */

let requestKind = 'art';
function renderRequest() {
  const { width, height } = E.SIZES[state.ratio];
  const theme = state.theme || '（テーマ）';
  const text = requestKind === 'art'
    ? `テーマ「${theme}」で、写真フレームの素材になる絵を1枚生成してください。条件: 画角は ${state.ratio}（${width}×${height}px相当）。モチーフや飾りは画像の縁の周りの帯（幅・高さの15%程度の内側）だけに配置し、モチーフは欠けずに全体を描いてください。中央は白一色で完全に空けてください。画像の中に文字は入れないでください。`
    : `テーマ「${theme}」のモチーフを1つ、白一色の背景の上に大きく生成してください。条件: モチーフは欠けずに全体を描いてください。画像の中に文字は入れないでください。`;
  document.getElementById('requestText').value = text;
}

/* ================= レイヤー一覧と編集 ================= */

let selectedLayerId = null;

const LAYER_DEFAULTS = {
  art: () => ({ id: uid('art'), type: 'art', visible: true, opacity: 1, imageId: null, fit: 'keyout', bandSide: 'top' }),
  motif: () => ({ id: uid('motif'), type: 'motif', visible: true, opacity: 1, imageId: null, pos: 'tl', sizePct: 25, keyout: true }),
  basic: () => Object.assign(defaultBasic(), {}),
  text: () => ({
    id: uid('text'), type: 'text', visible: true, opacity: 1,
    main: '', sub: '', anchor: 'bc', align: 'center', font: 'gothic',
    color: '#333333', sizePct: 6, halo: true, haloColor: '#ffffff', bandBg: false, bandColor: '#000000',
  }),
};

function typeName(type) { return t(type); }

function layerDisplayName(layer) {
  return layer.name || typeName(layer.type);
}

function renderLayerList() {
  const el = document.getElementById('layerList');
  el.innerHTML = '';
  // 上にある層が手前。一覧は手前から表示する
  [...state.layers].reverse().forEach((layer) => {
    const idx = state.layers.indexOf(layer);
    const row = document.createElement('div');
    row.className = 'layerItem' + (layer.id === selectedLayerId ? ' selected' : '');
    row.innerHTML = `
      <input type="checkbox" ${layer.visible ? 'checked' : ''} data-k="visible">
      <span class="name">${layerDisplayName(layer)}</span>
      <input type="range" min="0" max="1" step="0.05" value="${layer.opacity}" data-k="opacity" title="opacity">
      <button data-k="up">↑</button><button data-k="down">↓</button>
      <button data-k="del">×</button>`;
    row.querySelector('[data-k="visible"]').onchange = (e) => { layer.visible = e.target.checked; save(); renderPreview(); };
    row.querySelector('[data-k="opacity"]').oninput = (e) => { layer.opacity = Number(e.target.value); renderPreview(); };
    row.querySelector('[data-k="opacity"]').onchange = () => save();
    row.querySelector('[data-k="up"]').onclick = () => {
      if (idx < state.layers.length - 1) { [state.layers[idx], state.layers[idx + 1]] = [state.layers[idx + 1], state.layers[idx]]; save(); refreshAll(); }
    };
    row.querySelector('[data-k="down"]').onclick = () => {
      if (idx > 0) { [state.layers[idx], state.layers[idx - 1]] = [state.layers[idx - 1], state.layers[idx]]; save(); refreshAll(); }
    };
    row.querySelector('[data-k="del"]').onclick = () => {
      if (confirm('このレイヤーを削除しますか？')) {
        state.layers.splice(idx, 1);
        if (selectedLayerId === layer.id) selectedLayerId = null;
        save(); refreshAll();
      }
    };
    row.querySelector('.name').onclick = () => { selectedLayerId = layer.id; renderLayerList(); renderEditor(); };
    el.appendChild(row);
  });
}

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild;
}

function renderEditor() {
  const ed = document.getElementById('layerEditor');
  ed.innerHTML = '';
  const layer = state.layers.find((l) => l.id === selectedLayerId);
  if (!layer) { ed.innerHTML = '<p class="small">レイヤー名をタップすると編集できます</p>'; return; }
  const upd = () => { save(); renderPreview(); };

  const imageRow = (target) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="row">
        <input type="file" accept="image/png,image/jpeg,image/webp">
        <span class="small">ファイル選択／この欄へドラッグ＆ドロップ</span>
      </div>`;
    const input = wrap.querySelector('input');
    const apply = async (file) => {
      if (!file) return;
      target.imageId = storeImage(await fileToDataURL(file));
      const img = imageElement(target.imageId);
      img.onload = () => { save(); refreshAll(); };
      save(); refreshAll();
    };
    input.onchange = () => apply(input.files[0]);
    wrap.ondragover = (e) => e.preventDefault();
    wrap.ondrop = (e) => { e.preventDefault(); apply(e.dataTransfer.files[0]); };
    return wrap;
  };

  if (layer.type === 'art' || layer.type === 'motif') ed.appendChild(imageRow(layer));

  if (layer.type === 'art') {
    ed.appendChild(el(`<label>フィット
      <select id="fit">
        <option value="keyout">白地を透過化（自動・推奨）</option>
        <option value="edge">縁マスク</option>
        <option value="cutout">全面＋中央くり抜き</option>
        <option value="band">帯のみ</option>
      </select></label>`));
    ed.querySelector('#fit').value = layer.fit;
    ed.querySelector('#fit').onchange = (e) => { layer.fit = e.target.value; upd(); renderEditor(); };
    if (layer.fit === 'band') {
      ed.appendChild(el(`<label>帯の位置
        <select id="bandSide"><option value="top">上帯</option><option value="bottom">下帯</option></select></label>`));
      ed.querySelector('#bandSide').value = layer.bandSide;
      ed.querySelector('#bandSide').onchange = (e) => { layer.bandSide = e.target.value; upd(); };
    }
  }

  if (layer.type === 'motif') {
    ed.appendChild(el(`<label>配置
      <select id="pos">${ANCHORS.map((a) => `<option value="${a}">${a}</option>`).join('')}</select></label>`));
    ed.querySelector('#pos').value = layer.pos;
    ed.querySelector('#pos').onchange = (e) => { layer.pos = e.target.value; upd(); };
    ed.appendChild(el(`<label>サイズ（短辺比%）<input type="number" id="sizePct" min="3" max="90" value="${layer.sizePct}"></label>`));
    ed.querySelector('#sizePct').onchange = (e) => { layer.sizePct = Number(e.target.value); upd(); };
    ed.appendChild(el(`<label><input type="checkbox" id="keyout" ${layer.keyout ? 'checked' : ''}> 白地を透過化</label>`));
    ed.querySelector('#keyout').onchange = (e) => { layer.keyout = e.target.checked; upd(); };
  }

  if (layer.type === 'basic') {
    ed.appendChild(el(`<label>テンプレート
      <select id="tpl">
        <option value="double">二重ライン</option>
        <option value="frame-band">太枠＋下帯</option>
        <option value="band">下帯のみ</option>
        <option value="corners">四隅の飾り</option>
        <option value="edge-motifs">縁まわり飾り</option>
        <option value="minimal">ミニマル</option>
      </select></label>`));
    ed.querySelector('#tpl').value = layer.template;
    ed.querySelector('#tpl').onchange = (e) => { layer.template = e.target.value; upd(); };
    ed.appendChild(el(`<label>色 <input type="color" id="color" value="${layer.color}"></label>`));
    ed.querySelector('#color').oninput = (e) => { layer.color = e.target.value; upd(); };
    ed.appendChild(el(`<label>太さ（短辺比%）<input type="number" id="th" min="0.5" max="8" step="0.5" value="${layer.thicknessPct}"></label>`));
    ed.querySelector('#th').onchange = (e) => { layer.thicknessPct = Number(e.target.value); upd(); };
    ed.appendChild(el(`<label>帯の高さ（%）<input type="number" id="band" min="5" max="30" value="${layer.bandPct}"></label>`));
    ed.querySelector('#band').onchange = (e) => { layer.bandPct = Number(e.target.value); upd(); };
    ed.appendChild(el(`<label>描画モチーフ
      <select id="dm">
        <option value="none">なし</option><option value="dot">ドット</option>
        <option value="star">星</option><option value="heart">ハート</option><option value="diamond">ダイヤ</option>
      </select></label>`));
    ed.querySelector('#dm').value = layer.motif;
    ed.querySelector('#dm').onchange = (e) => { layer.motif = e.target.value; upd(); };
  }

  if (layer.type === 'text') {
    ed.appendChild(el(`<label>メインテキスト <input type="text" id="main" value="${layer.main.replace(/"/g, '&quot;')}"></label>`));
    ed.querySelector('#main').oninput = (e) => { layer.main = e.target.value; upd(); };
    ed.appendChild(el(`<label>サブテキスト <input type="text" id="sub" value="${layer.sub.replace(/"/g, '&quot;')}"></label>`));
    ed.querySelector('#sub').oninput = (e) => { layer.sub = e.target.value; upd(); };
    ed.appendChild(el(`<label>位置
      <select id="anchor">${ANCHORS.map((a) => `<option value="${a}">${a}</option>`).join('')}</select></label>`));
    ed.querySelector('#anchor').value = layer.anchor;
    ed.querySelector('#anchor').onchange = (e) => { layer.anchor = e.target.value; upd(); };
    ed.appendChild(el(`<label>揃え
      <select id="align"><option value="left">左</option><option value="center">中央</option><option value="right">右</option></select></label>`));
    ed.querySelector('#align').value = layer.align;
    ed.querySelector('#align').onchange = (e) => { layer.align = e.target.value; upd(); };
    ed.appendChild(el(`<label>書体
      <select id="font">
        <option value="gothic">ゴシック</option><option value="mincho">明朝</option>
        <option value="round">丸ゴシック</option><option value="hand">手書き風</option>
      </select></label>`));
    ed.querySelector('#font').value = layer.font;
    ed.querySelector('#font').onchange = (e) => { layer.font = e.target.value; upd(); };
    ed.appendChild(el(`<label>色 <input type="color" id="color" value="${layer.color}"></label>`));
    ed.querySelector('#color').oninput = (e) => { layer.color = e.target.value; upd(); };
    ed.appendChild(el(`<label>サイズ（短辺比%）<input type="number" id="sizePct" min="2" max="20" value="${layer.sizePct}"></label>`));
    ed.querySelector('#sizePct').onchange = (e) => { layer.sizePct = Number(e.target.value); upd(); };
    ed.appendChild(el(`<label><input type="checkbox" id="halo" ${layer.halo ? 'checked' : ''}> 白フチ</label>`));
    ed.querySelector('#halo').onchange = (e) => { layer.halo = e.target.checked; upd(); };
    ed.appendChild(el(`<label><input type="checkbox" id="bandBg" ${layer.bandBg ? 'checked' : ''}> 帯背景</label>`));
    ed.querySelector('#bandBg').onchange = (e) => { layer.bandBg = e.target.checked; upd(); };
  }
}

/* ================= 直接投入の経路（§2.1） =================
   会話の中で生成した画像を、ユーザーの手作業なしにレイヤーへ入れるための口。
   Space への移植時は、この口を Space の保存の仕組みに接続すること。 */

window.FrameMakerAPI = {
  version: SHEET_VERSION,
  /** 生成画像（dataURL）をアート層またはモチーフ層へ直接入れる */
  addGeneratedImage(dataURL, targetType = 'art') {
    const layer = LAYER_DEFAULTS[targetType]();
    layer.imageId = storeImage(dataURL);
    const img = imageElement(layer.imageId);
    img.onload = () => refreshAll();
    state.layers.push(layer);
    selectedLayerId = layer.id;
    save(); refreshAll();
    return layer.id;
  },
  setTheme(theme) { state.theme = theme; document.getElementById('theme').value = theme; save(); renderRequest(); },
  getState() { return JSON.parse(JSON.stringify(state)); },
};

/* ================= 画面の配線 ================= */

function refreshAll() {
  renderLayerList();
  renderEditor();
  renderPreview();
  renderTemplates();
  renderGallery();
  renderRequest();
}

function applyStaticTexts() {
  document.getElementById('sheetVersion').textContent = t('version') + SHEET_VERSION;
  document.getElementById('howto').textContent = t('howto');
  document.getElementById('themeLabel').textContent = t('theme');
  document.getElementById('ratioLabel').textContent = t('ratio');
  document.getElementById('verifyTitle').textContent = t('verify');
  document.getElementById('exportOne').textContent = t('exportOne');
  document.getElementById('exportAll').textContent = t('exportAll');
  document.getElementById('layersTitle').textContent = t('layers');
  document.getElementById('requestTitle').textContent = t('request');
  document.getElementById('reqArt').textContent = t('reqArt');
  document.getElementById('reqMotif').textContent = t('reqMotif');
  document.getElementById('reqCopy').textContent = t('reqCopy');
  document.getElementById('templateTitle').textContent = t('templates');
  document.getElementById('templateSave').textContent = t('tplSave');
  document.getElementById('galleryTitle').textContent = t('gallery');
  document.getElementById('footerNote').textContent = t('footer');
}

function init() {
  load();
  if (state.version !== SHEET_VERSION) state.version = SHEET_VERSION;

  const ratioBox = document.getElementById('ratioButtons');
  for (const r of E.RATIOS) {
    const b = document.createElement('button');
    b.textContent = r;
    b.className = r === state.ratio ? 'active' : '';
    b.onclick = () => {
      state.ratio = r; save();
      ratioBox.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.textContent === r));
      renderPreview(); renderRequest();
    };
    ratioBox.appendChild(b);
  }

  const bgBox = document.getElementById('bgButtons');
  for (const [key, labelKey] of [['checker', 'bgChecker'], ['dummy', 'bgDummy'], ['white', 'bgWhite'], ['black', 'bgBlack']]) {
    const b = document.createElement('button');
    b.textContent = t(labelKey);
    b.className = key === state.bg ? 'active' : '';
    b.onclick = () => {
      state.bg = key; save();
      bgBox.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      renderPreview();
    };
    bgBox.appendChild(b);
  }

  const addBox = document.getElementById('addLayerButtons');
  for (const [type, labelKey] of [['art', 'addArt'], ['motif', 'addMotif'], ['basic', 'addBasic'], ['text', 'addText']]) {
    const b = document.createElement('button');
    b.textContent = t(labelKey);
    b.onclick = () => {
      const layer = LAYER_DEFAULTS[type]();
      state.layers.push(layer);
      selectedLayerId = layer.id;
      save(); refreshAll();
    };
    addBox.appendChild(b);
  }

  const themeInput = document.getElementById('theme');
  themeInput.value = state.theme;
  themeInput.oninput = () => { state.theme = themeInput.value; save(); renderRequest(); };

  document.getElementById('exportOne').onclick = exportOne;
  document.getElementById('exportAll').onclick = exportAll;
  document.getElementById('reqArt').onclick = () => { requestKind = 'art'; renderRequest(); };
  document.getElementById('reqMotif').onclick = () => { requestKind = 'motif'; renderRequest(); };
  document.getElementById('reqCopy').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('requestText').value);
  };
  document.getElementById('templateSave').onclick = () => {
    const name = document.getElementById('templateName').value.trim();
    if (!name) return;
    state.templates[name] = snapshotLayers();
    save(); renderTemplates();
  };
  document.getElementById('langJa').onclick = () => { state.lang = 'ja'; save(); applyStaticTexts(); refreshAll(); };
  document.getElementById('langEn').onclick = () => { state.lang = 'en'; save(); applyStaticTexts(); refreshAll(); };

  applyStaticTexts();
  refreshAll();
}

document.addEventListener('DOMContentLoaded', init);

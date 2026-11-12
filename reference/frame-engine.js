/**
 * Encadra Frame Maker — reference engine
 *
 * フレーム生成の核になる処理の参照実装です。指示書（README.md）の仕様のうち、
 * 解釈が分かれると困る計算を、移植可能な形で固定します。
 * This module fixes the calculations that must not vary between implementations:
 * export sizes, the white key-out formula, art-layer fit masks (including the
 * v0.14 white-frame fits: as-is alpha and window-only flood fill), filename rules,
 * and the export validation checks (README §4 / §6).
 * v0.17: for white-frame fits, §6 item 5 (validateWhiteFrame, window derived
 * from the actual transparent region) replaces item 2 (center cutout) as the
 * export gate; item 2 is not applicable to those designs.
 *
 * 使い方 / How to use:
 * - ピクセル処理は { data: Uint8ClampedArray, width, height } 形式の
 *   ImageData 互換オブジェクトに対して動作します（ブラウザの ImageData がそのまま使えます）。
 * - Space の実装では、このファイルの関数をそのまま取り込むか、同じ計算になるよう実装してください。
 *
 * MIT License — see ../LICENSE
 */

'use strict';

/* ------------------------------------------------------------------ */
/* §4 書き出し寸法（長辺1920px統一）                                    */
/* ------------------------------------------------------------------ */

const SIZES = Object.freeze({
  '1:1':  { width: 1920, height: 1920 },
  '4:5':  { width: 1536, height: 1920 },
  '3:2':  { width: 1920, height: 1280 },
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
});

const RATIOS = Object.freeze(Object.keys(SIZES));

/** Encadra 側の取り込み上限（長辺）。本仕様の寸法はすべてこの範囲内。 */
const ENCADRA_MAX_LONG_EDGE = 4096;

/* ------------------------------------------------------------------ */
/* §4 中央の完全透過の対象矩形（中央内側60%）                            */
/* ------------------------------------------------------------------ */

/**
 * 中央内側60%の矩形を返す。幅・高さとも中央の60%。
 * 検証（§6）と「全面＋中央くり抜き」フィットで同じ矩形を使うこと。
 */
function centerRect(width, height) {
  const w = Math.round(width * 0.6);
  const h = Math.round(height * 0.6);
  return {
    x: Math.floor((width - w) / 2),
    y: Math.floor((height - h) / 2),
    width: w,
    height: h,
  };
}

/* ------------------------------------------------------------------ */
/* §4 白地を透過化（キーアウト）— 計算はこの1式で固定                  */
/* ------------------------------------------------------------------ */

/**
 * 白からの距離 d = 255 − min(R, G, B) に対する係数 k。
 *   d ≤ 16      → k = 0
 *   16 < d < 80 → k = (d − 16) / 64
 *   d ≥ 80      → k = 1
 */
function keyoutFactor(r, g, b) {
  const d = 255 - Math.min(r, g, b);
  if (d <= 16) return 0;
  if (d >= 80) return 1;
  return (d - 16) / 64;
}

/**
 * 画像全体にキーアウトを適用する（破壊的に書き換える）。
 * 出力アルファ = 元のアルファ × k。これ以外の解釈をしないこと
 * （補間の結果にさらに元のアルファを掛ける等の二重適用は禁止）。
 * @returns 同じオブジェクト（チェーン用）
 */
function applyKeyout(imageData) {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const k = keyoutFactor(data[i], data[i + 1], data[i + 2]);
    data[i + 3] = Math.round(data[i + 3] * k);
  }
  return imageData;
}

/* ------------------------------------------------------------------ */
/* §4 アート層の予備フィット（縁マスク／中央くり抜き／帯のみ）         */
/* ------------------------------------------------------------------ */

/** 矩形の内側にあるピクセルの、境界からの距離（ピクセル）。外側は負。 */
function distanceInsideRect(x, y, rect) {
  const dx = Math.min(x - rect.x, rect.x + rect.width - 1 - x);
  const dy = Math.min(y - rect.y, rect.y + rect.height - 1 - y);
  return Math.min(dx, dy);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 縁マスク: 絵を縁のゾーンだけに残し、中央を取り除く。
 * 帯の幅は、左右と上が bandRatio（既定 0.08 = 8%、参照Spaceの「縁の幅」の既定）、
 * 下が bottomRatio（既定 0.15 = 15%、同「帯の高さ」の既定）。
 * 内側の境界には小さい方の辺の featherRatio（既定 0.03 = 約3%）の
 * フェザーを付け、切断面を目立たせない。
 */
function applyEdgeMask(imageData, { bandRatio = 0.08, bottomRatio = 0.15, featherRatio = 0.03 } = {}) {
  const { data, width, height } = imageData;
  const ix = Math.round(width * bandRatio);
  const iy = Math.round(height * bandRatio);
  const ib = Math.round(height * bottomRatio);
  const inner = {
    x: ix,
    y: iy,
    width: width - ix * 2,
    height: height - iy - ib,
  };
  const feather = Math.max(1, Math.round(Math.min(width, height) * featherRatio));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist = distanceInsideRect(x, y, inner);
      if (dist < 0) continue; // 帯の内側（縁ゾーン）はそのまま
      const m = clamp01(1 - (dist + 1) / feather);
      const i = (y * width + x) * 4;
      data[i + 3] = Math.round(data[i + 3] * m);
    }
  }
  return imageData;
}

/**
 * 全面＋中央くり抜き: 中央内側60%の矩形（centerRect と同じ）を透過にする。
 * 境界のフェザーは付けない（検証対象の矩形と一致させるため）。
 */
function applyCenterCutout(imageData) {
  const { data, width, height } = imageData;
  const rect = centerRect(width, height);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      data[(y * width + x) * 4 + 3] = 0;
    }
  }
  return imageData;
}

/**
 * 帯のみ: 上帯または下帯だけを残す。
 * 帯の高さはキャンバスの高さの bandRatio（既定 0.15 = 15%、参照Spaceの既定）。
 */
function applyBandOnly(imageData, { side = 'top', bandRatio = 0.15 } = {}) {
  const { data, width, height } = imageData;
  const band = Math.round(height * bandRatio);
  for (let y = 0; y < height; y++) {
    const inBand = side === 'top' ? y < band : y >= height - band;
    if (inBand) continue;
    for (let x = 0; x < width; x++) {
      data[(y * width + x) * 4 + 3] = 0;
    }
  }
  return imageData;
}


/* ------------------------------------------------------------------ */
/* v0.14 白地フレーム用のはめ方（そのまま／窓だけ抜く）                  */
/* ------------------------------------------------------------------ */

/**
 * 透明ピクセルの割合（アルファが threshold 以下のピクセルの比率）。
 * 取り込んだ画像が既に窓抜き済みかどうか（「そのまま」の推奨判定）に使う。
 */
function transparentRatio(imageData, threshold = 10) {
  const { data } = imageData;
  let t = 0, n = 0;
  for (let i = 3; i < data.length; i += 4) { n++; if (data[i] <= threshold) t++; }
  return n ? t / n : 0;
}

/**
 * 窓だけ抜く: 中央ピクセルの色を起点に、色の距離が tolerance 以内で
 * 4方向につながっている領域だけを透過化する（フラッドフィル）。
 * 白地そのものと、窓と同じ色でも離れている文字・アイコンは残る。
 * 中央が既に透明な画像では何もしない（removed = 0, alreadyTransparent = true）。
 * @returns {{removed:number, ratio:number, alreadyTransparent:boolean, color:number[]|null}}
 */
function applyWindowFlood(imageData, { tolerance = 32 } = {}) {
  const { data, width, height } = imageData;
  const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
  const ci = (cy * width + cx) * 4;
  if (data[ci + 3] <= 10) return { removed: 0, ratio: 0, alreadyTransparent: true, color: null };
  const cr = data[ci], cg = data[ci + 1], cb = data[ci + 2];
  const tol2 = tolerance * tolerance * 3;
  const visited = new Uint8Array(width * height);
  const stack = [cy * width + cx];
  visited[stack[0]] = 1;
  let removed = 0;
  while (stack.length) {
    const idx = stack.pop();
    const i = idx * 4;
    const dr = data[i] - cr, dg = data[i + 1] - cg, db = data[i + 2] - cb;
    if (dr * dr + dg * dg + db * db > tol2) continue;
    if (data[i + 3] > 0) { data[i + 3] = 0; removed++; }
    const x = idx % width, y = Math.floor(idx / width);
    if (x > 0 && !visited[idx - 1]) { visited[idx - 1] = 1; stack.push(idx - 1); }
    if (x < width - 1 && !visited[idx + 1]) { visited[idx + 1] = 1; stack.push(idx + 1); }
    if (y > 0 && !visited[idx - width]) { visited[idx - width] = 1; stack.push(idx - width); }
    if (y < height - 1 && !visited[idx + width]) { visited[idx + width] = 1; stack.push(idx + width); }
  }
  return { removed, ratio: removed / (width * height), alreadyTransparent: false, color: [cr, cg, cb] };
}

/**
 * 窓の矩形マスク: 四辺の余白（キャンバスに対する比率）で決まる矩形の内側を透過にする。
 * フラッドフィルで窓を検出できない場合のフォールバック。
 * margins = { left, top, right, bottom }（各 0〜0.45）
 */
function applyWindowRect(imageData, margins = {}) {
  const { data, width, height } = imageData;
  const m = { left: 0.10, top: 0.15, right: 0.10, bottom: 0.15, ...margins };
  const x0 = Math.round(width * m.left), x1 = Math.round(width * (1 - m.right));
  const y0 = Math.round(height * m.top), y1 = Math.round(height * (1 - m.bottom));
  let removed = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4 + 3;
      if (data[i] > 0) { data[i] = 0; removed++; }
    }
  }
  return { removed, ratio: removed / (width * height) };
}

/**
 * 「窓だけ抜く」の本体: まずフラッドフィルを試し、除去できた割合が
 * 2%未満（窓色が中央とつながっていない等）なら矩形マスクに切り替える。
 * 中央が既に透明なら何もしない。
 * @returns {{mode:'flood'|'rect'|'already', removed:number, ratio:number}}
 */
function applyWindowOnly(imageData, { tolerance = 32, margins } = {}) {
  // まずコピーで試す。窓色が白地と同じ等で画面の大半（70%超）が抜けてしまう
  // フラッドは誤判定として捨て、矩形マスクに切り替える（原本を壊さないため）。
  const trial = { data: new Uint8ClampedArray(imageData.data), width: imageData.width, height: imageData.height };
  const f = applyWindowFlood(trial, { tolerance });
  if (f.alreadyTransparent) return { mode: 'already', removed: 0, ratio: 0 };
  if (f.ratio >= 0.02 && f.ratio <= 0.70) {
    imageData.data.set(trial.data);
    return { mode: 'flood', removed: f.removed, ratio: f.ratio };
  }
  const r = applyWindowRect(imageData, margins);
  return { mode: 'rect', removed: r.removed, ratio: r.ratio };
}

/* ------------------------------------------------------------------ */
/* §4 ファイル名                                                        */
/* ------------------------------------------------------------------ */

/**
 * テーマ文字列の整形（結果が実装ごとに分かれないよう固定する）:
 * 小文字化し、英字（a-z）と数字（0-9）はそのまま、それ以外の文字は
 * 連続するものをまとめてハイフン1つに置き換える。先頭と末尾のハイフンは除く。
 * 結果が空なら 'myframe'。
 */
function slugifyTheme(theme) {
  const slug = String(theme ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'myframe' : slug;
}

/** 例: fileNameFor('4:5', 'Birthday Party') → 'encadra-frame_4-5_birthday-party.png' */
function fileNameFor(ratio, theme) {
  return `encadra-frame_${ratio.replace(':', '-')}_${slugifyTheme(theme)}.png`;
}

/* ------------------------------------------------------------------ */
/* §6 検証                                                              */
/* ------------------------------------------------------------------ */

/** 矩形内の不透明ピクセル数（アルファ > 0 のピクセル）。 */
function countOpaqueInRect(imageData, rect) {
  const { data, width } = imageData;
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) count++;
    }
  }
  return count;
}

function countOpaque(imageData) {
  const { data } = imageData;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) count++;
  }
  return count;
}

/**
 * 窓の検出（§6の5、白地フレーム用）: 透明ピクセル（アルファ ≤ threshold）の
 * 4方向連結成分のうち最大のものを「窓」として返す。中央の矩形は使わない。
 * 「そのまま」のはめ方では、窓は画像自身の透明領域から求める。
 * 「窓だけ抜く」では、はめ方が透過化した領域がそのまま窓になる。
 * @returns {{rect:{x:number,y:number,width:number,height:number}, count:number, ratio:number, mask:Uint8Array}|null}
 */
function findWindow(imageData, threshold = 10) {
  const { data, width, height } = imageData;
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack = [];
  let best = null;
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0] || data[s0 * 4 + 3] > threshold) continue;
    let count = 0;
    let minX = width, maxX = -1, minY = height, maxY = -1;
    const members = [];
    stack.length = 0;
    stack.push(s0);
    seen[s0] = 1;
    while (stack.length) {
      const idx = stack.pop();
      members.push(idx);
      count++;
      const x = idx % width, y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && !seen[idx - 1] && data[(idx - 1) * 4 + 3] <= threshold) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (x < width - 1 && !seen[idx + 1] && data[(idx + 1) * 4 + 3] <= threshold) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && !seen[idx - width] && data[(idx - width) * 4 + 3] <= threshold) { seen[idx - width] = 1; stack.push(idx - width); }
      if (y < height - 1 && !seen[idx + width] && data[(idx + width) * 4 + 3] <= threshold) { seen[idx + width] = 1; stack.push(idx + width); }
    }
    if (!best || count > best.count) {
      best = { count, members, rect: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } };
    }
  }
  if (!best) return null;
  const mask = new Uint8Array(n);
  for (const idx of best.members) mask[idx] = 1;
  return { rect: best.rect, count: best.count, ratio: best.count / n, mask };
}

/**
 * 白地フレームの検証（§6の5）。対象は、はめ方「そのまま」「窓だけ抜く」の
 * アート層（はめ方を適用した後の、その層だけの画像）に対して行う。
 * 合格条件:
 *   windowOk — 窓（実際の透明領域の最大連結成分）が存在し、その面積が
 *              全体の2%以上98%以下であること。窓の内部は検出方法の定義により
 *              すべてアルファ ≤ threshold（完全透過）である。
 *   boardOk  — 窓の外に、完全不透明（アルファ ≥ 250）のピクセルが残っている
 *              こと（白地と、窓とつながっていない文字・装飾が残っていることの
 *              数値判定はこの条件が担う。最終確認は §6の4の目視で行う）。
 * @returns {{ok:boolean, windowFound:boolean, windowOk:boolean, boardOk:boolean,
 *            windowRect:object|null, windowRatio:number,
 *            outsideOpaquePx:number, outsideFullOpaquePx:number}}
 */
function validateWhiteFrame(imageData, threshold = 10) {
  const win = findWindow(imageData, threshold);
  if (!win) {
    return { ok: false, windowFound: false, windowOk: false, boardOk: false, windowRect: null, windowRatio: 0, outsideOpaquePx: 0, outsideFullOpaquePx: 0 };
  }
  const { data, width, height } = imageData;
  let outsideOpaquePx = 0, outsideFullOpaquePx = 0;
  for (let i = 0; i < width * height; i++) {
    if (win.mask[i]) continue;
    const a = data[i * 4 + 3];
    if (a > 0) outsideOpaquePx++;
    if (a >= 250) outsideFullOpaquePx++;
  }
  const windowOk = win.ratio >= 0.02 && win.ratio <= 0.98;
  const boardOk = outsideFullOpaquePx > 0;
  return {
    ok: windowOk && boardOk,
    windowFound: true,
    windowOk,
    boardOk,
    windowRect: win.rect,
    windowRatio: win.ratio,
    outsideOpaquePx,
    outsideFullOpaquePx,
  };
}

/**
 * 書き出し前の検証（§6の1〜3と5。4の合成チェックは目視用なので含めない）。
 *
 * @param imageData モチーフ層を除いた全レイヤーの合成結果
 * @param ratio     書き出す比率（'4:5' など）
 * @param motifImageData （任意）表示中のモチーフ層だけの合成結果。
 *        中央にかかっているかどうかだけを調べ、警告にする（合否には含めない）。
 * @param options   （任意）{ whiteFrame: boolean, white: object|null }
 *        whiteFrame が true のデザイン（はめ方「そのまま」「窓だけ抜く」の
 *        アート層がある）では、項目2（中央の完全透過）は対象外とし、代わりに
 *        項目5（options.white = validateWhiteFrame の結果）が合否を担う。
 * @returns {{
 *   ok: boolean,
 *   sizeOk: boolean,        // 1. 実寸が §4 の表と一致するか
 *   centerApplicable: boolean, // 2. 項目2がこのデザインに適用されるか
 *   centerOk: boolean,      // 2. 中央内側60%が完全透過か（対象外の場合は参考値）
 *   centerOpaquePx: number, //    中央矩形内の不透明ピクセル数
 *   drawingOk: boolean,     // 3. 不透明ピクセルが存在するか（空でないか）
 *   whiteFrame: boolean,    // 5. 白地フレームのデザインかどうか
 *   whiteOk: boolean|null,  // 5. validateWhiteFrame の結果（対象でない場合は null）
 *   motifWarning: boolean,  //    モチーフが中央にかかっているか（警告のみ）
 *   motifCenterPx: number
 * }}
 */
function validateExport(imageData, ratio, motifImageData = null, options = {}) {
  const expected = SIZES[ratio];
  if (!expected) throw new Error(`unknown ratio: ${ratio}`);
  const sizeOk =
    imageData.width === expected.width && imageData.height === expected.height;

  const rect = centerRect(imageData.width, imageData.height);
  const centerOpaquePx = countOpaqueInRect(imageData, rect);
  const centerOk = centerOpaquePx === 0;

  const drawingOk = countOpaque(imageData) > 0;

  let motifCenterPx = 0;
  if (motifImageData) {
    motifCenterPx = countOpaqueInRect(motifImageData, rect);
  }

  const whiteFrame = !!options.whiteFrame;
  const whiteOk = whiteFrame ? !!(options.white && options.white.ok) : null;
  const ok = whiteFrame
    ? sizeOk && drawingOk && whiteOk
    : sizeOk && centerOk && drawingOk;

  return {
    ok,
    sizeOk,
    centerApplicable: !whiteFrame,
    centerOk,
    centerOpaquePx,
    drawingOk,
    whiteFrame,
    whiteOk,
    motifWarning: motifCenterPx > 0,
    motifCenterPx,
  };
}

/* ------------------------------------------------------------------ */
/* ブラウザ用ヘルパ（Canvas への合成）                                   */
/* ------------------------------------------------------------------ */

/**
 * 比率どおりに作られたレイヤーキャンバス同士を、そのまま重ねる合成ヘルパ。
 * レイヤーキャンバスは既に比率の寸法で作られている前提で、引き伸ばしは実質そのまま。
 * 元画像をレイヤーキャンバスへはめ込むときのはめ方は、この関数ではなく
 * 参照実装 app.js の layerCanvas が担い、アート層では全面フィット（cover）を使う。
 *
 * @param layers 下から順の CanvasImageSource の配列
 * @param ratio  '4:5' など
 * @returns HTMLCanvasElement（ブラウザ環境でのみ動作）
 */
function composeToCanvas(layers, ratio) {
  const { width, height } = SIZES[ratio];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  for (const layer of layers) {
    ctx.drawImage(layer, 0, 0, width, height);
  }
  return canvas;
}

/* ------------------------------------------------------------------ */

const FrameEngine = {
  SIZES,
  RATIOS,
  ENCADRA_MAX_LONG_EDGE,
  centerRect,
  keyoutFactor,
  applyKeyout,
  transparentRatio,
  applyWindowFlood,
  applyWindowRect,
  applyWindowOnly,
  applyEdgeMask,
  applyCenterCutout,
  applyBandOnly,
  slugifyTheme,
  fileNameFor,
  countOpaque,
  countOpaqueInRect,
  findWindow,
  validateWhiteFrame,
  validateExport,
  composeToCanvas,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FrameEngine;
}
if (typeof window !== 'undefined') {
  window.FrameEngine = FrameEngine;
}

/**
 * Encadra Frame Maker — reference implementation (app)
 *
 * デザインの正本は参照Space（Encadra フレームメーカー）です。この実装は、そのSpaceの
 * 画面構成・スタイル・文言・既定値を、単体で動く形に写したものです。
 * 核の計算は frame-engine.js、保存はこのファイルのプラットフォーム層（Platform）経由です。
 *
 * データ形式:
 *   state = {
 *     version: 'v0.11',          // 対応する指示書の版（§0の版記録）
 *     lang: 'ja' | 'en',
 *     theme: string,             // 依頼文・生成で共有するテーマ
 *     ratio: '4:5',              // '1:1'|'4:5'|'3:2'|'16:9'|'9:16'
 *     bg: 'checker',             // プレビュー背景 'checker'|'dummy'|'white'|'black'
 *     images: { [id]: dataURL },
 *     layers: Layer[],           // 配列の先頭が一番下（描画順）。一覧表示は逆順
 *     templates: { [name]: { layers, ratio } },
 *     gallery: GalleryItem[],    // 最新60件
 *     history: HistoryItem[],    // アプリ内生成の履歴
 *   }
 *   Layer 共通: { id, type, name, visible, opacity }
 *     art:   { imageId|null, fit:'white-key'|'edge-mask'|'full-cut'|'band-only',
 *              borderPct (縁の幅%), bandPct (帯の高さ%), cutCenter }
 *     motif: { imageId|null, pos (8位置), sizePct, keyout }
 *     base:  { template, theme, frameColor, bandColor, accentColor,
 *              borderPct, bandPct, density, motif }
 *     text:  { main, sub, pos:'top'|'bottom'|'split', align, font, color, sizePct }
 *   GalleryItem = { id, ts, ratio, theme, fileName, thumb, snapshot }
 *     snapshot = { layers, ratio }（画像は images 側にIDで残る）
 *   HistoryItem = { id, ts, theme, imageId }
 *
 * MIT License — see ../LICENSE
 */

'use strict';

const SHEET_VERSION = 'v0.12';
const STORE_KEY = 'encadraFrameMaker.v1';
const GALLERY_LIMIT = 60;

/* ================= プラットフォーム層（保存） =================
   Space へ移植するときに置き換えてよいのは、この Platform の中身だけです。
   呼び出し側（save / load の使い方、書き出し→検証→ギャラリー記録という処理の
   流れと順序）は、無変更で埋め込む側です。persist は「渡された文字列をそのまま
   保存する」、restore は「保存した文字列をそのまま返す」という契約を守ること。 */
const Platform = {
  persist(text) {
    try { localStorage.setItem(STORE_KEY, text); }
    catch (e) { console.warn('save failed (storage full?)', e); }
  },
  restore() {
    try { return localStorage.getItem(STORE_KEY); }
    catch (e) { return null; }
  },
};

function save() { Platform.persist(JSON.stringify(state)); }

function load() {
  try {
    const raw = Platform.restore();
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.layers)) { state = normalizeState(parsed); }
  } catch (e) { /* 壊れた保存は無視して既定で始める */ }
}

/* ================= テーマプリセット・既定値（参照Spaceの実値） ================= */

const THEME_PRESETS = {
  travel:   { frame: '#0e5a6d', band: '#0e5a6d', accent: '#f4b942', motif: 'star',    main: 'TRAVEL',         sub: '旅の記録' },
  birthday: { frame: '#d94f70', band: '#d94f70', accent: '#ffd166', motif: 'heart',   main: 'HAPPY BIRTHDAY', sub: 'お誕生日おめでとう' },
  event:    { frame: '#1f3a5f', band: '#1f3a5f', accent: '#ff7a1a', motif: 'sparkle', main: 'EVENT',          sub: 'イベント' },
  oshi:     { frame: '#7b2d8b', band: '#7b2d8b', accent: '#ff8fab', motif: 'heart',   main: 'OSHI',           sub: '推し活' },
  simple:   { frame: '#26221e', band: '#26221e', accent: '#8a8378', motif: 'none',    main: '',               sub: '' },
};
const SWATCHES = ['#0e5a6d', '#d94f70', '#1f3a5f', '#7b2d8b', '#2e7d4f', '#c0392b', '#26221e', '#f4b942', '#ff7a1a', '#ffffff', '#111111', '#8a8378'];
const FONT_STACKS = {
  gothic: '"Avenir Next", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif',
  serif: '"Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", "Noto Serif JP", serif',
  round: '"Hiragino Maru Gothic ProN", "M PLUS Rounded 1c", "Hiragino Kaku Gothic ProN", sans-serif',
};
const MOTIF_POS = ['top-left', 'top-center', 'top-right', 'mid-left', 'mid-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const TYPE_DOT = { art: '#d946ef', motif: '#0ea5e9', base: '#d97706', text: '#059669' };

let uidCounter = 0;
function uid() { return 'id' + Date.now().toString(36) + (uidCounter++).toString(36); }

function defaultBase() {
  return { id: uid(), type: 'base', name: '', visible: true, opacity: 100,
    template: 'thick-band', theme: 'travel', frameColor: '#0e5a6d', bandColor: '#0e5a6d',
    accentColor: '#f4b942', borderPct: 1.4, bandPct: 15, density: 50, motif: 'star' };
}
function defaultArt() {
  return { id: uid(), type: 'art', name: '', visible: true, opacity: 100,
    imageId: null, fit: 'white-key', borderPct: 8, bandPct: 15, cutCenter: true };
}
function defaultMotif() {
  return { id: uid(), type: 'motif', name: '', visible: true, opacity: 100,
    imageId: null, pos: 'bottom-right', sizePct: 26, keyout: true };
}
function defaultText() {
  return { id: uid(), type: 'text', name: '', visible: true, opacity: 100,
    main: '', sub: '', pos: 'bottom', align: 'center', font: 'gothic', color: '#ffffff', sizePct: 100 };
}

let state = {
  version: SHEET_VERSION,
  lang: 'ja',
  theme: '',
  ratio: '4:5',
  bg: 'checker',
  images: {},
  layers: [defaultBase()],
  templates: {},
  gallery: [],
  history: [],
};
let selectedLayerId = state.layers[0].id;

/* 旧形式（v0.10以前）の保存を寄せて取り込む */
function normalizeState(s) {
  const fitMap = { keyout: 'white-key', cutout: 'full-cut', band: 'band-only' };
  s.layers = (s.layers || []).map((l) => {
    if (l.type === 'art') {
      const d = defaultArt();
      const m = Object.assign(d, l);
      if (fitMap[m.fit]) m.fit = fitMap[m.fit];
      return m;
    }
    if (l.type === 'motif') {
      const m = Object.assign(defaultMotif(), l);
      if (m.pos === 'center' || m.pos === 'mc') m.pos = 'bottom-center';
      if (typeof m.size === 'number' && typeof l.sizePct !== 'number') m.sizePct = m.size;
      return m;
    }
    if (l.type === 'base') return Object.assign(defaultBase(), l);
    if (l.type === 'text') {
      const d = defaultText();
      const m = Object.assign(d, l);
      if (Array.isArray(l.lines)) { m.main = l.lines[0] || ''; m.sub = l.lines[1] || ''; }
      return m;
    }
    return l;
  });
  if (!Array.isArray(s.gallery)) s.gallery = [];
  if (!Array.isArray(s.history)) s.history = [];
  if (!s.templates) s.templates = {};
  if (!s.images) s.images = {};
  return s;
}

/* ================= 文言（参照Spaceの日英辞書に合わせる） ================= */

const STR = {
  ja: {
    intro: 'Encadra のカスタムフレーム用に、中央が完全透過のフレームPNGを作ります。書き出したPNGを Encadra に取り込んで使ってください。',
    steps: ['1. テーマを決めて依頼文をコピー', '2. 自分のMuseに渡して画像を作ってもらう', '3. レイヤーに入れると仕上がる'],
    previewBg: 'プレビュー背景',
    bgs: { checker: 'チェッカー', dummy: 'ダミー写真', white: '白', black: '黒' },
    exportTitle: '書き出しと検証',
    vSize: (s) => `実寸ピクセルが比率どおり (${s})`,
    vCenter: '中央領域（内側60%）が完全透過',
    vDraw: 'フレームの描画あり',
    motifWarn: (px) => `モチーフが中央にかかっています（${px}px）。意図した配置か確認してください（書き出しはできます）`,
    fnameLabel: 'ファイル名: ',
    exportOne: 'この比率のPNGをダウンロード',
    exportAll: '5比率まとめてダウンロード',
    exporting: '書き出し中…',
    ratioTitle: '比率',
    layersTitle: 'レイヤー',
    layersGuide: '下のレイヤーから順に重なります。一覧は上が一番手前です。レイヤーを選ぶと下に設定が出ます。',
    addLayer: 'レイヤーを追加',
    typeNames: { art: 'AI生成アート', motif: 'AI生成モチーフ', base: '基本フレーム', text: 'テキスト' },
    show: '表示', hide: '非表示',
    layerName: 'レイヤー名', opacity: '不透明度',
    artEmpty: 'まだ画像が入っていません。下の「Museへの依頼文」を自分のMuseに渡して作ってもらった画像を、ここに入れてください。アプリ内の生成ボタンでも作れます。',
    motifEmpty: 'モチーフ画像が入っていません。透過PNG、または白背景の画像（自動で切り抜きます）を入れてください。',
    putImage: '画像を入れる', putMotif: 'モチーフ画像を入れる', replace: '画像を差し替える', remove: '画像を外す',
    fit: 'はめ方',
    fits: { 'white-key': '白地を透過化（自動・推奨）', 'edge-mask': '縁マスク（縁だけ残す）', 'full-cut': '全面＋中央くり抜き', 'band-only': '帯のみ（下帯）' },
    fitKeyNote: '白に近い部分をなめらかに透過化します。長方形で切り取らないので、モチーフが途中で切れません。中央が白く空いた生成画像にそのまま効きます。',
    edgeW: '縁の幅', bandH: '帯の高さ', cutCenter: '中央（内側60%）をくり抜く',
    pos: '配置', size: '大きさ', keyout: '白地を透過化',
    posNames: { 'top-left': '左上', 'top-center': '上中央', 'top-right': '右上', 'mid-left': '左中央', 'mid-right': '右中央', 'bottom-left': '左下', 'bottom-center': '下中央', 'bottom-right': '右下' },
    reqArt: 'アート層の依頼文', reqMotif: 'モチーフ層の依頼文',
    themePh: 'テーマ（例：旅行・猫・誕生日）',
    copyReq: 'Museへの依頼文をコピー', copied: 'コピーしました',
    mainText: 'メインテキスト', subText: 'サブテキスト', textPos: 'テキスト位置', align: '揃え',
    tpos: { top: '上', bottom: '下', split: '上下に分割' },
    aligns: { left: '左', center: '中央', right: '右' },
    font: '書体', fonts: { gothic: 'ゴシック', serif: '明朝', round: '丸ゴシック' },
    color: '文字色', frameColor: '枠色', bandColor: '帯色', accentColor: '飾り色', textSize: '文字サイズ',
    tplStruct: '構造テンプレート',
    structs: { double: '二重ライン枠', 'thick-band': '太枠＋下帯', band: '下帯のみ', corners: '四隅の飾り', surround: '縁まわり飾り', minimal: 'ミニマル' },
    themeLabel: 'テーマ',
    themes: { travel: '旅行', birthday: '誕生日', event: 'イベント', oshi: '推し活', simple: 'シンプル', custom: 'カスタム' },
    borderW: '枠の太さ', density: '飾りの密度', motifShape: '飾りのモチーフ',
    shapes: { star: '星', heart: 'ハート', circle: '丸', diamond: 'ひし形', sparkle: 'きらめき', none: 'なし' },
    genTitle: 'アプリ内で生成（お試し）',
    genGuide: 'テーマを入れて生成すると、縁に装飾が集まったフレームアートができます。生成画像は中央が白く空いているので、レイヤーに入れるときは「白地を透過化（自動・推奨）」のはめ方がおすすめです。',
    genTheme: '生成テーマ', genButton: 'このテーマで生成', generating: '生成中…（30秒ほどかかります）',
    histTitle: '生成履歴', histEmpty: 'まだ生成したフレームはありません。',
    histPut: 'レイヤーに入れる', histDel: '履歴から削除', histPin: 'テンプレートに固定',
    tplTitle: 'マイテンプレート', tplNamePh: 'テンプレート名', tplSave: '現在のデザインを保存',
    tplEmpty: '保存済みテンプレートはまだありません。', tplLoad: '読み込む', del: '削除',
    galleryTitle: 'フレームギャラリー',
    galleryGuide: '書き出したフレームは自動でここに残ります（最新60件）。呼び出すと、そのときのレイヤー構成ごと編集に戻せます。',
    galleryEmpty: 'まだ書き出したフレームはありません。',
    gRestore: '呼び出す', gRedl: '再ダウンロード',
    confirmDel: '本当に削除しますか？', doDel: '削除する', cancel: 'キャンセル',
    savedFlash: ' · 自動保存しました',
    version: '対応している指示書の版: ',
    footer: '書き出したPNGは Encadra のカスタムフレームに登録して使います。比率ごとに別に作るのが基本です。',
    reqArtText: (theme, ratio) => `Encadraのカスタムフレーム用のアート画像を1枚生成してください。\nテーマ: ${theme}\n- 比率は ${ratio}（フレームの比率に合わせる）\n- モチーフや飾りは画像の縁の周りにだけ配置し、中央は白一色で空ける\n- モチーフは端で切らず、全体が入るように描く（端から余白を取り、飾りは縁の帯の内側に収める）\n- 画像の中に文字は入れない`,
    reqMotifText: (theme) => `Encadraのカスタムフレーム用のモチーフ画像を1枚生成してください。\nテーマ: ${theme}\n- モチーフは単体で、白一色の背景の上に大きく作る（後から切り抜く前提。透過PNGで作れる場合はそれでもよい）\n- 画像の中に文字は入れない`,
  },
  en: {
    intro: "Make a frame PNG with a fully transparent center for Encadra's custom frame. Import the exported PNG into Encadra to use it.",
    steps: ['1. Pick a theme and copy the request text', '2. Give it to your Muse to generate the image', '3. Drop it into a layer to finish'],
    previewBg: 'Preview background',
    bgs: { checker: 'Checker', dummy: 'Dummy photo', white: 'White', black: 'Black' },
    exportTitle: 'Export & validation',
    vSize: (s) => `Exact pixels match the ratio (${s})`,
    vCenter: 'Center area (inner 60%) fully transparent',
    vDraw: 'Frame has drawn content',
    motifWarn: (px) => `A motif overlaps the center (${px}px). Check it is intentional (export is still possible)`,
    fnameLabel: 'File name: ',
    exportOne: 'Download PNG for this ratio',
    exportAll: 'Download all 5 ratios',
    exporting: 'Exporting…',
    ratioTitle: 'Ratio',
    layersTitle: 'Layers',
    layersGuide: 'Layers stack from the bottom up; the list shows the top layer first. Select a layer to edit its settings below.',
    addLayer: 'Add a layer',
    typeNames: { art: 'AI art', motif: 'AI motif', base: 'Base frame', text: 'Text' },
    show: 'Shown', hide: 'Hidden',
    layerName: 'Layer name', opacity: 'Opacity',
    artEmpty: 'No image yet. Give the request text below to your Muse and put the generated image here. You can also use the in-app generator.',
    motifEmpty: 'No motif image yet. Use a transparent PNG, or a white-background image (it will be cut out automatically).',
    putImage: 'Add image', putMotif: 'Add motif image', replace: 'Replace image', remove: 'Remove image',
    fit: 'Fit',
    fits: { 'white-key': 'Key out white (auto, recommended)', 'edge-mask': 'Edge mask (keep edges only)', 'full-cut': 'Full + center cutout', 'band-only': 'Band only (bottom)' },
    fitKeyNote: 'Near-white areas fade smoothly into transparency. Nothing is cut by a rectangle, so motifs are never clipped. Works directly on generated images with a white center.',
    edgeW: 'Edge width', bandH: 'Band height', cutCenter: 'Cut out the center (inner 60%)',
    pos: 'Position', size: 'Size', keyout: 'Key out white',
    posNames: { 'top-left': 'Top left', 'top-center': 'Top center', 'top-right': 'Top right', 'mid-left': 'Middle left', 'mid-right': 'Middle right', 'bottom-left': 'Bottom left', 'bottom-center': 'Bottom center', 'bottom-right': 'Bottom right' },
    reqArt: 'Request text (art layer)', reqMotif: 'Request text (motif layer)',
    themePh: 'Theme (e.g. travel, cat, birthday)',
    copyReq: 'Copy request text for Muse', copied: 'Copied',
    mainText: 'Main text', subText: 'Sub text', textPos: 'Text position', align: 'Align',
    tpos: { top: 'Top', bottom: 'Bottom', split: 'Split top / bottom' },
    aligns: { left: 'Left', center: 'Center', right: 'Right' },
    font: 'Font', fonts: { gothic: 'Gothic', serif: 'Serif', round: 'Rounded' },
    color: 'Text color', frameColor: 'Frame color', bandColor: 'Band color', accentColor: 'Accent color', textSize: 'Text size',
    tplStruct: 'Structure template',
    structs: { double: 'Double-line frame', 'thick-band': 'Thick frame + bottom band', band: 'Bottom band only', corners: 'Corner ornaments', surround: 'Edge ornaments', minimal: 'Minimal' },
    themeLabel: 'Theme',
    themes: { travel: 'Travel', birthday: 'Birthday', event: 'Event', oshi: 'Oshi', simple: 'Simple', custom: 'Custom' },
    borderW: 'Frame width', density: 'Ornament density', motifShape: 'Ornament motif',
    shapes: { star: 'Star', heart: 'Heart', circle: 'Circle', diamond: 'Diamond', sparkle: 'Sparkle', none: 'None' },
    genTitle: 'Generate in-app (quick try)',
    genGuide: 'Enter a theme to generate frame art with decorations gathered at the edges. The center is left white, so the "Key out white" fit is recommended when placing it in a layer.',
    genTheme: 'Generation theme', genButton: 'Generate with this theme', generating: 'Generating… (takes about 30 seconds)',
    histTitle: 'Generation history', histEmpty: 'No frames generated yet.',
    histPut: 'Put in a layer', histDel: 'Delete from history', histPin: 'Pin as template',
    tplTitle: 'My templates', tplNamePh: 'Template name', tplSave: 'Save current design',
    tplEmpty: 'No saved templates yet.', tplLoad: 'Load', del: 'Delete',
    galleryTitle: 'Frame gallery',
    galleryGuide: 'Exported frames stay here automatically (latest 60). Restoring one brings back its full layer setup.',
    galleryEmpty: 'No frames exported yet.',
    gRestore: 'Restore', gRedl: 'Re-download',
    confirmDel: 'Delete this item?', doDel: 'Delete', cancel: 'Cancel',
    savedFlash: ' · Auto-saved',
    version: 'Instruction sheet version: ',
    footer: 'Register exported PNGs as custom frames in Encadra. Make one frame per ratio.',
    reqArtText: (theme, ratio) => `Generate one art image for an Encadra custom frame.\nTheme: ${theme}\n- Aspect ratio ${ratio} (match the frame ratio)\n- Place motifs and decorations only around the edges; leave the center pure white and empty\n- Draw every motif fully inside the image with margins from the edges\n- Do not put any text in the image`,
    reqMotifText: (theme) => `Generate one motif image for an Encadra custom frame.\nTheme: ${theme}\n- A single motif, large, on a pure white background (it will be cut out later; a transparent PNG is also fine)\n- Do not put any text in the image`,
  },
};
function t() { return STR[state.lang] || STR.ja; }

/* ================= 画像の読み込み ================= */

const imgCache = {}; // imageId -> HTMLImageElement
function getImg(id) {
  if (!id || !state.images[id]) return null;
  if (!imgCache[id]) {
    const im = new Image();
    im.src = state.images[id];
    imgCache[id] = im;
  }
  return imgCache[id];
}
function imgReady(id) { const im = getImg(id); return im && im.complete && im.naturalWidth > 0; }

function addImageData(dataURL) {
  const id = uid();
  state.images[id] = dataURL;
  const im = new Image();
  im.onload = () => refresh();
  im.src = dataURL;
  imgCache[id] = im;
  return id;
}
function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
/* 取り込み画像の長辺を 2048px に抑える（Encadra側の上限 4096px の範囲内） */
function downscaleDataURL(dataURL, maxSide = 2048) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
      if (scale >= 1) return res(dataURL);
      const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * scale);
      c.height = Math.round(im.naturalHeight * scale);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL('image/png'));
    };
    im.src = dataURL;
  });
}

/* ================= ダミー写真とアプリ内生成の絵 ================= */

/* 合成確認用のダミー写真（描画で生成する。外部画像は使わない。
   空・太陽・山並み・丘・手前の地面だけの、単純な風景にする） */
function drawDummyScene(ctx, W, H) {
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.65);
  sky.addColorStop(0, '#84c2e6'); sky.addColorStop(1, '#e9f4e4');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f6cd67';
  ctx.beginPath(); ctx.arc(W * 0.77, H * 0.17, W * 0.068, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7d9cb5';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.63);
  ctx.lineTo(W * 0.22, H * 0.40);
  ctx.lineTo(W * 0.42, H * 0.58);
  ctx.lineTo(W * 0.61, H * 0.435);
  ctx.lineTo(W * 0.83, H * 0.60);
  ctx.lineTo(W, H * 0.50);
  ctx.lineTo(W, H * 0.72);
  ctx.lineTo(0, H * 0.72);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5f8f6a';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.71);
  ctx.quadraticCurveTo(W * 0.32, H * 0.60, W * 0.58, H * 0.695);
  ctx.quadraticCurveTo(W * 0.82, H * 0.765, W, H * 0.665);
  ctx.lineTo(W, H * 0.875); ctx.lineTo(0, H * 0.875);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4c7a57';
  ctx.fillRect(0, H * 0.875, W, H * 0.125);
}

/* アプリ内生成（お試し）: 縁に装飾が集まり中央が白く空いた絵を、手続き的に描く */
function generateArtCanvas(theme, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const presets = Object.values(THEME_PRESETS);
  let seed = 0;
  for (const ch of (theme || '')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
  const preset = presets[seed % presets.length] || THEME_PRESETS.travel;
  const colors = [preset.frame, preset.accent, preset.band, '#7fb069', '#40607a'];
  const bandX = W * 0.16, bandY = H * 0.16;
  const n = 46;
  for (let i = 0; i < n; i++) {
    const edge = Math.floor(rnd() * 4);
    let x, y;
    if (edge === 0) { x = rnd() * W; y = rnd() * bandY; }
    else if (edge === 1) { x = rnd() * W; y = H - rnd() * bandY; }
    else if (edge === 2) { x = rnd() * bandX; y = rnd() * H; }
    else { x = W - rnd() * bandX; y = rnd() * H; }
    const s = (0.02 + rnd() * 0.035) * Math.min(W, H);
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.globalAlpha = 0.75 + rnd() * 0.25;
    const shape = Math.floor(rnd() * 3);
    ctx.beginPath();
    if (shape === 0) ctx.arc(x, y, s / 2, 0, Math.PI * 2);
    else if (shape === 1) { drawStar(ctx, x, y, s / 2); }
    else ctx.fillRect(x - s / 2, y - s / 2, s, s);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}
function drawStar(ctx, cx, cy, r) {
  ctx.moveTo(cx, cy - r);
  for (let i = 1; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
}
function drawHeart(ctx, cx, cy, s) {
  ctx.moveTo(cx, cy + s * 0.85);
  ctx.bezierCurveTo(cx - s * 1.3, cy, cx - s * 0.7, cy - s * 1.1, cx, cy - s * 0.35);
  ctx.bezierCurveTo(cx + s * 0.7, cy - s * 1.1, cx + s * 1.3, cy, cx, cy + s * 0.85);
  ctx.closePath();
}
function drawDiamond(ctx, cx, cy, s) {
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.7, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s * 0.7, cy);
  ctx.closePath();
}
function drawSparkle(ctx, cx, cy, s) {
  ctx.moveTo(cx, cy - s);
  ctx.quadraticCurveTo(cx, cy, cx + s, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + s);
  ctx.quadraticCurveTo(cx, cy, cx - s, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - s);
  ctx.closePath();
}
function drawMotifShape(ctx, shape, cx, cy, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (shape === 'star') drawStar(ctx, cx, cy, s);
  else if (shape === 'heart') drawHeart(ctx, cx, cy, s);
  else if (shape === 'diamond') drawDiamond(ctx, cx, cy, s);
  else if (shape === 'sparkle') drawSparkle(ctx, cx, cy, s);
  else ctx.arc(cx, cy, s, 0, Math.PI * 2);
  ctx.fill();
}

/* ================= 合成 ================= */

function layerCanvas(layer, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const im = layer.imageId ? getImg(layer.imageId) : null;
  if (layer.type === 'art') {
    if (!im || !imgReady(layer.imageId)) return c;
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const tctx = tmp.getContext('2d');
    /* 全面フィット（cover）でキャンバスに合わせる */
    const scale = Math.max(W / im.naturalWidth, H / im.naturalHeight);
    const dw = im.naturalWidth * scale, dh = im.naturalHeight * scale;
    tctx.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
    let img = tctx.getImageData(0, 0, W, H);
    if (layer.fit === 'white-key') img = FrameEngine.applyKeyout(img);
    else if (layer.fit === 'edge-mask') { img = FrameEngine.applyKeyout(img); img = FrameEngine.applyEdgeMask(img, { bandRatio: layer.borderPct / 100, bottomRatio: layer.bandPct / 100 }); }
    else if (layer.fit === 'full-cut') { img = FrameEngine.applyKeyout(img); if (layer.cutCenter) img = FrameEngine.applyCenterCutout(img); }
    else if (layer.fit === 'band-only') { img = FrameEngine.applyKeyout(img); img = FrameEngine.applyBandOnly(img, { side: 'bottom', bandRatio: layer.bandPct / 100 }); }
    ctx.putImageData(img, 0, 0);
  } else if (layer.type === 'motif') {
    if (!im || !imgReady(layer.imageId)) return c;
    const short = Math.min(W, H);
    const size = short * layer.sizePct / 100;
    const scale = size / Math.max(im.naturalWidth, im.naturalHeight);
    const dw = im.naturalWidth * scale, dh = im.naturalHeight * scale;
    const m = short * 0.03;
    let x = m, y = m;
    if (layer.pos.includes('center')) x = (W - dw) / 2;
    if (layer.pos.includes('right')) x = W - dw - m;
    if (layer.pos.startsWith('mid')) y = (H - dh) / 2;
    if (layer.pos.startsWith('bottom')) y = H - dh - m;
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round(dw)); tmp.height = Math.max(1, Math.round(dh));
    const tctx = tmp.getContext('2d');
    tctx.drawImage(im, 0, 0, tmp.width, tmp.height);
    if (layer.keyout) {
      const img = FrameEngine.applyKeyout(tctx.getImageData(0, 0, tmp.width, tmp.height));
      tctx.putImageData(img, 0, 0);
    }
    ctx.drawImage(tmp, x, y);
  } else if (layer.type === 'base') {
    drawBase(ctx, layer, W, H);
  } else if (layer.type === 'text') {
    drawText(ctx, layer, W, H);
  }
  return c;
}

function drawBase(ctx, layer, W, H) {
  const short = Math.min(W, H);
  const bw = Math.max(1, short * layer.borderPct / 100);
  const bandH = H * layer.bandPct / 100;
  ctx.fillStyle = layer.frameColor;
  if (layer.template === 'double') {
    ctx.lineWidth = bw; ctx.strokeStyle = layer.frameColor;
    ctx.strokeRect(bw, bw, W - bw * 2, H - bw * 2);
    ctx.strokeRect(bw * 2.6, bw * 2.6, W - bw * 5.2, H - bw * 5.2);
    /* 四隅に飾りモチーフ（大きめ） */
    if (layer.motif !== 'none' && layer.density > 0) {
      const s = (short * 0.014 + bw * 0.4) * 1.4 * (0.7 + layer.density * 0.006);
      const inset = bw * 2.6 + s * 0.7;
      drawMotifShape(ctx, layer.motif, inset, inset, s, layer.accentColor);
      drawMotifShape(ctx, layer.motif, W - inset, inset, s, layer.accentColor);
      drawMotifShape(ctx, layer.motif, inset, H - inset, s, layer.accentColor);
      drawMotifShape(ctx, layer.motif, W - inset, H - inset, s, layer.accentColor);
    }
  } else if (layer.template === 'thick-band') {
    ctx.lineWidth = bw * 2; ctx.strokeStyle = layer.frameColor;
    ctx.strokeRect(bw, bw, W - bw * 2, H - bw * 2);
    ctx.fillStyle = layer.bandColor;
    ctx.fillRect(0, H - bandH, W, bandH);
  } else if (layer.template === 'band') {
    ctx.fillStyle = layer.bandColor;
    ctx.fillRect(0, H - bandH, W, bandH);
  } else if (layer.template === 'corners') {
    ctx.strokeStyle = layer.frameColor;
    ctx.lineWidth = bw * 1.6;
    const L = short * 0.09, m = bw * 2.2;
    ctx.beginPath();
    ctx.moveTo(m, m + L); ctx.lineTo(m, m); ctx.lineTo(m + L, m);
    ctx.moveTo(W - m - L, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + L);
    ctx.moveTo(W - m, H - m - L); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m - L, H - m);
    ctx.moveTo(m + L, H - m); ctx.lineTo(m, H - m); ctx.lineTo(m, H - m - L);
    ctx.stroke();
    /* 四隅の頂点に飾りモチーフ（大きめ） */
    if (layer.motif !== 'none' && layer.density > 0) {
      const s = (short * 0.014 + bw * 0.4) * 1.4 * (0.7 + layer.density * 0.006);
      drawMotifShape(ctx, layer.motif, m, m, s, layer.accentColor);
      drawMotifShape(ctx, layer.motif, W - m, m, s, layer.accentColor);
      drawMotifShape(ctx, layer.motif, W - m, H - m, s, layer.accentColor);
      drawMotifShape(ctx, layer.motif, m, H - m, s, layer.accentColor);
    }
  } else if (layer.template === 'surround') {
    const step = short * (0.16 - layer.density * 0.0011);
    const s = short * 0.016 + bw * 0.55;
    const inset = bw * 2 + s;
    if (layer.motif !== 'none') {
      for (let x = inset; x <= W - inset + 1; x += step) {
        drawMotifShape(ctx, layer.motif, x, inset, s, layer.accentColor);
        drawMotifShape(ctx, layer.motif, x, H - inset, s, layer.accentColor);
      }
      for (let y = inset + step; y <= H - inset - step + 1; y += step) {
        drawMotifShape(ctx, layer.motif, inset, y, s, layer.accentColor);
        drawMotifShape(ctx, layer.motif, W - inset, y, s, layer.accentColor);
      }
    }
    ctx.lineWidth = bw * 0.8; ctx.strokeStyle = layer.frameColor;
    ctx.strokeRect(bw, bw, W - bw * 2, H - bw * 2);
  } else { /* minimal */
    ctx.lineWidth = Math.max(1, bw * 0.6); ctx.strokeStyle = layer.frameColor;
    ctx.strokeRect(bw, bw, W - bw * 2, H - bw * 2);
    /* 四隅に小さい飾りモチーフ */
    if (layer.motif !== 'none' && layer.density > 0) {
      const s = (short * 0.014 + bw * 0.4) * (0.7 + layer.density * 0.006);
      const inset = bw * 2 + s * 0.6;
      drawMotifShape(ctx, layer.motif, inset, inset, s, layer.accentColor);
      drawMotifShape(ctx, layer.motif, W - inset, inset, s, layer.accentColor);
      drawMotifShape(ctx, layer.motif, inset, H - inset, s, layer.accentColor);
      drawMotifShape(ctx, layer.motif, W - inset, H - inset, s, layer.accentColor);
    }
  }
  /* 下帯の上に飾りモチーフを等間隔に（thick-band / band のとき） */
  if ((layer.template === 'thick-band' || layer.template === 'band') && layer.motif !== 'none' && layer.density > 0) {
    const s = short * 0.014 + bw * 0.4;
    const cy = H - bandH / 2;
    const step = short * (0.2 - layer.density * 0.0014);
    for (let x = step; x < W; x += step) drawMotifShape(ctx, layer.motif, x, cy, s, layer.accentColor);
  }
}

function drawText(ctx, layer, W, H) {
  if (!layer.main && !layer.sub) return;
  const short = Math.min(W, H);
  const mainSize = short * 0.085 * layer.sizePct / 100;
  const subSize = mainSize * 0.52;
  ctx.fillStyle = layer.color;
  ctx.textAlign = layer.align === 'left' ? 'left' : layer.align === 'right' ? 'right' : 'center';
  ctx.textBaseline = 'middle';
  const x = layer.align === 'left' ? short * 0.05 : layer.align === 'right' ? W - short * 0.05 : W / 2;
  const drawLine = (text, size, cy) => {
    if (!text) return;
    ctx.font = `700 ${size}px ${FONT_STACKS[layer.font] || FONT_STACKS.gothic}`;
    ctx.fillText(text, x, cy);
  };
  if (layer.pos === 'top') {
    drawLine(layer.main, mainSize, mainSize * 0.95);
    drawLine(layer.sub, subSize, mainSize * 0.95 + mainSize * 0.85);
  } else if (layer.pos === 'split') {
    drawLine(layer.main, mainSize, mainSize * 0.95);
    drawLine(layer.sub, subSize, H - subSize * 1.1);
  } else {
    drawLine(layer.sub, subSize, H - mainSize * 0.75 - subSize * 0.9);
    drawLine(layer.main, mainSize, H - mainSize * 0.72);
  }
}

function compose(W, H, opts = {}) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    if (opts.excludeMotif && layer.type === 'motif') continue;
    if (opts.onlyMotif && layer.type !== 'motif') continue;
    ctx.globalAlpha = (layer.opacity ?? 100) / 100;
    ctx.drawImage(layerCanvas(layer, W, H), 0, 0);
  }
  ctx.globalAlpha = 1;
  return c;
}

/* ================= 検証 ================= */

function currentValidation(W, H) {
  const noMotif = compose(W, H, { excludeMotif: true });
  const img = noMotif.getContext('2d').getImageData(0, 0, W, H);
  const v = FrameEngine.validateExport(img, state.ratio);
  let motifPx = 0;
  const motifOnly = compose(W, H, { onlyMotif: true });
  const mImg = motifOnly.getContext('2d').getImageData(0, 0, W, H);
  motifPx = FrameEngine.countOpaqueInRect(mImg, FrameEngine.centerRect(W, H));
  return { ...v, motifPx };
}

/* ================= UI部品 ================= */

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function segControl(parent, options, current, onPick) {
  const seg = h('div', 'seg');
  for (const opt of options) {
    const b = h('button', opt.value === current ? 'on' : '', opt.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', opt.value === current ? 'true' : 'false');
    b.onclick = () => onPick(opt.value);
    seg.appendChild(b);
  }
  parent.appendChild(seg);
  return seg;
}
function labeled(parent, labelText) {
  const wrap = h('div');
  wrap.appendChild(h('p', 'segLabel', labelText));
  parent.appendChild(wrap);
  return wrap;
}
function sliderField(parent, labelText, min, max, step, value, unit, onInput) {
  const wrap = h('div');
  const row = h('div', 'sliderRow');
  row.appendChild(h('span', '', labelText));
  const val = h('span', 'val', `${value}${unit}`);
  row.appendChild(val);
  wrap.appendChild(row);
  const input = h('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
  input.oninput = () => { val.textContent = `${input.value}${unit}`; onInput(parseFloat(input.value)); };
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}
function textField(parent, labelText, value, onInput, placeholder) {
  const wrap = h('div');
  wrap.appendChild(h('label', 'f', labelText));
  const input = h('input');
  input.type = 'text'; input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  input.oninput = () => onInput(input.value);
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}
function toggleField(parent, labelText, checked, onChange) {
  const wrap = h('label', 'check');
  const input = h('input');
  input.type = 'checkbox'; input.checked = !!checked;
  input.onchange = () => onChange(input.checked);
  wrap.appendChild(input);
  wrap.appendChild(h('span', '', labelText));
  parent.appendChild(wrap);
  return wrap;
}
function colorField(parent, labelText, value, onPick) {
  const wrap = labeled(parent, labelText);
  const row = h('div', 'swatches');
  for (const c of SWATCHES) {
    const b = h('button', 'sw' + (c === value ? ' on' : ''));
    b.type = 'button';
    b.style.background = c;
    b.onclick = () => { onPick(c); };
    row.appendChild(b);
  }
  const input = h('input');
  input.type = 'color'; input.value = value;
  input.oninput = () => onPick(input.value);
  row.appendChild(input);
  row.appendChild(h('span', 'hex', value));
  wrap.appendChild(row);
  return wrap;
}

/* ================= 画面の描画 ================= */

const $ = (id) => document.getElementById(id);
let savedFlashUntil = 0;

function renderStatic() {
  const s = t();
  $('introText').textContent = s.intro;
  $('langToggle').textContent = state.lang === 'ja' ? 'EN' : '日本語';
  const steps = $('steps');
  steps.innerHTML = '';
  for (const st of s.steps) steps.appendChild(h('li', '', st));
  $('bgLabel').textContent = s.previewBg;
  $('exportTitle').textContent = s.exportTitle;
  $('fnameLabel').textContent = s.fnameLabel;
  $('exportOne').textContent = s.exportOne;
  $('exportAll').textContent = s.exportAll;
  $('ratioTitle').textContent = s.ratioTitle;
  $('layersTitle').textContent = s.layersTitle;
  $('layersGuide').textContent = s.layersGuide;
  $('addLayerLabel').textContent = s.addLayer;
  $('genTitle').textContent = s.genTitle;
  $('genGuide').textContent = s.genGuide;
  $('genThemeLabel').textContent = s.genTheme;
  $('genButton').textContent = s.genButton;
  $('histTitle').textContent = s.histTitle;
  $('tplTitle').textContent = s.tplTitle;
  $('tplName').placeholder = s.tplNamePh;
  $('tplSave').textContent = s.tplSave;
  $('galleryTitle').textContent = s.galleryTitle;
  $('galleryGuide').textContent = s.galleryGuide;
  $('footerNote').textContent = s.version + SHEET_VERSION + ' — ' + s.footer;
}

function renderBgSeg() {
  const s = t();
  const seg = $('bgSeg');
  seg.innerHTML = '';
  segControl(seg, Object.keys(s.bgs).map((k) => ({ value: k, label: s.bgs[k] })), state.bg, (v) => {
    state.bg = v; save(); refresh();
  });
  const frame = document.querySelector('.previewFrame');
  if (state.bg === 'checker') frame.style.background = 'repeating-conic-gradient(#ccd1d8 0% 25%, #f4f6f8 0% 50%) 0 0 / 24px 24px';
  else if (state.bg === 'white') frame.style.background = '#ffffff';
  else if (state.bg === 'black') frame.style.background = '#000000';
  else frame.style.background = '#dceef7';
}

function renderRatioSeg() {
  const seg = $('ratioSeg');
  seg.innerHTML = '';
  segControl(seg, Object.keys(FrameEngine.SIZES).map((r) => ({ value: r, label: r })), state.ratio, (v) => {
    state.ratio = v; save(); refresh();
  });
}

function previewDims() {
  const { width, height } = FrameEngine.SIZES[state.ratio];
  const w = 440;
  return { w, h: Math.round(w * height / width) };
}

function refresh() {
  renderStatic();
  renderBgSeg();
  renderRatioSeg();
  const { w: pw, h: ph } = previewDims();
  const canvas = $('preview');
  canvas.width = pw; canvas.height = ph;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, pw, ph);
  if (state.bg === 'dummy') drawDummyScene(ctx, pw, ph);
  ctx.drawImage(compose(pw, ph), 0, 0);
  const size = FrameEngine.SIZES[state.ratio];
  $('sizeLine').textContent = `${state.ratio} · ${size.width} × ${size.height} px` + (Date.now() < savedFlashUntil ? t().savedFlash : '');
  /* 検証（表示はプレビュー寸法で判定し、書き出し時に実寸で再判定する） */
  const v = currentValidation(pw, ph);
  const rows = [
    { ok: true, label: t().vSize(`${size.width} × ${size.height}`) },
    { ok: v.centerOk, label: t().vCenter },
    { ok: v.drawingOk, label: t().vDraw },
  ];
  const vr = $('verifyRows');
  vr.innerHTML = '';
  for (const r of rows) {
    const row = h('div', 'vrow');
    row.appendChild(h('span', 'badge ' + (r.ok ? 'ok' : 'ng'), r.ok ? '✓' : '✗'));
    row.appendChild(h('span', '', r.label));
    vr.appendChild(row);
  }
  const warn = $('motifWarn');
  if (v.motifPx > 0) { warn.style.display = ''; warn.textContent = t().motifWarn(v.motifPx.toLocaleString()); }
  else warn.style.display = 'none';
  $('fnameValue').textContent = FrameEngine.fileNameFor(state.ratio, state.theme);
  renderLayerList();
  renderEditor();
  renderHistory();
  renderTemplates();
  renderGallery();
}

function renderLayerList() {
  const s = t();
  const ul = $('layerList');
  ul.innerHTML = '';
  const display = [...state.layers].reverse();
  display.forEach((layer, di) => {
    const li = h('li', layer.id === selectedLayerId ? 'sel' : '');
    const dot = h('span', 'dot');
    dot.style.background = TYPE_DOT[layer.type];
    li.appendChild(dot);
    const nameBox = h('div', '');
    nameBox.style.flex = '1'; nameBox.style.minWidth = '0';
    nameBox.appendChild(h('div', 'lname', layer.name || s.typeNames[layer.type]));
    nameBox.appendChild(h('div', 'lsub', s.typeNames[layer.type] + ((layer.type === 'art' || layer.type === 'motif') && !layer.imageId ? ' · —' : '')));
    nameBox.style.cursor = 'pointer';
    nameBox.onclick = () => { selectedLayerId = layer.id; refresh(); };
    li.appendChild(nameBox);
    const vis = h('button', 'pill sm' + (layer.visible ? ' on' : ''), layer.visible ? s.show : s.hide);
    vis.onclick = () => { layer.visible = !layer.visible; save(); refresh(); };
    li.appendChild(vis);
    const idx = state.layers.indexOf(layer);
    const up = h('button', 'mini', '↑');
    up.disabled = idx >= state.layers.length - 1;
    if (up.disabled) up.style.opacity = '.4';
    up.onclick = () => { state.layers.splice(idx, 1); state.layers.splice(idx + 1, 0, layer); save(); refresh(); };
    const down = h('button', 'mini', '↓');
    down.disabled = idx <= 0;
    if (down.disabled) down.style.opacity = '.4';
    down.onclick = () => { state.layers.splice(idx, 1); state.layers.splice(idx - 1, 0, layer); save(); refresh(); };
    const del = h('button', 'mini del', '✕');
    del.disabled = state.layers.length <= 1;
    if (del.disabled) del.style.opacity = '.4';
    del.onclick = () => {
      state.layers = state.layers.filter((l) => l.id !== layer.id);
      if (selectedLayerId === layer.id) selectedLayerId = state.layers[state.layers.length - 1].id;
      save(); refresh();
    };
    li.appendChild(up); li.appendChild(down); li.appendChild(del);
    ul.appendChild(li);
  });
  const seg = $('addLayerSeg');
  seg.innerHTML = '';
  segControl(seg, Object.keys(s.typeNames).map((k) => ({ value: k, label: '+ ' + s.typeNames[k] })), '__none__', (v) => {
    const nl = v === 'art' ? defaultArt() : v === 'motif' ? defaultMotif() : v === 'base' ? defaultBase() : defaultText();
    state.layers.push(nl);
    selectedLayerId = nl.id;
    save(); refresh();
  });
}

/* ================= レイヤー編集 ================= */

function pickImage(layer, kind) {
  const input = h('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const data = await downscaleDataURL(await fileToDataURL(f));
    layer.imageId = addImageData(data);
    save(); refresh();
  };
  input.click();
}

function requestBlock(parent, layer, kind) {
  const s = t();
  const box = h('div', 'reqBlock');
  box.appendChild(h('h3', '', kind === 'art' ? s.reqArt : s.reqMotif));
  const input = h('input');
  input.type = 'text';
  input.placeholder = s.themePh;
  input.value = state.theme || '';
  input.setAttribute('aria-label', s.themePh);
  input.oninput = () => { state.theme = input.value; save(); $('fnameValue').textContent = FrameEngine.fileNameFor(state.ratio, state.theme); };
  box.appendChild(input);
  const btn = h('button', 'copyBtn', s.copyReq);
  btn.disabled = !state.theme;
  if (btn.disabled) btn.style.opacity = '.5';
  const area = h('textarea');
  area.readOnly = true; area.rows = 7; area.style.display = 'none'; area.style.marginTop = '8px';
  const done = h('div', 'copied', s.copied);
  done.style.display = 'none';
  btn.onclick = async () => {
    const text = kind === 'art' ? s.reqArtText(state.theme, state.ratio) : s.reqMotifText(state.theme);
    area.value = text; area.style.display = '';
    try { await navigator.clipboard.writeText(text); done.style.display = ''; } catch (e) { area.select(); }
  };
  box.appendChild(btn);
  box.appendChild(area);
  box.appendChild(done);
  parent.appendChild(box);
}

function renderEditor() {
  const s = t();
  const ed = $('layerEditor');
  ed.innerHTML = '';
  const layer = state.layers.find((l) => l.id === selectedLayerId) || state.layers[state.layers.length - 1];
  if (!layer) return;
  selectedLayerId = layer.id;
  const grid = h('div', 'grid3');
  textField(grid, s.layerName, layer.name, (v) => { layer.name = v; save(); renderLayerList(); }, s.typeNames[layer.type]);
  sliderField(grid, s.opacity, 0, 100, 1, layer.opacity ?? 100, '%', (v) => { layer.opacity = v; save(); refresh(); });
  ed.appendChild(grid);
  const body = h('div', 'grid3 mt12');
  ed.appendChild(body);

  if (layer.type === 'art' || layer.type === 'motif') {
    if (!layer.imageId) {
      body.appendChild(h('p', 'guide', layer.type === 'art' ? s.artEmpty : s.motifEmpty));
      const b = h('button', 'dashedBtn', layer.type === 'art' ? s.putImage : s.putMotif);
      b.onclick = () => pickImage(layer);
      body.appendChild(b);
    } else {
      const row = h('div', 'seg');
      const rep = h('button', '', s.replace); rep.onclick = () => pickImage(layer);
      const rem = h('button', '', s.remove); rem.style.color = '#dc2626';
      rem.onclick = () => { layer.imageId = null; save(); refresh(); };
      row.appendChild(rep); row.appendChild(rem);
      body.appendChild(row);
    }
  }

  if (layer.type === 'art') {
    const w = labeled(body, s.fit);
    segControl(w, Object.keys(s.fits).map((k) => ({ value: k, label: s.fits[k] })), layer.fit, (v) => { layer.fit = v; save(); refresh(); });
    if (layer.fit === 'white-key') body.appendChild(h('p', 'guide mt8', s.fitKeyNote));
    if (layer.fit === 'edge-mask') {
      sliderField(body, s.edgeW, 2, 25, 1, layer.borderPct, '%', (v) => { layer.borderPct = v; save(); refresh(); });
      sliderField(body, s.bandH, 0, 30, 1, layer.bandPct, '%', (v) => { layer.bandPct = v; save(); refresh(); });
    }
    if (layer.fit === 'band-only') {
      sliderField(body, s.bandH, 6, 40, 1, layer.bandPct, '%', (v) => { layer.bandPct = v; save(); refresh(); });
    }
    if (layer.fit === 'full-cut') {
      toggleField(body, s.cutCenter, layer.cutCenter, (v) => { layer.cutCenter = v; save(); refresh(); });
    }
    requestBlock(ed, layer, 'art');
  }

  if (layer.type === 'motif') {
    const w = labeled(body, s.pos);
    segControl(w, MOTIF_POS.map((k) => ({ value: k, label: s.posNames[k] })), layer.pos, (v) => { layer.pos = v; save(); refresh(); });
    sliderField(body, s.size, 8, 45, 1, layer.sizePct, '%', (v) => { layer.sizePct = v; save(); refresh(); });
    toggleField(body, s.keyout, layer.keyout, (v) => { layer.keyout = v; save(); refresh(); });
    requestBlock(ed, layer, 'motif');
  }

  if (layer.type === 'text') {
    textField(body, s.mainText, layer.main, (v) => { layer.main = v; save(); refresh(); });
    textField(body, s.subText, layer.sub, (v) => { layer.sub = v; save(); refresh(); });
    const w1 = labeled(body, s.textPos);
    segControl(w1, Object.keys(s.tpos).map((k) => ({ value: k, label: s.tpos[k] })), layer.pos, (v) => { layer.pos = v; save(); refresh(); });
    const w2 = labeled(body, s.align);
    segControl(w2, Object.keys(s.aligns).map((k) => ({ value: k, label: s.aligns[k] })), layer.align, (v) => { layer.align = v; save(); refresh(); });
    const w3 = labeled(body, s.font);
    segControl(w3, Object.keys(s.fonts).map((k) => ({ value: k, label: s.fonts[k] })), layer.font, (v) => { layer.font = v; save(); refresh(); });
    colorField(body, s.color, layer.color, (v) => { layer.color = v; save(); refresh(); });
    sliderField(body, s.textSize, 50, 200, 5, layer.sizePct, '%', (v) => { layer.sizePct = v; save(); refresh(); });
  }

  if (layer.type === 'base') {
    const w = labeled(body, s.tplStruct);
    const tg = h('div', 'tplGrid');
    for (const k of Object.keys(s.structs)) {
      const b = h('button', 'tplBtn' + (layer.template === k ? ' on' : ''), s.structs[k]);
      b.onclick = () => { layer.template = k; markCustomTheme(layer, false); save(); refresh(); };
      tg.appendChild(b);
    }
    w.appendChild(tg);
    const w2 = labeled(body, s.themeLabel);
    const seg = h('div', 'seg');
    for (const k of Object.keys(THEME_PRESETS)) {
      const b = h('button', layer.theme === k ? 'on' : '');
      const dot = h('span', 'themeDot');
      dot.style.background = THEME_PRESETS[k].frame;
      b.appendChild(dot);
      b.appendChild(document.createTextNode(s.themes[k]));
      b.onclick = () => applyThemePreset(layer, k);
      seg.appendChild(b);
    }
    if (layer.theme === 'custom') {
      const chip = h('button', 'on', s.themes.custom);
      seg.appendChild(chip);
    }
    w2.appendChild(seg);
    colorField(body, s.frameColor, layer.frameColor, (v) => { layer.frameColor = v; layer.theme = 'custom'; save(); refresh(); });
    colorField(body, s.bandColor, layer.bandColor, (v) => { layer.bandColor = v; layer.theme = 'custom'; save(); refresh(); });
    colorField(body, s.accentColor, layer.accentColor, (v) => { layer.accentColor = v; layer.theme = 'custom'; save(); refresh(); });
    sliderField(body, s.borderW, 0.3, 3.5, 0.1, layer.borderPct, '%', (v) => { layer.borderPct = v; save(); refresh(); });
    sliderField(body, s.bandH, 6, 30, 1, layer.bandPct, '%', (v) => { layer.bandPct = v; save(); refresh(); });
    sliderField(body, s.density, 0, 100, 1, layer.density, '', (v) => { layer.density = v; save(); refresh(); });
    const w3 = labeled(body, s.motifShape);
    segControl(w3, Object.keys(s.shapes).map((k) => ({ value: k, label: s.shapes[k] })), layer.motif, (v) => { layer.motif = v; save(); refresh(); });
  }
}

function markCustomTheme() {}
function applyThemePreset(layer, key) {
  const p = THEME_PRESETS[key];
  if (!p) return;
  layer.theme = key;
  layer.frameColor = p.frame; layer.bandColor = p.band; layer.accentColor = p.accent; layer.motif = p.motif;
  const text = state.layers.find((l) => l.type === 'text');
  if (text) { text.main = p.main; text.sub = p.sub; text.color = '#ffffff'; }
  save(); refresh();
}

/* ================= 書き出し ================= */

function canvasBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ZIP（無圧縮ストア形式）の最小実装 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
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

function recordGallery(ratio, blob) {
  return new Promise((res) => {
    const reader = new FileReader();
    reader.onload = () => {
      const thumbImg = new Image();
      thumbImg.onload = () => {
        const tc = document.createElement('canvas');
        const tw = 260;
        tc.width = tw; tc.height = Math.round(tw * thumbImg.naturalHeight / thumbImg.naturalWidth);
        tc.getContext('2d').drawImage(thumbImg, 0, 0, tc.width, tc.height);
        state.gallery.unshift({
          id: uid(), ts: Date.now(), ratio, theme: state.theme || '',
          fileName: FrameEngine.fileNameFor(ratio, state.theme),
          thumb: tc.toDataURL('image/jpeg', 0.82),
          snapshot: JSON.parse(JSON.stringify({ layers: state.layers, ratio })),
        });
        state.gallery = state.gallery.slice(0, GALLERY_LIMIT);
        res();
      };
      thumbImg.src = reader.result;
    };
    reader.readAsDataURL(blob);
  });
}

async function exportOne(ratio) {
  const { width: W, height: H } = FrameEngine.SIZES[ratio];
  const keep = state.ratio;
  state.ratio = ratio;
  const v = currentValidation(W, H);
  state.ratio = keep;
  if (!v.ok) { refresh(); return null; }
  const blob = await canvasBlob(compose(W, H));
  await recordGallery(ratio, blob);
  save();
  savedFlashUntil = Date.now() + 2500;
  return { blob, fileName: FrameEngine.fileNameFor(ratio, state.theme) };
}

async function onExportOne() {
  const btn = $('exportOne');
  btn.disabled = true; btn.textContent = t().exporting;
  const r = await exportOne(state.ratio);
  if (r) downloadBlob(r.blob, r.fileName);
  btn.disabled = false;
  refresh();
}
async function onExportAll() {
  const btn = $('exportAll');
  btn.disabled = true; btn.textContent = t().exporting;
  const files = [];
  for (const ratio of Object.keys(FrameEngine.SIZES)) {
    const r = await exportOne(ratio);
    if (r) files.push({ name: r.fileName, blob: r.blob });
  }
  if (files.length) downloadBlob(await zipStore(files), 'encadra-frames.zip');
  btn.disabled = false;
  refresh();
}

/* ================= ギャラリー・テンプレート・生成履歴の描画 ================= */

let galleryConfirmId = null;
function renderGallery() {
  const s = t();
  const grid = $('galleryGrid');
  grid.innerHTML = '';
  $('galleryEmpty').style.display = state.gallery.length ? 'none' : '';
  $('galleryEmpty').textContent = s.galleryEmpty;
  for (const item of state.gallery) {
    const card = h('div', 'gCard');
    const img = h('img');
    img.src = item.thumb;
    img.style.background = 'repeating-conic-gradient(#ccd1d8 0% 25%, #f4f6f8 0% 50%) 0 0 / 16px 16px';
    card.appendChild(img);
    const meta = h('div', 'gMeta');
    meta.appendChild(h('div', 'r', `${item.ratio} · ${new Date(item.ts).toLocaleString()}`));
    meta.appendChild(h('div', 't', item.theme || item.fileName));
    const btns = h('div', 'gBtns');
    if (galleryConfirmId === item.id) {
      meta.appendChild(h('div', 't', s.confirmDel));
      meta.querySelector('.t:last-child').style.color = '#dc2626';
      const yes = h('button', 'pill sm on', s.doDel);
      yes.style.background = '#dc2626'; yes.style.borderColor = '#dc2626';
      yes.onclick = () => { state.gallery = state.gallery.filter((g) => g.id !== item.id); galleryConfirmId = null; save(); refresh(); };
      const no = h('button', 'pill sm', s.cancel);
      no.onclick = () => { galleryConfirmId = null; refresh(); };
      btns.appendChild(yes); btns.appendChild(no);
    } else {
      const restore = h('button', 'pill sm on', s.gRestore);
      restore.onclick = () => {
        state.layers = JSON.parse(JSON.stringify(item.snapshot.layers));
        state.ratio = item.snapshot.ratio;
        selectedLayerId = state.layers[state.layers.length - 1].id;
        save(); refresh();
      };
      const dl = h('button', 'pill sm', s.gRedl);
      dl.onclick = async () => {
        const keep = state.layers;
        state.layers = JSON.parse(JSON.stringify(item.snapshot.layers));
        const { width: W, height: H } = FrameEngine.SIZES[item.ratio];
        const blob = await canvasBlob(compose(W, H));
        state.layers = keep;
        downloadBlob(blob, item.fileName);
      };
      const del = h('button', 'pill sm red', s.del);
      del.onclick = () => { galleryConfirmId = item.id; refresh(); };
      btns.appendChild(restore); btns.appendChild(dl); btns.appendChild(del);
    }
    meta.appendChild(btns);
    card.appendChild(meta);
    grid.appendChild(card);
  }
}

function renderTemplates() {
  const s = t();
  const list = $('tplList');
  list.innerHTML = '';
  const names = Object.keys(state.templates);
  if (!names.length) {
    list.appendChild(h('p', 'guide mt12', s.tplEmpty));
    return;
  }
  for (const name of names) {
    const row = h('div', 'rowFlex');
    row.style.padding = '10px 0';
    row.style.borderTop = '1px solid var(--border)';
    const nm = h('span', 'grow', name);
    nm.style.fontSize = '14px'; nm.style.fontWeight = '500';
    row.appendChild(nm);
    const load = h('button', 'pill sm', s.tplLoad);
    load.onclick = () => {
      const tpl = state.templates[name];
      state.layers = JSON.parse(JSON.stringify(tpl.layers));
      state.ratio = tpl.ratio;
      selectedLayerId = state.layers[state.layers.length - 1].id;
      save(); refresh();
    };
    const del = h('button', 'pill sm red', s.del);
    del.onclick = () => { delete state.templates[name]; save(); refresh(); };
    row.appendChild(load); row.appendChild(del);
    list.appendChild(row);
  }
}

function renderHistory() {
  const s = t();
  const list = $('histList');
  list.innerHTML = '';
  if (!state.history.length) {
    list.appendChild(h('p', 'guide', s.histEmpty));
    return;
  }
  for (const item of state.history) {
    const card = h('div', 'histCard');
    const img = h('img');
    img.src = state.images[item.imageId] || '';
    img.style.background = 'repeating-conic-gradient(#ccd1d8 0% 25%, #f4f6f8 0% 50%) 0 0 / 12px 12px';
    card.appendChild(img);
    const box = h('div', '');
    box.style.flex = '1';
    box.appendChild(h('div', 'lname', item.theme));
    box.appendChild(h('div', 'lsub', new Date(item.ts).toLocaleString()));
    const btns = h('div', 'gBtns');
    const put = h('button', 'pill sm on', s.histPut);
    put.onclick = () => {
      const nl = defaultArt();
      nl.imageId = item.imageId;
      state.layers.push(nl);
      selectedLayerId = nl.id;
      save(); refresh();
    };
    const del = h('button', 'pill sm red', s.histDel);
    del.onclick = () => { state.history = state.history.filter((x) => x.id !== item.id); save(); refresh(); };
    btns.appendChild(put); btns.appendChild(del);
    box.appendChild(btns);
    card.appendChild(box);
    list.appendChild(card);
  }
}

/* ================= 直接投入の経路（§3） =================
   会話の中で生成した画像を、ユーザーの手作業なしにレイヤーへ入れるための口。
   Space への移植時は、この口を Space の保存の仕組みに接続すること。 */

window.FrameMakerAPI = {
  addGeneratedImage(dataURL, kind) {
    const id = addImageData(dataURL);
    const layer = kind === 'motif' ? defaultMotif() : defaultArt();
    layer.imageId = id;
    state.layers.push(layer);
    selectedLayerId = layer.id;
    save(); refresh();
    return layer.id;
  },
  setTheme(theme) { state.theme = theme; save(); refresh(); },
  getState() { return JSON.parse(JSON.stringify(state)); },
  version: SHEET_VERSION,
};

/* ================= 初期化 ================= */

function init() {
  load();
  if (state.version !== SHEET_VERSION) state.version = SHEET_VERSION;
  if (!state.layers.length) state.layers = [defaultBase()];
  if (!state.layers.find((l) => l.id === selectedLayerId)) selectedLayerId = state.layers[state.layers.length - 1].id;
  $('langToggle').onclick = () => { state.lang = state.lang === 'ja' ? 'en' : 'ja'; save(); refresh(); };
  $('exportOne').onclick = onExportOne;
  $('exportAll').onclick = onExportAll;
  const genTheme = $('genTheme');
  genTheme.value = state.theme || '';
  genTheme.oninput = () => { state.theme = genTheme.value; save(); };
  $('genButton').onclick = async () => {
    const theme = (state.theme || '').trim();
    if (!theme) return;
    const btn = $('genButton');
    btn.disabled = true; btn.textContent = t().generating;
    await new Promise((r) => setTimeout(r, 600));
    const { width, height } = FrameEngine.SIZES[state.ratio];
    const c = generateArtCanvas(theme, Math.round(440 * width / Math.max(width, height) * (width >= height ? 1 : 1)), Math.round(440 * height / Math.max(width, height)));
    const id = addImageData(c.toDataURL('image/png'));
    state.history.unshift({ id: uid(), ts: Date.now(), theme, imageId: id });
    save();
    btn.disabled = false;
    refresh();
  };
  $('tplSave').onclick = () => {
    const name = $('tplName').value.trim();
    if (!name) return;
    state.templates[name] = JSON.parse(JSON.stringify({ layers: state.layers, ratio: state.ratio }));
    $('tplName').value = '';
    save(); refresh();
  };
  save();
  refresh();
}

document.addEventListener('DOMContentLoaded', init);

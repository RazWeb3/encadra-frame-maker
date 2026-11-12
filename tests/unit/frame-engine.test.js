/**
 * Encadra Frame Maker — frame-engine unit tests
 *
 * 核の計算（reference/frame-engine.js）の単体テスト。Space の外でも実行できる。
 * Run: node --test tests/unit/frame-engine.test.js
 * 仕様の正本は README.md（指示書）の §4・§5・§6。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FE = require('../../reference/frame-engine.js');

function makeImage(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  const img = { data, width, height };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return img;
}

test('§4 寸法表は長辺1920px統一で、Encadra上限4096px以内', () => {
  const expected = {
    '1:1': [1920, 1920], '4:5': [1536, 1920], '3:2': [1920, 1280],
    '16:9': [1920, 1080], '9:16': [1080, 1920],
  };
  for (const [ratio, [w, h]] of Object.entries(expected)) {
    assert.equal(FE.SIZES[ratio].width, w, ratio);
    assert.equal(FE.SIZES[ratio].height, h, ratio);
    assert.ok(Math.max(w, h) <= FE.ENCADRA_MAX_LONG_EDGE, ratio);
  }
});

test('§5 aspectRatioMatches: 比率で判定し、同方向の潰し込みを検出する', () => {
  // 依頼比率と一致する実寸
  assert.equal(FE.aspectRatioMatches(1920, 1280, '3:2'), true);
  assert.equal(FE.aspectRatioMatches(1920, 1080, '16:9'), true);
  assert.equal(FE.aspectRatioMatches(1536, 1920, '4:5'), true);
  assert.equal(FE.aspectRatioMatches(1080, 1920, '9:16'), true);
  // 同じ横向きでも 3:2 と 16:9 は別物（今回のバグの再現条件）
  assert.equal(FE.aspectRatioMatches(1920, 1080, '3:2'), false);
  assert.equal(FE.aspectRatioMatches(1920, 1280, '16:9'), false);
  // 同じ縦向きでも 4:5 と 9:16 は別物
  assert.equal(FE.aspectRatioMatches(1080, 1920, '4:5'), false);
  assert.equal(FE.aspectRatioMatches(1536, 1920, '9:16'), false);
  // ピクセル寸法が違っても比率が合えば合格（生成モデルの出力寸法は環境依存）
  assert.equal(FE.aspectRatioMatches(1024, 683, '3:2'), true);
  assert.equal(FE.aspectRatioMatches(500, 500, '3:2'), false);
  assert.equal(FE.aspectRatioMatches(0, 100, '3:2'), false);
});

test('§4 ファイル名: 形式とテーマ整形', () => {
  assert.equal(FE.fileNameFor('4:5', 'Birthday Party'), 'encadra-frame_4-5_birthday-party.png');
  assert.equal(FE.fileNameFor('3:2', '旅行'), 'encadra-frame_3-2_myframe.png');
  assert.equal(FE.fileNameFor('1:1', ''), 'encadra-frame_1-1_myframe.png');
  assert.equal(FE.slugifyTheme('  Cats & Dogs!! '), 'cats-dogs');
});

test('§4 キーアウト: 白は alpha 0、濃い色は alpha 不変', () => {
  assert.equal(FE.keyoutFactor(255, 255, 255), 0);
  assert.equal(FE.keyoutFactor(0, 0, 0), 1);
  const img = makeImage(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [10, 20, 30, 255]));
  FE.applyKeyout(img);
  assert.equal(img.data[3], 0);
  assert.equal(img.data[7], 255);
});

test('§6 validateExport: 実寸・中央透過・描画の3点', () => {
  const { width: W, height: H } = FE.SIZES['3:2'];
  // 縁だけ描画し中央は透明 → 合格
  const ok = makeImage(W, H, (x, y) => (x < 40 || y < 40 ? [200, 80, 80, 255] : [0, 0, 0, 0]));
  const r1 = FE.validateExport(ok, '3:2');
  assert.equal(r1.ok, true);
  // 中央に濃いピクセルがわずか（1px、1%以下）→ 合格＋警告（v0.19 緩和）
  const bad = makeImage(W, H, (x, y) => (x === W / 2 && y === H / 2 ? [0, 0, 0, 255] : [200, 80, 80, x < 40 ? 255 : 0]));
  const r2 = FE.validateExport(bad, '3:2');
  assert.equal(r2.centerOk, true);
  assert.equal(r2.centerWarning, true);
  assert.equal(r2.ok, true);
  // 中央に薄いピクセル（alpha < 128、水彩のにじみ）だけ → 数えず合格、警告もなし
  const faint = makeImage(W, H, (x, y) => (x >= W / 2 - 5 && x < W / 2 + 5 && y >= H / 2 - 5 && y < H / 2 + 5 ? [240, 200, 200, 100] : [200, 80, 80, x < 40 ? 255 : 0]));
  const r2b = FE.validateExport(faint, '3:2');
  assert.equal(r2b.centerOk, true);
  assert.equal(r2b.centerWarning, false);
  // 中央の広い範囲（1%超）が濃い → 項目2で不合格
  const wide = makeImage(W, H, (x, y) => (x >= W * 0.4 && x < W * 0.6 && y >= H * 0.4 && y < H * 0.6 ? [0, 0, 0, 255] : [200, 80, 80, x < 40 ? 255 : 0]));
  const r2c = FE.validateExport(wide, '3:2');
  assert.equal(r2c.centerOk, false);
  assert.equal(r2c.ok, false);
  // 実寸が違う → 項目1で不合格
  const small = makeImage(100, 100, () => [200, 80, 80, 255]);
  const r3 = FE.validateExport(small, '3:2');
  assert.equal(r3.sizeOk, false);
  assert.equal(r3.ok, false);
  // 全透明（空） → 項目3で不合格
  const empty = makeImage(W, H, () => [0, 0, 0, 0]);
  const r4 = FE.validateExport(empty, '3:2');
  assert.equal(r4.drawingOk, false);
  assert.equal(r4.ok, false);
});

test('§6 項目5 validateWhiteFrame: 窓が透明・白地が残るものは合格、窓が不透明なら不合格', () => {
  const W = 200, H = 200;
  // 中央の窓（全体の36%）だけ透明、外側は白で不透明
  const framed = makeImage(W, H, (x, y) => (x >= 40 && x < 160 && y >= 40 && y < 160 ? [0, 0, 0, 0] : [255, 255, 255, 255]));
  const r1 = FE.validateWhiteFrame(framed);
  assert.equal(r1.ok, true);
  assert.equal(r1.windowFound, true);
  // 全面不透明（窓なし） → 不合格
  const solid = makeImage(W, H, () => [255, 255, 255, 255]);
  const r2 = FE.validateWhiteFrame(solid);
  assert.equal(r2.ok, false);
  // 白地フレーム型は validateExport の合否を項目5が担う
  const r3 = FE.validateExport(framed, '1:1', null, { whiteFrame: true, white: FE.validateWhiteFrame(framed) });
  assert.equal(r3.whiteOk, FE.validateWhiteFrame(framed).ok);
});

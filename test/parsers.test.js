const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../src/parsers.js');
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('TTML: ticks, clock, offset-time, dur, ruby and markup', () => {
  const r = P.parseTTML(fx('sample.ttml'));
  assert.strictEqual(r.language, 'ja');
  assert.deepStrictEqual(r.cues, [
    [1.234, 1.502, 'こんにちは、元気？'],
    [20.5, 22, 'ええ、元気です。'],
    [30, 32.5, 'Tom & Jerry!'],
  ]);
});

test('TTML2/IMSC ruby (Netflix): the reading goes, by style or on the span, its base stays', () => {
  const r = P.parseTTML(fx('ruby-imsc.ttml'));
  assert.deepStrictEqual(r.cues, [
    [10, 12, '黒沼さん おはよう'],
    [13, 15, '駅前で待ってて'],
    [16, 18, '（友達）今日は早いね'],
  ]);
});

test('VTT: short/long timestamps, tags, entities, multi-line, notes, empty cues', () => {
  const r = P.parseVTT(fx('sample.vtt'));
  assert.deepStrictEqual(r.cues, [
    [1, 3.5, 'おはようございます'],
    [10, 11, '今日はいい天気'],
    [3723.25, 3725, 'Hello there General Kenobi <3'],
  ].sort((a, b) => a[0] - b[0]));
  assert.match(r.timestampMap, /MPEGTS:900000/);
});

test('sniff and parseAny', () => {
  assert.strictEqual(P.sniff(fx('sample.ttml')), 'ttml');
  assert.strictEqual(P.sniff('﻿WEBVTT\n'), 'vtt');
  assert.strictEqual(P.sniff('{"a":1}'), null);
  assert.strictEqual(P.sniff('<html><body></body></html>'), null);
  assert.strictEqual(P.parseAny('hello'), null);
  assert.strictEqual(P.parseAny(fx('sample.vtt')).cues.length, 3);
});

test('guessLanguage', () => {
  assert.strictEqual(P.guessLanguage(P.parseVTT(fx('sample.vtt')).cues), 'ja');
  assert.strictEqual(P.guessLanguage([[0, 1, '你好，今天天气很好，我们去公园玩吧']]), 'zh');
  assert.strictEqual(P.guessLanguage([[0, 1, 'This is plainly an English sentence.']]), 'en');
});

test('normLang', () => {
  assert.strictEqual(P.normLang('ja-JP'), 'ja');
  assert.strictEqual(P.normLang('zh-Hant'), 'zh');
  assert.strictEqual(P.normLang(''), null);
});

test('subtitle playlist', () => {
  const m3u = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="en",URI="a.m3u8"\n' +
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",LANGUAGE="ja",NAME="日本語",URI="sub/ja/playlist.m3u8"\n';
  assert.strictEqual(P.sniff(m3u), 'm3u8-subs');
  assert.deepStrictEqual(P.parseSubtitlePlaylist(m3u), [{ language: 'ja', uri: 'sub/ja/playlist.m3u8', name: '日本語' }]);
});

test('episode info', () => {
  assert.deepStrictEqual(P.parseEpisodeInfo(['E3', 'The title']), { season: null, episode: 3, title: 'The title' });
  assert.deepStrictEqual(P.parseEpisodeInfo(['S2:E10', 'Another']), { season: 2, episode: 10, title: 'Another' });
  assert.deepStrictEqual(P.parseEpisodeInfo(['Season 1: Episode 3 The title']), { season: 1, episode: 3, title: 'The title' });
  assert.deepStrictEqual(P.parseEpisodeInfo([]), { season: null, episode: null, title: null });
});

/* ============================================================
   style.js · 문체·가독성 정밀 진단 (의존성 없음)
   ------------------------------------------------------------
   기존 점검이 "금지 표현 사전"에 걸리는 단어를 세는 방식이라면,
   이 모듈은 문장 단위로 리듬을 본다.

     ① 반복 어미 — 같은 어미가 3문장 연속이면 AI 티가 난다
     ② 문장 길이 — 평균·편차·가장 긴 문장(호흡이 끊기는 지점)
     ③ 수동·번역체 — "~에 의해", "~되어진다", "~에 대한", "~에 있어서"
     ④ 연결어·문장 첫 단어 반복
     ⑤ 쉼표로 늘어진 한 문장(한 호흡 60자 초과)

   점수는 0~100. 항목별 근거(phrase·index)를 함께 돌려주므로
   화면에서 "어디를 고치면 되는지"까지 보여 줄 수 있다.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StyleCheck = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  function trim(v) { return String(v === null || v === undefined ? '' : v).replace(/^\s+|\s+$/g, ''); }

  function sentencesOf(text) {
    return String(text || '').replace(/\r/g, '')
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+|\n{2,}/)
      .map(function (s) { return trim(s); })
      .filter(function (s) { return s.length > 0 && /[가-힣A-Za-z0-9]/.test(s); });
  }

  /* ── 어미 ──────────────────────────────────────────────
     문장 끝의 마지막 2~3음절을 '어미'로 본다.
     "합니다 / 했습니다"는 같은 계열로 묶어야 반복이 보인다. */
  var ENDING_FAMILY = [
    { re: /(니다|습니다|ㅂ니다)$/, key: '~니다' },
    { re: /(어요|아요|여요|예요|이에요|에요)$/, key: '~어요' },
    { re: /(었다|았다|였다|했다|됐다)$/, key: '~했다' },
    { re: /(한다|된다|이다)$/, key: '~한다' },
    { re: /(는데|지만|면서|라고|다고)$/, key: '~연결' },
    { re: /(죠|네요|군요|더라)$/, key: '~말끝' }
  ];

  function bare(s) {
    return trim(s).replace(/[.!?…"'”’)\]\s]+$/g, '').replace(/\s+/g, '');
  }

  function endingOf(sentence) {
    var b = bare(sentence);
    if (!b) return '';
    for (var i = 0; i < ENDING_FAMILY.length; i++) {
      if (ENDING_FAMILY[i].re.test(b)) return ENDING_FAMILY[i].key;
    }
    var last = b.slice(-2);
    return last;
  }

  /** 같은 어미가 연속으로 나온 구간 */
  function endingRuns(sentences) {
    var runs = [];
    var i = 0;
    while (i < sentences.length) {
      var key = endingOf(sentences[i]);
      var j = i + 1;
      while (j < sentences.length && key && endingOf(sentences[j]) === key) j++;
      if (j - i >= 3) runs.push({ key: key, count: j - i, start: i, samples: sentences.slice(i, j).map(function (s) { return s.slice(0, 42); }) });
      i = j;
    }
    return runs;
  }

  /* ── 감지 사전 ─────────────────────────────────────────── */
  var PASSIVE = [
    { re: /에\s*의해\s*/g, label: '~에 의해' },
    { re: /되어\s*진다|되어\s*진\s|되어진/g, label: '되어진다(이중 수동)' },
    { re: /되어지(고|는|며|면|었|어|ㄹ)/g, label: '~되어지다' },
    { re: /되어\s*집니다|되어집니다/g, label: '되어집니다' },
    { re: /지게\s*된다|지게\s*됩니다/g, label: '~지게 된다' },
    { re: /여겨진다|여겨집니다/g, label: '~여겨진다' },
    { re: /판단된다|판단됩니다/g, label: '~판단된다' },
    { re: /보여진다|보여집니다/g, label: '~보여진다' },
    { re: /요구되어\s*진다|요구되어진다/g, label: '~요구되어진다' },
    { re: /[가-힣]+되어\s*있습니다/g, label: '~되어 있습니다' }
  ];

  var TRANSLATIONESE = [
    { re: /에\s*대한\s/g, label: '~에 대한' },
    { re: /에\s*대해\s/g, label: '~에 대해' },
    { re: /에\s*있어서/g, label: '~에 있어서' },
    { re: /을\s*통해|를\s*통해/g, label: '~을 통해' },
    { re: /의\s*경우/g, label: '~의 경우' },
    { re: /그것은\s/g, label: '그것은' },
    { re: /하는\s*것이\s*가능/g, label: '~하는 것이 가능' },
    { re: /라는\s*사실/g, label: '~라는 사실' },
    { re: /에\s*다름\s*아니다/g, label: '~에 다름 아니다' },
    { re: /의\s*관점에서/g, label: '~의 관점에서' },
    { re: /로\s*인해|으로\s*인해/g, label: '~로 인해' },
    { re: /에\s*기인/g, label: '~에 기인' },
    { re: /을\s*가지고\s*있는|를\s*가지고\s*있는/g, label: '~을 가지고 있는' },
    { re: /할\s*수\s*있다는\s*점/g, label: '~할 수 있다는 점' }
  ];

  var CONNECTORS = ['또한', '따라서', '그러나', '하지만', '즉', '한편', '게다가', '더욱이', '결국', '그래서', '그런데', '반면'];
  var FILLERS = ['매우', '정말', '아주', '굉장히', '너무나', '무척', '상당히', '다양한', '여러 가지'];

  function findPatterns(text, list) {
    var out = [];
    var t = String(text || '');
    list.forEach(function (p) {
      var re = new RegExp(p.re.source, 'g');
      var m;
      while ((m = re.exec(t)) !== null) {
        out.push({ phrase: trim(m[0]), label: p.label, index: m.index });
        if (re.lastIndex === m.index) re.lastIndex++;
        if (out.length > 60) return;
      }
    });
    return out.sort(function (a, b) { return a.index - b.index; });
  }

  function countWords(text, words) {
    var out = [];
    var t = String(text || '');
    words.forEach(function (w) {
      var re = new RegExp('(^|[^가-힣])' + w + '(?![가-힣])', 'g');
      var m, n = 0;
      while ((m = re.exec(t)) !== null) { n++; if (re.lastIndex === m.index) re.lastIndex++; }
      if (n > 0) out.push({ word: w, count: n });
    });
    return out.sort(function (a, b) { return b.count - a.count; });
  }

  function startsOf(sentences) {
    var map = {};
    sentences.forEach(function (s) {
      var w = trim(s).split(/[\s,.!?]/)[0];
      if (!w || w.length < 2) return;
      map[w] = (map[w] || 0) + 1;
    });
    return Object.keys(map).map(function (w) { return { word: w, count: map[w] }; })
      .filter(function (x) { return x.count >= 2; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  function stats(nums) {
    if (!nums.length) return { min: 0, max: 0, avg: 0, median: 0, p90: 0, stdev: 0 };
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    var sum = nums.reduce(function (a, b) { return a + b; }, 0);
    var avg = sum / nums.length;
    var varr = nums.reduce(function (a, b) { return a + (b - avg) * (b - avg); }, 0) / nums.length;
    function at(p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))]; }
    return {
      min: sorted[0], max: sorted[sorted.length - 1],
      avg: Math.round(avg * 10) / 10,
      median: at(0.5), p90: at(0.9),
      stdev: Math.round(Math.sqrt(varr) * 10) / 10
    };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /**
   * @param {string} text
   * @returns {object} 화면이 그대로 그릴 수 있는 진단 결과
   */
  function report(text) {
    var t = String(text || '');
    var sents = sentencesOf(t);
    var lens = sents.map(function (s) { return bare(s).length; });
    var len = stats(lens);
    var runs = endingRuns(sents);
    var endings = sents.map(endingOf).filter(Boolean);
    var variety = endings.length ? new Set(endings).size / endings.length : 1;
    var passive = findPatterns(t, PASSIVE);
    var trans = findPatterns(t, TRANSLATIONESE);
    var connectors = countWords(t, CONNECTORS).filter(function (x) { return x.count >= 2; });
    var fillers = countWords(t, FILLERS);
    var starts = startsOf(sents);
    var longSents = sents.filter(function (s) { return bare(s).length >= 80; })
      .map(function (s) { return { text: s.slice(0, 60) + (s.length > 60 ? '…' : ''), len: bare(s).length }; })
      .slice(0, 4);
    var commaHeavy = sents.filter(function (s) {
      return bare(s).length >= 60 && (s.match(/,/g) || []).length >= 3;
    }).length;
    var maxRun = runs.reduce(function (a, r) { return Math.max(a, r.count); }, 0);
    var per1000 = function (n) { return t.length ? Math.round((n / t.length) * 1000 * 10) / 10 : 0; };

    /* 점수: 길이 리듬 · 어미 다양성 · 수동/번역체 밀도 */
    var lenScore = 100;
    if (len.avg > 60) lenScore = 82;
    if (len.avg > 75) lenScore = 64;
    if (len.avg > 90) lenScore = 46;
    if (longSents.length >= 2) lenScore -= 8;
    if (len.avg < 12 && sents.length >= 6) lenScore -= 8;           // 너무 잘게 끊긴 글도 리듬이 없다
    if (len.stdev > 0 && len.stdev < 6 && sents.length >= 6) lenScore -= 6;  // 길이가 다 비슷하면 기계적으로 읽힌다
    lenScore = clamp(Math.round(lenScore), 0, 100);

    var endScore = 100;
    if (maxRun >= 3) endScore -= 18;
    if (maxRun >= 4) endScore -= 12;
    if (maxRun >= 5) endScore -= 10;
    if (variety < 0.55) endScore -= 10;
    if (variety < 0.4) endScore -= 10;
    endScore = clamp(Math.round(endScore), 0, 100);

    var passScore = 100;
    var pDensity = per1000(passive.length + trans.length);
    if (pDensity > 2) passScore = 86;
    if (pDensity > 4) passScore = 70;
    if (pDensity > 8) passScore = 52;
    passScore = clamp(Math.round(passScore), 0, 100);

    var total = clamp(Math.round(lenScore * 0.34 + endScore * 0.33 + passScore * 0.33), 0, 100);

    var tips = [];
    if (maxRun >= 3) tips.push('같은 어미가 ' + maxRun + '문장 연속입니다. 한 문장은 명사형으로 끊어 보세요.');
    if (len.avg > 70) tips.push('한 문장이 평균 ' + len.avg + '자입니다. 40~55자로 끊으면 읽는 속도가 살아납니다.');
    if (longSents.length) tips.push('공백 없이 80자를 넘는 문장이 ' + longSents.length + '개 있습니다. 가장 긴 문장부터 둘로 나누세요.');
    if (passive.length) tips.push('수동 표현 ' + passive.length + '곳(' + passive[0].label + ' 등)을 능동으로 바꾸면 주체가 보입니다.');
    if (trans.length) tips.push('번역체 ' + trans.length + '곳(' + trans[0].label + ' 등)은 한국어 구어로 바꿀 수 있습니다.');
    if (connectors.length) tips.push('연결어 "' + connectors[0].word + '"가 ' + connectors[0].count + '번 나옵니다. 절반은 지워도 뜻이 통합니다.');
    if (starts.length) tips.push('"' + starts[0].word + '"로 시작하는 문장이 ' + starts[0].count + '개입니다. 시작 단어를 바꿔 보세요.');
    if (commaHeavy) tips.push('쉼표가 3개 이상인 긴 문장이 ' + commaHeavy + '개 있습니다. 쉼표 자리에서 끊으세요.');

    return {
      ok: sents.length > 0,
      sentences: sents.length,
      chars: t.replace(/\s/g, '').length,
      length: len,
      longSentences: longSents,
      endings: { variety: Math.round(variety * 100), maxRun: maxRun, runs: runs.slice(0, 3), top: topEndings(endings) },
      passive: passive.slice(0, 8),
      translationese: trans.slice(0, 8),
      passiveDensity: pDensity,
      connectors: connectors,
      fillers: fillers,
      starts: starts.slice(0, 3),
      commaHeavy: commaHeavy,
      scores: { length: lenScore, endings: endScore, passivity: passScore, total: total },
      tips: tips.slice(0, 5)
    };
  }

  function topEndings(endings) {
    var map = {};
    endings.forEach(function (e) { map[e] = (map[e] || 0) + 1; });
    return Object.keys(map).map(function (k) { return { key: k, count: map[k] }; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 3);
  }

  /** 한 줄 요약 — 점수 옆에 붙이는 문구 */
  function summary(text) {
    var r = report(text);
    if (!r.ok) return '본문을 붙여넣으면 문체를 진단합니다.';
    var bits = ['문장 ' + r.sentences + '개', '평균 ' + r.length.avg + '자'];
    if (r.endings.maxRun >= 3) bits.push('같은 어미 ' + r.endings.maxRun + '연속');
    if (r.passive.length + r.translationese.length) bits.push('수동·번역체 ' + (r.passive.length + r.translationese.length) + '곳');
    return bits.join(' · ');
  }

  return {
    VERSION: VERSION,
    sentencesOf: sentencesOf,
    endingOf: endingOf,
    endingRuns: endingRuns,
    report: report,
    summary: summary,
    stats: stats
  };
});

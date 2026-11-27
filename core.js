/* ============================================================
   원탭 원고 스튜디오 · core.js
   무료 초안 조립 · 진단 · 프롬프트 · 내보내기. DOM 없이 돈다.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var D = require('./data.js');
    var ST = null;
    try { ST = require('./style.js'); } catch (e) { ST = null; }
    module.exports = factory(D.WriterData || D, require('./engines/copy-psych-engine.js'), ST);
  } else {
    root.WriterCore = factory(root.WriterData, root.CopyPsych, root.StyleCheck);
  }
})(typeof self !== 'undefined' ? self : this, function (D, CP, ST) {
  'use strict';

  var VERSION = '1.0.0';

  /* ==========================================================
     0. 유틸
     ========================================================== */

  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function trim(v) { return str(v).replace(/\u00a0/g, ' ').trim(); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function hash(s) {
    var h = 2166136261, t = str(s);
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0);
  }

  function countChars(text) { return str(text).replace(/\s/g, '').length; }

  function sentencesOf(text) {
    return str(text).replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  /* ── 조사 ────────────────────────────────────────────── */
  function lastCharInfo(word) {
    var s = trim(word).replace(/[\s"'“”‘’)\].!?~…·]+$/, '');
    if (!s) return null;
    var ch = s.charAt(s.length - 1);
    var code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return { jong: (code - 0xAC00) % 28 !== 0, digit: false };
    if (code >= 0x30 && code <= 0x39) {
      var digits = { '0': true, '1': true, '3': true, '6': true, '7': true, '8': true };
      return { jong: !!digits[ch], digit: true };
    }
    return null;
  }

  var JOSA_PAIRS = {
    '은는': ['은', '는'],
    '이가': ['이', '가'],
    '을를': ['을', '를'],
    '으로로': ['으로', '로'],
    '와과': ['과', '와'],
    '이에요예요': ['이에요', '예요']
  };

  function josa(word, pair) {
    var p = JOSA_PAIRS[pair];
    if (!p) return '';
    var info = lastCharInfo(word);
    if (!info) return p[1];
    if (pair === '으로로') {
      if (info.digit) return info.jong ? p[0] : p[1];
      return info.jong ? p[0] : p[1];
    }
    return info.jong ? p[0] : p[1];
  }

  function withJosa(word, pair) {
    var w = trim(word);
    if (!w) return '';
    return w + josa(w, pair);
  }

  /* ── 슬롯 채우기 ─────────────────────────────────────── */
  function fill(tpl, ctx) {
    var out = str(tpl).replace(/\{(\w+)(?::([가-힣]+))?\}/g, function (m, key, pair) {
      var v = trim((ctx || {})[key]);
      if (!v) return '';
      return pair ? withJosa(v, pair) : v;
    });
    return tidy(out);
  }

  function tidy(text) {
    var t = str(text)
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/([,.!?])\1+/g, '$1')
      .replace(/^[\s,]+/, '')
      .trim();
    return t;
  }

  /* ==========================================================
     1. 입력 정규화
     ========================================================== */

  function formatById(id) {
    var f = (D.FORMATS || []).filter(function (x) { return x.id === id; })[0];
    return f || D.FORMATS[0];
  }
  function toneById(id) {
    var t = (D.TONES || []).filter(function (x) { return x.id === id; })[0];
    return t || D.TONES[0];
  }

  function splitExperience(raw) {
    var lines = str(raw).replace(/\r/g, '').split(/\n+/);
    var out = [];
    lines.forEach(function (line) {
      var parts = trim(line).split(/(?<=[.!?])\s+/);
      parts.forEach(function (p) {
        var t = trim(p).replace(/^[-•*]\s*/, '');
        if (t.length >= 8) out.push(t);
      });
    });
    return out.slice(0, 6);
  }

  function normalizeInput(input) {
    var i = input || {};
    var f = formatById(i.format);
    var t = toneById(i.tone);
    return {
      format: f.id,
      tone: t.id,
      topic: trim(i.topic).slice(0, 60) || '주제를 입력하세요',
      target: trim(i.target).slice(0, 40) || '이 글을 읽을 사람',
      keyword: trim(i.keyword).slice(0, 30),
      product: trim(i.product).slice(0, 40),
      price: trim(i.price).slice(0, 30),
      experience: splitExperience(i.experience),
      experienceRaw: trim(i.experience).slice(0, 1200),
      seed: Math.abs(parseInt(i.seed, 10) || 0),
      cta: trim(i.cta).slice(0, 40)
    };
  }

  /* ==========================================================
     2. 무료 초안 조립
     ========================================================== */

  function packOf(tone) { return D.LINES[tone === 'honest' ? 'talk' : tone] || D.LINES.talk; }

  function picker(input) {
    var base = hash(input.topic + '|' + input.target + '|' + input.keyword);
    var used = new Map();
    return function (arr, k) {
      if (!arr || !arr.length) return '';
      var seen = used.get(arr);
      if (!seen) { seen = {}; used.set(arr, seen); }
      var idx = (base + input.seed * 17 + (k || 0) * 7) % arr.length;
      var guard = 0;
      while (seen[idx] && guard < arr.length) { idx = (idx + 1) % arr.length; guard++; }
      seen[idx] = 1;
      return arr[idx];
    };
  }

  function headOf(topic) {
    var t = trim(topic);
    var stripped = t.replace(/\s*(고르기|고르는\s*법|고르는\s*방법|선택법|선택|추천|정리|방법)$/, '');
    return stripped.length >= 2 ? stripped : t;
  }

  function ctxOf(input, extra) {
    return Object.assign({
      topic: input.topic,
      head: headOf(input.topic),
      target: input.target,
      kw: input.keyword || input.topic,
      product: input.product || input.topic,
      price: input.price || '구성에 따라 다름',
      exp: input.experience[0] || ''
    }, extra || {});
  }

  function buildTitles(input) {
    var ctx = ctxOf(input);
    var pats = D.TITLE_PATTERNS.slice();
    var start = hash(input.topic) % pats.length;
    var out = [];
    for (var i = 0; i < 5; i++) {
      var p = pats[(start + i) % pats.length];
      var title = fill(p.tpl, ctx);
      if (out.indexOf(title) >= 0) continue;
      out.push(title);
    }
    // 중복이 줄었으면 남은 패턴으로 채운다.
    for (var j = 0; out.length < 5 && j < pats.length; j++) {
      var alt = fill(pats[j].tpl, ctx);
      if (out.indexOf(alt) < 0) out.push(alt);
    }
    return out;
  }

  function blogDraft(input) {
    var pack = packOf(input.tone);
    var pick = picker(input);
    var ctx = ctxOf(input);
    var H = D.HEADINGS.blog;
    var exp = input.experience;
    var lines = [];
    var photos = D.PHOTOS.blog;

    // 도입
    lines.push(fill(pick(pack.open, 0), ctx));
    lines.push(fill(pick(pack.empathy, 1), ctx));
    if (input.tone === 'honest') lines.push(fill(pick(D.HONEST_NOTES, 2), ctx));
    lines.push(fill(pick(pack.scene, 3), ctx));
    lines.push(fill(pick(pack.promise, 4), ctx));
    lines.push('');
    lines.push('[사진 1] ' + photos[0]);
    lines.push('');

    // 1. 문제
    lines.push('■ ' + fill(pick(H.why, 5), ctx));
    lines.push(exp[0] || fill(pick(pack.tried, 6), ctx));
    lines.push(fill(pick(pack.failed, 7), ctx));
    lines.push(fill(pick(pack.mistake, 8), ctx));
    lines.push(fill(pick(pack.criteria, 9), ctx));
    lines.push(fill(pick(pack.example, 30), ctx));
    lines.push('');
    lines.push('[사진 2] ' + photos[1]);
    lines.push('');

    // 2. 기준
    lines.push('■ ' + fill(pick(H.criteria, 10), ctx));
    lines.push(fill(pick(pack.principle, 11), ctx));
    lines.push(fill(pick(pack.compare, 12), ctx));
    lines.push(fill(pick(pack.howto, 13), ctx));
    lines.push(fill(pick(pack.example, 31), ctx));
    lines.push('');

    // 3. 방법
    lines.push('■ ' + fill(pick(H.method, 14), ctx));
    lines.push(exp[1] || fill(pick(pack.tried, 15), ctx));
    lines.push(fill(pick(pack.detail, 16), ctx));
    lines.push(fill(pick(pack.howto, 17), ctx));
    lines.push(fill(pick(pack.cost, 18), ctx));
    lines.push(fill(pick(pack.example, 32), ctx));
    lines.push('');
    lines.push('[사진 3] ' + photos[2]);
    lines.push('');

    // 4. 체크리스트
    lines.push('■ ' + fill(pick(H.check, 19), ctx));
    lines.push(fill(pick(pack.principle, 20), ctx));
    var items = D.LINES[input.tone === 'honest' ? 'talk' : input.tone].checkItem;
    for (var i = 0; i < 5; i++) lines.push('- ' + fill(items[(i + input.seed) % items.length], ctx));
    lines.push('');
    lines.push('[사진 4] ' + photos[3]);
    lines.push('');
    lines.push('[비교표] 사기 전 마지막 확인');
    lines.push('항목 | 통과 기준 | 내 메모');
    lines.push('쓰는 시간 | 하루 한 번은 손이 가는가 | ');
    lines.push('반복 횟수 | 하루 몇 번 쓰는가 | ');
    lines.push('치우는 시간 | 정리 시간이 쓰는 시간보다 짧은가 | ');
    lines.push('');

    // 5. 솔직한 평가
    lines.push('■ ' + fill(pick(H.honest, 21), ctx));
    lines.push(exp[2] || fill(pick(pack.good, 22), ctx));
    lines.push(fill(pick(pack.good, 23), ctx));
    lines.push(fill(pick(pack.bad, 24), ctx));
    lines.push(fill(pick(pack.who, 25), ctx));
    lines.push('');
    lines.push('[사진 5] ' + photos[4]);

    // 마무리
    lines.push('');
    lines.push(fill(pick(pack.cta, 26), ctx));
    lines.push(fill(pick(pack.closingNote, 33), ctx));
    lines.push(fill(pick(pack.ask, 27), ctx));
    lines.push('');
    lines.push('[사진 6] ' + photos[5]);
    lines.push('[내부링크] 같은 주제의 이전 글 2건을 여기에 넣으세요. 없으면 지워도 됩니다.');

    return {
      format: 'blog',
      body: tidyBlock(lines),
      titles: buildTitles(input),
      hook: '',
      firstComment: '',
      photos: photos.slice(0, 6),
      outline: outlineOf(lines)
    };
  }

  function threadDraft(input) {
    var pack = packOf(input.tone);
    var pick = picker(input);
    var ctx = ctxOf(input);
    var exp = input.experience;
    var hook = fill(pick(pack.thHook, 0), ctx);
    var b1 = exp[0] || fill(pick(pack.thBody, 1), ctx);
    var b2 = exp[1] || fill(pick(pack.thBody, 2), ctx);
    var b3 = exp[2] || fill(pick(pack.thBody, 3), ctx);
    var b4 = fill(pick(pack.thBody, 6), ctx);
    var close = fill(pick(pack.thClose, 4), ctx);
    var comment = fill(pick(pack.thComment, 5), ctx);

    var blocks = [hook, b1, b2, b3, b4, close].filter(Boolean).map(function (b) { return trim(b); });
    var body = blocks.join('\n\n');
    return {
      format: 'thread',
      body: body,
      titles: [],
      hook: hook,
      hookChars: hook.length,
      firstComment: comment,
      photos: D.PHOTOS.thread.slice(),
      outline: blocks.map(function (b, i) {
        return { label: i === 0 ? '훅 (250자)' : (i === blocks.length - 1 ? '마무리' : (i + 1) + '부'), text: b };
      })
    };
  }

  function salesDraft(input) {
    var pack = packOf(input.tone);
    var pick = picker(input);
    var ctx = ctxOf(input);
    var H = D.HEADINGS.sales;
    var exp = input.experience;
    var lines = [];

    lines.push('■ ' + fill(pick(H.sProblem, 0), ctx));
    lines.push(fill(pick(pack.sProblem, 1), ctx));
    if (exp[0]) lines.push(exp[0]);
    lines.push(fill(pick(pack.scene, 2), ctx));
    lines.push('');
    lines.push('■ ' + fill(pick(H.sCause, 3), ctx));
    lines.push(fill(pick(pack.sCause, 4), ctx));
    lines.push(fill(pick(pack.compare, 5), ctx));
    lines.push('');
    lines.push('■ ' + fill(pick(H.sSolution, 6), ctx));
    lines.push(fill(pick(pack.sSolution, 7), ctx));
    lines.push(fill(pick(pack.detail, 8), ctx));
    lines.push(fill(pick(pack.example, 21), ctx));
    lines.push('');
    lines.push('[사진 1] ' + D.PHOTOS.sales[0]);
    lines.push('');
    lines.push('■ ' + fill(pick(H.sProof, 9), ctx));
    lines.push(exp[1] || fill(pick(pack.sProof, 10), ctx));
    lines.push(fill(pick(pack.cost, 11), ctx));
    lines.push('');
    lines.push('■ ' + fill(pick(H.sDiff, 12), ctx));
    lines.push(fill(pick(pack.sDiff, 13), ctx));
    lines.push(fill(pick(pack.micro, 14), ctx));
    lines.push(fill(pick(pack.who, 22), ctx));
    lines.push('[사진 2] ' + D.PHOTOS.sales[1]);
    lines.push('');
    lines.push('■ ' + fill(pick(H.sRisk, 15), ctx));
    lines.push(fill(pick(pack.sRisk, 16), ctx));
    lines.push(fill(pick(pack.mistake, 17), ctx));
    lines.push('[사진 3] ' + D.PHOTOS.sales[3]);
    lines.push('');
    lines.push('■ ' + fill(pick(H.sClose, 18), ctx));
    lines.push(fill(pick(pack.sClose, 19), ctx));
    lines.push(fill(pick(pack.closingNote, 23), ctx));
    lines.push(fill(pick(pack.cta, 20), ctx));
    lines.push('[가격] ' + input.price);
    lines.push('[사진 4] ' + D.PHOTOS.sales[2]);

    return {
      format: 'sales',
      body: tidyBlock(lines),
      titles: buildTitles(input),
      hook: '',
      firstComment: '',
      photos: D.PHOTOS.sales.slice(),
      outline: outlineOf(lines)
    };
  }

  function tidyBlock(lines) {
    return lines.map(function (l) { return str(l).replace(/[ \t]+$/g, ''); })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function outlineOf(lines) {
    var out = [];
    lines.forEach(function (l, i) {
      if (/^■\s/.test(l)) out.push({ label: l.replace(/^■\s*/, ''), index: i });
    });
    return out;
  }

  function buildDraft(input) {
    var I = normalizeInput(input);
    if (typeof window !== 'undefined' && window.ONETAP_LANG === 'en') {
      var dEn = buildDraftEN(I);
      dEn.input = I;
      dEn.chars = countChars(dEn.body);
      dEn.charsWithSpace = dEn.body.length;
      dEn.target = formatById(I.format).target;
      dEn.usedExperience = I.experience.length;
      return dEn;
    }
    var draft;
    if (I.format === 'thread') draft = threadDraft(I);
    else if (I.format === 'sales') draft = salesDraft(I);
    else draft = blogDraft(I);
    draft.input = I;
    draft.chars = countChars(draft.body);
    draft.charsWithSpace = draft.body.length;
    draft.target = formatById(I.format).target;
    draft.usedExperience = I.experience.length;
    return draft;
  }


  /* ==========================================================
     English draft builder (EN UI). Korean builder above unchanged.
     ========================================================== */
  function enTitles(I) {
    var t = I.topic, who = I.audience || 'first-time readers';
    var kw = I.keyword || t;
    return [
      kw + ': the order that saves you a second purchase',
      'What ' + who + ' should check before ' + t,
      'I got ' + t + ' wrong twice — the criteria were the problem',
      kw + ' in 3 checks, from someone who tried it',
      t + ' — what actually changed after two months'
    ];
  }

  function enCtx(I) {
    return {
      topic: I.topic,
      who: I.audience || 'readers',
      kw: I.keyword || I.topic,
      price: I.price || ''
    };
  }

  function buildDraftEN(I) {
    var exp = (I.experience || []).slice();
    var c = enCtx(I);
    var photosBlog = [
      'A photo of the spot as it is now. Before tidying is even better. Only your own shots.',
      'A photo of the thing that failed, or a receipt and order history. Blur names and numbers.',
      'A photo of how you use it now, hands visible. Real photos beat screenshots.',
      'A photo of the note where you wrote the three criteria. Handwriting is fine.',
      'A wide closing shot — desk, storage or where it sits.',
      'Two options side by side. Skip it if you only have one.'
    ];
    var photosThread = ['One real screenshot or photo that shows the scene.'];
    var photosSales = ['A photo of the product in use.', 'A close-up that proves the detail.', 'Before and after, side by side.'];
    var body = [];
    var titles = enTitles(I);

    if (I.format === 'thread') {
      var hook = (exp[0] ? exp[0] : 'I spent two months on ' + c.topic + ' before the obvious thing worked.') ;
      var b1 = exp[1] || 'The first attempt looked fine on paper and failed in a week.';
      var b2 = exp[2] || 'What changed was the order, not the product.';
      var b3 = 'Three checks: how often you touch it, how long it takes to clean, and what it costs to run.';
      var b4 = 'If one of those numbers is a surprise, you are looking at the wrong option.';
      var close = 'That is it. Nothing else moved the result for me.';
      var comment = 'What did you get wrong first? I will add it to the next post.';
      var blocks = [hook, b1, b2, b3, b4, close].filter(Boolean);
      return {
        format: 'thread',
        body: blocks.join('\n\n'),
        titles: [],
        hook: hook,
        hookChars: hook.length,
        firstComment: comment,
        photos: photosThread,
        outline: blocks.map(function (b, i) {
          return { label: i === 0 ? 'Hook (250 chars)' : (i === blocks.length - 1 ? 'Close' : 'Part ' + (i + 1)), text: b };
        })
      };
    }

    if (I.format === 'sales') {
      var s1 = '■ The problem\n' + (exp[0] || c.topic + ' looks simple until you have to choose one.');
      var s2 = '■ Why it happens\nMost comparisons list features. Nobody lists the order you use them in.';
      var s3 = '■ The fix\n' + (exp[1] || 'Pick three checks that matter daily, then compare only those.');
      var s4 = '■ Proof\n' + (exp[2] || 'Two months of use, two replacements, one order that finally held.');
      var s5 = '■ What makes it different\n' + (c.kw || c.topic) + ' is judged on the daily cost, not the spec sheet.';
      var s6 = '■ Risk reversal\n' + (I.price ? 'Price: ' + I.price + '. ' : '') + 'Return terms are whatever the seller actually offers — check before buying.';
      var s7 = '■ Next step\nOpen the page and compare the three checks above.';
      body = [s1, s2, s3, s4, s5, s6, s7];
      return {
        format: 'sales',
        body: body.join('\n\n'),
        titles: titles,
        hook: '',
        firstComment: '',
        photos: photosSales,
        outline: [
          { label: 'Problem' }, { label: 'Cause' }, { label: 'Fix' }, { label: 'Proof' },
          { label: 'Difference' }, { label: 'Risk reversal' }, { label: 'CTA' }
        ]
      };
    }

    var open = (exp[0] || 'I bought ' + c.topic + ' twice before I understood what I was choosing.');
    body.push(open);
    body.push('If you are ' + c.who + ', the hard part is not the price. It is the order you check things in.');
    body.push('I got that order wrong for two months, and it cost more than the product did.');
    body.push('Here are the three checks I use now, in the order that finally worked.');
    body.push('');
    body.push('[Photo 1] ' + photosBlog[0]);
    body.push('');
    body.push('■ Why ' + c.who + ' get stuck here');
    body.push(exp[1] || 'Every listing looks good in photos. The difference only shows up in daily use.');
    body.push('I picked on looks first, then on reviews, and neither told me how often I would clean it.');
    body.push('So the first check is not quality. It is how often the thing asks for your hands.');
    body.push('');
    body.push('[Photo 2] ' + photosBlog[1]);
    body.push('');
    body.push('■ The three criteria');
    body.push('1. How often you touch it in a day. If the answer is "constantly", the rest does not matter.');
    body.push('2. How long cleaning takes. Ten minutes daily is 60 hours a year.');
    body.push('3. What it costs to run, not just to buy.');
    body.push('');
    body.push('■ The order I use now');
    body.push(exp[2] || 'I start with the daily routine, then the cleaning time, then the price.');
    body.push('It takes about 20 minutes on a weekend and it has not failed me yet.');
    body.push('');
    body.push('[Photo 3] ' + photosBlog[2]);
    body.push('');
    body.push('■ Checklist before you buy');
    body.push('- Can you clean it in under ten minutes?');
    body.push('- Does it fit where you will actually use it?');
    body.push('- Are the consumables easy to buy nearby?');
    body.push('- Is the return window long enough to test it?');
    body.push('- Would you still want it at full price?');
    body.push('');
    body.push('[Photo 4] ' + photosBlog[3]);
    body.push('');
    body.push('[Comparison] Last check before buying');
    body.push('Item | Pass criteria | My note');
    body.push('Daily use | Do you touch it once a day or more | ');
    body.push('Cleaning | Under ten minutes | ');
    body.push('Running cost | Predictable per month | ');
    body.push('');
    body.push('■ Honest review');
    body.push('What worked: the routine got shorter once the order was right.');
    body.push('What did not: the first unit was still the wrong size for the room.');
    body.push('Who it suits: anyone who will actually do the ten minutes.');
    body.push('');
    body.push('[Photo 5] ' + photosBlog[4]);
    body.push('');
    body.push('If you are choosing now, start with the checks above before the price.');
    body.push('It is not a big decision. It is three questions asked in the right order.');
    body.push('What did you get wrong first? Tell me in the comments.');
    body.push('');
    body.push('[Photo 6] ' + photosBlog[5]);
    body.push('[Internal links] Add two earlier posts on the same topic here, or delete the line.');

    return {
      format: 'blog',
      body: body.join('\n'),
      titles: titles,
      hook: '',
      firstComment: '',
      photos: photosBlog,
      outline: [
        { label: 'Why ' + c.who + ' get stuck here' },
        { label: 'The three criteria' },
        { label: 'The order I use now' },
        { label: 'Checklist before you buy' },
        { label: 'Honest review' }
      ]
    };
  }

  /* ==========================================================
     3. 진단
     ========================================================== */

  function gradeOf(score) {
    var s = Number(score) || 0;
    if (s >= 92) return { id: 'A', label: '바로 올려도 됩니다' };
    if (s >= 84) return { id: 'B', label: '한두 곳만 고치면 됩니다' };
    if (s >= 72) return { id: 'C', label: '손볼 곳이 있습니다' };
    if (s >= 60) return { id: 'D', label: '다시 써야 합니다' };
    return { id: 'E', label: '구조부터 다시' };
  }

  function hitsOf(rules, text) {
    var out = [];
    (rules || []).forEach(function (r) {
      var re = new RegExp(r.re.source, 'g');
      var m;
      while ((m = re.exec(text)) !== null) {
        out.push({ phrase: m[0], label: r.label, note: r.note, index: m.index });
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    });
    return out;
  }

  function structureOf(text, format) {
    var t = str(text);
    if (format === 'thread') {
      var blocks = t.split(/\n{2,}/).map(function (b) { return trim(b); }).filter(Boolean);
      return { blocks: blocks.length, headings: [], ok: blocks.length >= 3, need: '타래 3개 이상' };
    }
    var heads = (t.match(/^■\s.+$/gm) || []).map(function (h) { return h.replace(/^■\s*/, ''); });
    var need = format === 'sales' ? 7 : 5;
    return { blocks: heads.length, headings: heads, ok: heads.length >= need, need: '소제목 ' + need + '단' };
  }

  /**
   * 원고 점검. 반환값은 UI가 그대로 그린다.
   * @param {string} text
   * @param {object} [input] 포맷 판단용
   */
  function scoreDraft(text, input) {
    var I = normalizeInput(input || {});
    var format = I.format;
    var t = str(text);
    var chars = countChars(t);
    var sents = sentencesOf(t);
    var avg = sents.length ? Math.round(chars / sents.length) : 0;
    var det = CP && CP.detect ? CP.detect(t) : { friction: 0, issues: [], groups: [] };
    var legal = hitsOf(D.LEGAL_RULES, t);
    var spam = hitsOf(D.SPAM_RULES, t);
    var extra = hitsOf(D.AI_EXTRA, t);
    var links = (t.match(/https?:\/\/\S+|www\.\S+/gi) || []).map(function (u) { return { phrase: u.slice(0, 40) }; });
    var privacy = (t.match(/0\d{1,2}-\d{3,4}-\d{4}|[\w.+-]+@[\w-]+\.[\w.]{2,}|\d{2,6}-\d{2,6}-\d{2,6}/g) || [])
      .map(function (p) { return { phrase: p }; });

    var aiIssues = det.issues.filter(function (x) { return x.type !== 'risk'; });
    var aiPenalty = 0;
    det.issues.forEach(function (x) { if (x.type !== 'risk') aiPenalty += (x.severity || 1); });
    det.issues.forEach(function (x) { if (x.type === 'risk') aiPenalty += 0; });

    var struct = structureOf(t, format);
    var dup = duplicateSentences(t);
    var s = 100;
    var items = [];

    function note(id, label, count, penalty, detail, samples) {
      if (penalty <= 0 && count === 0) return;
      s -= penalty;
      items.push({
        id: id, label: label, count: count, penalty: Math.round(penalty * 10) / 10,
        detail: detail, samples: (samples || []).slice(0, 4)
      });
    }

    note('ai', 'AI 티 표현', aiIssues.length + extra.length, Math.min(28, aiPenalty * 0.5 + extra.length * 2),
      '번역체·추상어·공급자 중심 문장을 걷어냅니다.',
      aiIssues.map(function (x) { return x.phrase; }).concat(extra.map(function (x) { return x.phrase; })));
    note('legal', '표시광고법 위험', legal.length, Math.min(24, legal.length * 8),
      '근거 없는 최상급·보장·효능 단정은 게시 후 문제가 됩니다.',
      legal.map(function (x) { return x.label + ' · ' + x.phrase; }));
    note('spam', '도달 저하 표현', spam.length, Math.min(12, spam.length * 4),
      '교환·판매 유도 표현은 노출이 줄어듭니다.',
      spam.map(function (x) { return x.label + ' · ' + x.phrase; }));
    if (format === 'thread') {
      note('link', '본문 링크', links.length, Math.min(12, links.length * 6),
        '스레드·인스타는 본문 링크에서 도달이 떨어집니다. 첫 댓글에 두세요.',
        links.map(function (x) { return x.phrase; }));
    }
    note('privacy', '개인정보 노출', privacy.length, Math.min(16, privacy.length * 8),
      '전화번호·이메일·계좌 형태는 가리거나 지우세요.',
      privacy.map(function (x) { return x.phrase; }));

    if (chars === 0) {
      note('empty', '본문 비어 있음', 1, 40, '초안을 조립하거나 붙여넣으세요.', []);
    } else if (format === 'blog') {
      if (chars < 1200) note('len', '분량 부족', 1, 14, '블로그는 공백 제외 2,200자를 목표로 합니다.', []);
      else if (chars < 1800) note('len', '분량 부족', 1, 7, '2,200자까지 3~4문단 더 채우면 좋습니다.', []);
      else if (chars > 4200) note('len', '분량 초과', 1, 4, '4,200자를 넘으면 중간 이탈이 늘어납니다.', []);
    } else if (format === 'thread') {
      var hook = trim(t.split(/\n{2,}/)[0] || '');
      var hookLen = hook.length;
      if (hookLen > 250) note('hook', '훅 250자 초과', 1, 10, '첫 줄이 ' + hookLen + '자입니다. 250자 안으로 줄이세요.', []);
      if (hookLen > 0 && hookLen < 25) note('hook', '훅이 짧음', 1, 5, '첫 줄에 상황과 결과를 한 문장으로 넣으세요.', []);
      if (chars < 120) note('len', '분량 부족', 1, 8, '타래 3개 이상으로 이어 붙이세요.', []);
    } else if (format === 'sales') {
      if (chars < 500) note('len', '분량 부족', 1, 10, '7단 구조를 채우면 900자가 됩니다.', []);
      if (chars > 1800) note('len', '분량 초과', 1, 4, '상세페이지는 900~1,500자가 읽기 좋습니다.', []);
    }

    if (avg > 90) note('sentence', '문장이 너무 김', 1, 8, '한 문장 평균 ' + avg + '자입니다. 60자 아래로 끊으세요.', []);
    else if (avg > 70) note('sentence', '문장이 긴 편', 1, 4, '한 문장 평균 ' + avg + '자입니다.', []);
    note('dup', '같은 문장 반복', dup.length, Math.min(9, dup.length * 3), '반복된 문장은 지우거나 바꾸세요.', dup);
    var style = null;
    if (ST && typeof ST.report === 'function') {
      try { style = ST.report(t); } catch (e) { style = null; }
    }
    if (style && style.ok) {
      var run = style.endings.maxRun;
      if (run >= 3) {
        note('ending', '같은 어미 반복', run, Math.min(3, 1 + Math.floor((run - 3) / 3)),
          '같은 어미가 ' + run + '문장 연속입니다. 한 문장은 명사형으로 끊어 보세요.',
          (style.endings.runs[0] ? style.endings.runs[0].samples : []));
      }
      if (style.commaHeavy >= 2) {
        note('comma', '쉼표로 늘어진 문장', style.commaHeavy, Math.min(2, style.commaHeavy),
          '쉼표가 3개 이상인 긴 문장이 ' + style.commaHeavy + '개 있습니다. 쉼표 자리에서 끊으세요.', []);
      }
    }
    if (!struct.ok) note('structure', '구조 미완성', 1, 6, struct.need + '이 필요합니다. 지금 ' + struct.blocks + '개입니다.', []);
    if (!I.experience.length && I.experienceRaw === '') {
      note('exp', '경험 메모 없음', 1, 4, '내 경험 2~3줄을 넣으면 3곳이 구체적으로 바뀝니다.', []);
    }

    var total = clamp(Math.round(s), 0, 100);
    var positives = [];
    if (aiIssues.length === 0 && extra.length === 0) positives.push('AI 티 표현이 걸리지 않았습니다');
    if (legal.length === 0) positives.push('표시광고법 위험 표현 0건');
    if (struct.ok) positives.push(struct.need + ' 충족');
    if (format === 'blog' && chars >= 2200) positives.push('2,200자 목표 달성');
    if (I.experience.length >= 2) positives.push('경험 메모 ' + I.experience.length + '곳 반영');

    return {
      score: total,
      grade: gradeOf(total),
      chars: chars,
      charsWithSpace: t.length,
      target: formatById(format).target,
      progress: formatById(format).target ? clamp(chars / formatById(format).target, 0, 1.4) : 1,
      paragraphs: t.split(/\n{2,}/).filter(function (p) { return trim(p); }).length,
      sentences: sents.length,
      avgSentence: avg,
      readSeconds: Math.max(1, Math.round(sents.length * 2.2)),
      items: items,
      legal: legal,
      spam: spam,
      links: links,
      privacy: privacy,
      aiExtra: extra,
      friction: det.friction,
      frictionGroups: det.groups,
      style: style,
      structure: struct,
      duplicates: dup,
      positives: positives,
      psych: CP && CP.diagnose ? CP.diagnose(t) : null
    };
  }

  function duplicateSentences(text) {
    var seen = {}, dup = [];
    sentencesOf(text).forEach(function (s) {
      var k = s.replace(/\s/g, '');
      if (k.length < 12) return;
      if (seen[k]) {
        if (dup.indexOf(s) < 0) dup.push(s);
      } else seen[k] = 1;
    });
    return dup;
  }

  /* ==========================================================
     4. AI 티 다듬기 (무료, 규칙 기반)
     ========================================================== */

  function localPolish(text) {
    var before = str(text);
    var applied = [];
    var out = before;

    if (CP && CP.correct) {
      var res = CP.correct(out);
      out = res.text;
      (res.applied || []).forEach(function (a) {
        applied.push({ label: a.label || a.id || String(a), count: a.count || 1 });
      });
    }

    D.AI_EXTRA.forEach(function (rule) {
      var re = new RegExp(rule.re.source, 'g');
      if (!re.test(out)) return;
      out = out.replace(new RegExp(rule.re.source, 'g'), rule.fix);
      applied.push({ label: rule.label, count: 1 });
    });

    out = out
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/\(\s*\)/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    var after = scoreDraft(out, { format: 'blog', experience: 'x' });
    return {
      text: out,
      applied: applied,
      changed: out !== before,
      before: scoreDraft(before, { format: 'blog', experience: 'x' }).score,
      after: after.score
    };
  }

  /* ==========================================================
     5. 프롬프트
     ========================================================== */

  var BANNED_LIST = [
    'AI 요약체(~입니다 체 남발, "결론적으로", "시사하는 바")',
    '번역체("~에 대한", "~을 통해", "그것은", "되어집니다")',
    '추상어("다양한", "최고의", "완벽한", "혁신적인", "프리미엄")',
    '근거 없는 최상급·1위·100%·완치·부작용 없음·유일',
    '이모지 3개 이상, 느낌표 연속',
    '없는 수치나 후기 만들기'
  ];

  function formatRules(id) {
    if (id === 'blog') {
      return [
        '공백 제외 2,200자 이상 2,500자 이하',
        '소제목 5단(■ 표기)과 도입 3문장',
        '체크리스트 1개(5항목)와 비교표 1개',
        '사진 위치 5~6곳을 [사진] 표기로 남기기',
        '마지막에 댓글 유도 질문 1개',
        '내부링크 2건 자리 남기기'
      ];
    }
    if (id === 'thread') {
      return [
        '첫 줄 250자 이내, 경험 메모에 있는 숫자나 사실로 시작(없는 숫자 금지)',
        '빈 줄로 구분된 4~5개 블록(타래)',
        '본문에 외부 링크 0건, 연락 유도 0건',
        '마지막 블록은 질문으로 끝내기',
        '자기 첫 댓글은 별도 블록으로 1~2문장'
      ];
    }
    return [
      '7단 구조: 문제 → 원인 → 해결 → 증거 → 차별점 → 리스크 리버설 → CTA',
      '각 단계 소제목 1줄, 본문 2~3문장',
      '900~1,500자',
      '환불·교환 조건은 실제 정책 범위 안에서만',
      '가격은 사용자가 준 값만 쓰기'
    ];
  }

  function buildPrompt(input, draft, opts) {
    var I = normalizeInput(input);
    var o = opts || {};
    var f = formatById(I.format);
    var tone = toneById(I.tone);
    var target = I.format === 'blog' ? 2200 : (I.format === 'thread' ? 450 : 950);
    var lines = [];

    lines.push('[요청]');
    lines.push('한국어 ' + f.label + ' 완성 원고를 새로 써 주세요. 아래 초안은 구조 참고용입니다. 문장을 그대로 쓰지 말고 다시 쓰세요.');
    lines.push('');
    lines.push('[독자]');
    lines.push(I.target + ' — 이 사람이 지금 겪는 상황을 첫 문장에 넣으세요.');
    lines.push('');
    lines.push('[주제]');
    lines.push(I.topic + (I.keyword ? ' (핵심 키워드: ' + I.keyword + ')' : ''));
    if (I.product) lines.push('[제품] ' + I.product + ' / 가격: ' + I.price);
    lines.push('');
    lines.push('[내 경험 — 사실 그대로만 사용]');
    if (I.experience.length) {
      I.experience.forEach(function (e, i) { lines.push((i + 1) + '. ' + e); });
    } else {
      lines.push('(없음) 경험을 지어내지 말고, 일반적인 판단 기준만 쓰세요.');
    }
    lines.push('');
    lines.push('[말투]');
    lines.push(tone.label + ' — ' + tone.desc);
    lines.push(I.format === 'thread' ? '스레드는 반말·음슴체로 짧게 끊으세요.' : '문장은 60자 안쪽으로 끊고, 한 문단은 3문장을 넘기지 마세요.');
    lines.push('');
    lines.push('[구조]');
    formatRules(I.format).forEach(function (r) { lines.push('- ' + r); });
    lines.push('');
    lines.push('[금지]');
    BANNED_LIST.forEach(function (b) { lines.push('- ' + b); });
    lines.push('- 초안에 없는 사실, 수치, 후기 추가 금지');
    lines.push('');
    lines.push('[초안 구조 참고]');
    var skeleton = (draft && draft.body ? draft.body : '')
      .split('\n')
      .filter(function (l) { return /^■\s/.test(l) || /^\[사진/.test(l) || /^\[비교표/.test(l); })
      .join('\n');
    lines.push(skeleton || '(없음)');
    lines.push('');
    lines.push('[출력]');
    lines.push('설명, 인사말, 머리말 없이 원고만 출력하세요. 분량은 ' + target + '자 안팎. 코드블록으로 감싸지 마세요.');

    return {
      system: '너는 한국어 콘텐츠 작가다. 주어진 사실만 쓰고, AI 요약체와 번역체를 쓰지 않는다. 결과는 원고 본문만 출력한다.',
      prompt: lines.join('\n')
    };
  }

  function buildPolishPrompt(text, input) {
    var I = normalizeInput(input || {});
    var lines = [];
    lines.push('[요청]');
    lines.push('아래 원고를 같은 뜻과 같은 분량으로 다시 써 주세요. AI가 쓴 티가 나는 부분만 걷어내면 됩니다.');
    lines.push('');
    lines.push('[지킬 것]');
    lines.push('- 사실, 수치, 경험은 바꾸지 않습니다. 없는 내용을 더하지 않습니다.');
    lines.push('- 문단 구조와 소제목은 유지합니다.');
    lines.push('- 분량은 원문의 90~110%로 맞춥니다.');
    lines.push('- 말투는 ' + toneById(I.tone).label + ' 그대로 유지합니다.');
    lines.push('');
    lines.push('[걷어낼 것]');
    BANNED_LIST.forEach(function (b) { lines.push('- ' + b); });
    lines.push('- 같은 문장 반복, 60자가 넘는 긴 문장');
    lines.push('');
    lines.push('[원고]');
    lines.push(str(text).slice(0, 6000));
    lines.push('');
    lines.push('[출력]');
    lines.push('원고만 출력하세요. 무엇을 고쳤는지 설명하지 마세요.');
    return {
      system: '너는 한국어 교정 작가다. 뜻을 바꾸지 않고 문장만 다듬는다.',
      prompt: lines.join('\n')
    };
  }

  function parseProOutput(raw) {
    var t = str(raw);
    t = t.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
    t = t.replace(/^(완성 원고|원고|초안|결과|답변)\s*[:：]\s*/, '');
    t = t.replace(/^\[?제목 후보\]?[\s\S]*?(?=\n\s*\n)/, function (m) {
      return /■|훅/.test(m) ? m : '';
    });
    return t.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ==========================================================
     6. 내보내기
     ========================================================== */

  function headBlock(draft) {
    if (!draft || !draft.titles || !draft.titles.length) return '';
    var head = '제목 후보\n';
    draft.titles.forEach(function (t, i) { head += (i + 1) + ') ' + t + '\n'; });
    return head;
  }

  function toText(draft) {
    var d = draft || {};
    var out = '';
    if (d.titles && d.titles.length) out += headBlock(d) + '\n';
    out += d.body || '';
    if (d.firstComment) out += '\n\n[자기 첫 댓글]\n' + d.firstComment;
    return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function mdTable(lines) {
    // lines: ["항목 | 통과 기준 | 내 메모", "쓰는 시간 | ... | "]
    if (!lines.length) return '';
    var rows = lines.map(function (l) {
      return l.split('|').map(function (c) { return c.trim(); });
    });
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var out = [];
    rows.forEach(function (r, i) {
      while (r.length < width) r.push('');
      out.push('| ' + r.join(' | ') + ' |');
      if (i === 0) out.push('|' + new Array(width + 1).join(' --- |'));
    });
    return out.join('\n');
  }

  function toMarkdown(draft) {
    var d = draft || {};
    var out = '';
    if (d.titles && d.titles.length) {
      out += '## 제목 후보\n';
      d.titles.forEach(function (t, i) { out += (i + 1) + '. ' + t + '\n'; });
      out += '\n';
    }
    var lines = str(d.body).split('\n');
    var tableBuf = [];
    var inTable = false;
    lines.forEach(function (l) {
      if (/^\[비교표\]/.test(l)) {
        out += '### ' + l.replace(/^\[비교표\]\s*/, '') + '\n';
        inTable = true; tableBuf = [];
        return;
      }
      if (inTable) {
        if (/^\S.*\|/.test(l) && l.indexOf('|') > 0) { tableBuf.push(l); return; }
        out += mdTable(tableBuf) + '\n\n';
        inTable = false; tableBuf = [];
      }
      if (/^■\s/.test(l)) out += '## ' + l.replace(/^■\s*/, '') + '\n';
      else if (/^\[사진/.test(l)) out += '> ' + l + '\n';
      else if (/^\[(내부링크|가격)\]/.test(l)) out += '> ' + l + '\n';
      else out += l + '\n';
    });
    if (inTable) out += mdTable(tableBuf) + '\n';
    if (d.firstComment) out += '\n### 자기 첫 댓글\n' + d.firstComment + '\n';
    return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function esc(s) {
    return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toHtml(draft) {
    var d = draft || {};
    var out = ['<article class="draft">'];
    if (d.titles && d.titles.length) {
      out.push('<h1>' + esc(d.titles[0]) + '</h1>');
      out.push('<ul class="titles">');
      d.titles.forEach(function (t) { out.push('<li>' + esc(t) + '</li>'); });
      out.push('</ul>');
    }
    var lines = str(d.body).split('\n');
    var listOpen = false;
    var tableBuf = [], inTable = false;

    function closeList() { if (listOpen) { out.push('</ul>'); listOpen = false; } }
    function flushTable() {
      if (!inTable) return;
      var rows = tableBuf.map(function (l) { return l.split('|').map(function (c) { return esc(c.trim()); }); });
      out.push('<table>');
      rows.forEach(function (r, i) {
        out.push('<tr>' + r.map(function (c) { return i === 0 ? '<th>' + c + '</th>' : '<td>' + c + '</td>'; }).join('') + '</tr>');
      });
      out.push('</table>');
      tableBuf = []; inTable = false;
    }

    lines.forEach(function (l) {
      if (inTable && (!/^\S.*\|/.test(l) || l.indexOf('|') < 0)) flushTable();
      if (/^\[비교표\]/.test(l)) {
        closeList();
        out.push('<h3>' + esc(l.replace(/^\[비교표\]\s*/, '')) + '</h3>');
        inTable = true; tableBuf = [];
        return;
      }
      if (inTable) { tableBuf.push(l); return; }
      if (/^■\s/.test(l)) { closeList(); out.push('<h2>' + esc(l.replace(/^■\s*/, '')) + '</h2>'); return; }
      if (/^-\s/.test(l)) {
        if (!listOpen) { out.push('<ul>'); listOpen = true; }
        out.push('<li>' + esc(l.replace(/^-\s*/, '')) + '</li>');
        return;
      }
      if (/^\[(사진|내부링크|가격)\]/.test(l)) {
        closeList();
        out.push('<p class="guide">' + esc(l) + '</p>');
        return;
      }
      if (!trim(l)) { closeList(); return; }
      closeList();
      out.push('<p>' + esc(l) + '</p>');
    });
    closeList();
    flushTable();
    if (d.firstComment) out.push('<h3>자기 첫 댓글</h3><p>' + esc(d.firstComment) + '</p>');
    out.push('</article>');
    return out.join('\n');
  }

  /* ==========================================================
     7. 파일명
     ========================================================== */

  function slug(text) {
    return str(text).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'draft';
  }

  function fileName(draft, ext) {
    var d = draft || {};
    var base = (d.titles && d.titles[0]) || (d.input && d.input.topic) || '원고';
    return slug(base) + '.' + (ext || 'txt');
  }

  return {
    VERSION: VERSION,
    FORMATS: D.FORMATS,
    TONES: D.TONES,
    SAMPLES: D.SAMPLES,

    formatById: formatById,
    toneById: toneById,
    normalizeInput: normalizeInput,
    splitExperience: splitExperience,
    buildDraft: buildDraft,
    buildTitles: buildTitles,

    scoreDraft: scoreDraft,
    styleReport: function (text) { return ST && ST.report ? ST.report(text) : null; },
    gradeOf: gradeOf,
    localPolish: localPolish,
    duplicateSentences: duplicateSentences,

    buildPrompt: buildPrompt,
    buildPolishPrompt: buildPolishPrompt,
    parseProOutput: parseProOutput,
    formatRules: formatRules,
    BANNED_LIST: BANNED_LIST,

    toText: toText,
    toMarkdown: toMarkdown,
    toHtml: toHtml,
    fileName: fileName,

    /* 유틸 (테스트·앱 공용) */
    josa: josa,
    withJosa: withJosa,
    fill: fill,
    tidy: tidy,
    countChars: countChars,
    sentencesOf: sentencesOf,
    structureOf: structureOf,
    _util: { hash: hash, clamp: clamp, hitsOf: hitsOf, lastCharInfo: lastCharInfo }
  };
});

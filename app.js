/* ============================================================
   원탭 원고 스튜디오 · app.js
   화면 조립과 이벤트. 조립·점검·프롬프트는 core.js가 한다.
   ============================================================ */
(function () {
  'use strict';

  var C = window.WriterCore;
  var D = window.WriterData;
  var Pro = window.ProConnector;
  var KEY = 'ai-writer-studio:v1';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var state = {
    tab: 'write',
    format: 'blog',
    tone: 'talk',
    draft: null,
    seed: 0,
    report: null,
    pro: null,
    saveTimer: null,
    scoreTimer: null,
    busy: false
  };

  /* ── 저장 ─────────────────────────────────────────────── */
  function loadStore() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveStore(immediate) {
    clearTimeout(state.saveTimer);
    var write = function () {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          format: state.format,
          tone: state.tone,
          seed: state.seed,
          form: readForm(),
          draft: state.draft ? {
            body: state.draft.body,
            titles: state.draft.titles,
            firstComment: state.draft.firstComment,
            format: state.draft.format
          } : null,
          theme: document.documentElement.getAttribute('data-theme'),
          v: 1
        }));
        var now = new Date();
        $('#save-state').textContent = '저장됨 ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
      } catch (e) {
        $('#save-state').textContent = '저장할 수 없습니다';
      }
    };
    if (immediate) write();
    else state.saveTimer = setTimeout(write, 500);
  }
  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }

  /* ── 공통 UI ──────────────────────────────────────────── */
  function toast(message) {
    var root = $('#toast-root');
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    root.appendChild(el);
    while (root.children.length > 2) root.removeChild(root.firstElementChild);
    setTimeout(function () { el.remove(); }, 2600);
  }

  function copyText(text, btn, label) {
    var done = function (ok) {
      if (!ok) { toast('복사하지 못했습니다. 직접 선택해 복사해 주세요.'); return; }
      toast(label || '복사했습니다.');
      if (btn) {
        var original = btn.textContent;
        btn.textContent = '복사됨';
        btn.classList.add('is-done');
        setTimeout(function () { btn.textContent = original; btn.classList.remove('is-done'); }, 1400);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    } else {
      done(fallbackCopy(text));
    }
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    toast(name + ' 저장했습니다.');
  }

  function switchTab(name) {
    state.tab = name;
    $$('.tab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.view').forEach(function (v) {
      var on = v.id === 'view-' + name;
      v.classList.toggle('is-active', on);
      if (on) v.removeAttribute('hidden'); else v.setAttribute('hidden', '');
    });
    if (name === 'bridge') buildBridge();
    if (name === 'pro') renderProStatus();
  }

  /* ── 폼 ───────────────────────────────────────────────── */
  function readForm() {
    return {
      topic: ($('#f-topic') || {}).value || '',
      target: ($('#f-target') || {}).value || '',
      keyword: ($('#f-keyword') || {}).value || '',
      experience: ($('#f-experience') || {}).value || '',
      product: ($('#f-product') || {}).value || '',
      price: ($('#f-price') || {}).value || ''
    };
  }
  function writeForm(form) {
    if (!form) return;
    if (form.topic !== undefined) $('#f-topic').value = form.topic;
    if (form.target !== undefined) $('#f-target').value = form.target;
    if (form.keyword !== undefined) $('#f-keyword').value = form.keyword;
    if (form.experience !== undefined) $('#f-experience').value = form.experience;
    if (form.product !== undefined) $('#f-product').value = form.product;
    if (form.price !== undefined) $('#f-price').value = form.price;
    updateExpCount();
  }
  function currentInput() {
    var f = readForm();
    return {
      format: state.format,
      tone: state.tone,
      seed: state.seed,
      topic: f.topic,
      target: f.target,
      keyword: f.keyword,
      experience: f.experience,
      product: f.product,
      price: f.price
    };
  }
  function updateExpCount() {
    var v = $('#f-experience').value;
    var n = v.replace(/\s/g, '').length;
    var s = C.splitExperience(v).length;
    $('#exp-count').textContent = n + '자 · ' + s + '문장';
  }

  /* ── 포맷·말투·제공자 그리기 ──────────────────────────── */
  function renderFormats() {
    var host = $('#format-grid');
    host.innerHTML = D.FORMATS.map(function (f) {
      return '<label class="format-card' + (f.id === state.format ? ' is-active' : '') + '">' +
        '<input type="radio" name="format" value="' + f.id + '"' + (f.id === state.format ? ' checked' : '') + ' />' +
        '<span class="fc-no">' + f.no + '</span>' +
        '<span><strong>' + esc(f.label) + '</strong><em>' + esc(f.tagline) + '</em></span>' +
        '</label>';
    }).join('');
    $$('input[name=format]', host).forEach(function (r) {
      r.addEventListener('change', function () {
        state.format = r.value;
        state.seed = 0;
        $$('.format-card', host).forEach(function (c) {
          c.classList.toggle('is-active', c.querySelector('input').checked);
        });
        applyFormatUI();
        if (state.draft && state.draft.format !== state.format) {
          resetDraft();
          toast('포맷을 바꿨습니다. 다시 조립하면 새 구조로 나옵니다.');
        }
        saveStore();
      });
    });
  }

  function renderTones() {
    var host = $('#tone-grid');
    host.innerHTML = D.TONES.map(function (t) {
      return '<label class="tone-card' + (t.id === state.tone ? ' is-active' : '') + '">' +
        '<input type="radio" name="tone" value="' + t.id + '"' + (t.id === state.tone ? ' checked' : '') + ' />' +
        '<span class="tn">' + esc(t.label) + '</span>' +
        '<span class="td">' + esc(t.desc) + '</span>' +
        '<span class="ts">' + esc(t.sample) + '</span>' +
        '</label>';
    }).join('');
    $$('input[name=tone]', host).forEach(function (r) {
      r.addEventListener('change', function () {
        state.tone = r.value;
        $$('.tone-card', host).forEach(function (c) {
          c.classList.toggle('is-active', c.querySelector('input').checked);
        });
        saveStore();
      });
    });
  }

  function applyFormatUI() {
    var isThread = state.format === 'thread';
    $('#product-step').hidden = state.format !== 'sales';
    $('#editor-kicker').textContent = isThread ? '타래 본문' : (state.format === 'sales' ? '상세페이지 카피' : '본문');
    $('#titles-note').textContent = state.format === 'sales' ? '헤드라인 28~42자 권장' : '28~42자 권장';
    $('#titles-title').textContent = state.format === 'sales' ? '헤드라인 5안' : '제목 5안';
    $('#draft-kicker').textContent = isThread ? 'THREAD' : (state.format === 'sales' ? 'SALES COPY' : 'BLOG DRAFT');
    if (isThread) $('#draft-meta').innerHTML = '첫 줄은 250자 제한입니다. 캡처 1장과 첫 댓글까지 같이 나옵니다.';
  }

  function renderProviders() {
    var host = $('#provider-list');
    var saved = Pro.getState();
    host.innerHTML = Pro.providers().map(function (p) {
      var active = (state.provider || (saved.connected ? saved.provider : 'openai')) === p.id;
      var sub = p.id === 'custom' ? '커스텀 프록시 · 직접 운영' : p.brand;
      return '<label class="provider' + (active ? ' is-active' : '') + '">' +
        '<input type="radio" name="provider" value="' + p.id + '"' + (active ? ' checked' : '') + ' />' +
        '<span class="pno">' + p.rank + '</span>' +
        '<span><strong>' + esc(p.name) + '</strong><em>' + esc(sub) + '</em></span>' +
        '<span class="pbadge">' + esc(p.id === 'custom' ? '직접 운영' : p.tag) + '</span>' +
        '</label>';
    }).join('');
    $$('input[name=provider]', host).forEach(function (r) {
      r.addEventListener('change', function () { selectProvider(r.value); });
    });
  }

  function selectProvider(id) {
    var p = Pro.providerById(id);
    if (!p) return;
    state.provider = p.id;
    $('#pro-key').value = '';
    var model = Pro.defaultModel(p.id, 'text');
    $('#pro-model').value = model;
    $('#server-row').hidden = p.id !== 'custom';
    $('#key-label').textContent = p.id === 'custom' ? '프록시 인증 토큰 (선택)' : p.keyLabel;
    $('#pro-hint').textContent = p.id === 'custom'
      ? '프록시는 task·prompt·system·model을 받아 text 또는 choices/content로 돌려주면 됩니다. 주소는 http(s)로 시작해야 합니다.'
      : p.keyNote + ' 모델 이름은 직접 확인해 바꿀 수 있습니다.';
    var dl = $('#model-options');
    if (dl) {
      dl.innerHTML = (p.models.text || []).map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(m.id + ' — ' + m.note) + '</option>';
      }).join('');
    }
    $$('.provider').forEach(function (c) {
      var input = c.querySelector('input');
      c.classList.toggle('is-active', input && input.value === p.id);
    });
    renderProStatus();
    saveStore();
  }

  /* ── 원고 조립 ────────────────────────────────────────── */
  function resetDraft() {
    state.draft = null;
    state.report = null;
    $('#result-body').hidden = true;
    $('#result-empty').hidden = false;
    $('#score-box').hidden = true;
    $('#draft-title').textContent = '아직 원고가 없습니다';
    $('#btn-assemble').textContent = '무료로 초안 조립';
    $('#top-primary-label').textContent = '초안 조립';
    applyFormatUI();
  }

  function assemble() {
    var input = currentInput();
    if (!input.topic.trim()) {
      toast('주제를 먼저 적어 주세요.');
      $('#f-topic').focus();
      return;
    }
    var draft = C.buildDraft(input);
    state.draft = draft;
    renderDraft();
    saveStore(true);
    toast(draft.usedExperience ? '초안을 조립했습니다. 경험 ' + draft.usedExperience + '곳 반영.' : '초안을 조립했습니다. 경험 메모를 넣으면 더 구체해집니다.');
  }

  function renderDraft() {
    var d = state.draft;
    if (!d) return;
    $('#result-empty').hidden = true;
    $('#result-body').hidden = false;
    $('#score-box').hidden = false;
    $('#btn-assemble').textContent = '다시 조립';
    $('#top-primary-label').textContent = '본문 복사';
    $('#draft-title').textContent = d.input.topic;
    $('#draft-meta').innerHTML = fmtLabel(d.format) + ' · ' + toneLabel(d.input.tone) + ' · 경험 ' + d.usedExperience + '곳 반영';

    var isThread = d.format === 'thread';
    $('#titles-wrap').hidden = isThread || !d.titles.length;
    renderTitles(d.titles);
    $('#draft-editor').value = d.body;
    autosizeEditor();
    $('#thread-extras').hidden = !isThread;
    if (isThread) {
      $('#first-comment').value = d.firstComment || '';
      updateHook();
    }
    renderOutline(d);
    runScore();
  }

  function fmtLabel(id) {
    var f = D.FORMATS.filter(function (x) { return x.id === id; })[0];
    return f ? f.label : id;
  }
  function toneLabel(id) {
    var t = D.TONES.filter(function (x) { return x.id === id; })[0];
    return t ? t.label : id;
  }

  function renderTitles(titles) {
    var host = $('#titles-list');
    host.innerHTML = (titles || []).map(function (t, i) {
      var len = t.length;
      var cls = len >= 28 && len <= 42 ? 'is-good' : (len > 42 ? 'is-long' : '');
      return '<div class="title-card">' +
        '<span class="tno">' + (i + 1) + '</span>' +
        '<div class="tmain"><span class="tt">' + esc(t) + '</span>' +
        '<span class="tmeta"><span class="tlen ' + cls + '">' + len + '자</span>' +
        '<button type="button" class="link-btn" data-title-copy="' + i + '">복사</button></span></div>' +
        '</div>';
    }).join('');
    $$('[data-title-copy]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var idx = Number(b.getAttribute('data-title-copy'));
        copyText(titles[idx], b, '제목을 복사했습니다.');
      });
    });
  }

  function renderOutline(d) {
    var host = $('#outline-list');
    var photos = $('#photo-list');
    var outline = d.outline || [];
    if (d.format === 'thread') {
      host.innerHTML = outline.map(function (o, i) {
        return '<li><span class="oi">' + (i + 1) + '</span><span>' + esc(o.label) + '</span></li>';
      }).join('');
      $('#outline-meta').textContent = outline.length + '개 블록';
    } else {
      host.innerHTML = outline.map(function (o, i) {
        return '<li><span class="oi">' + (i + 1) + '</span><span>' + esc(o.label) + '</span></li>';
      }).join('');
      $('#outline-meta').textContent = outline.length + '개 소제목 · 사진 ' + (d.photos || []).length + '곳';
    }
    photos.innerHTML = (d.photos || []).map(function (p, i) {
      return '<li>' + esc(p) + '</li>';
    }).join('');
    if (d.format === 'thread') {
      photos.innerHTML = '<li>' + esc(d.photos[0]) + '</li>';
    }
    updateRemaining();
  }

  function updateHook() {
    var text = $('#draft-editor').value || '';
    var hook = text.split(/\n{2,}/)[0] || '';
    var len = hook.length;
    $('#hook-text').textContent = hook || '—';
    var num = $('#hook-count');
    num.textContent = len + '자 / 250자';
    num.classList.toggle('is-over', len > 250);
    num.classList.toggle('is-good', len > 0 && len <= 250);
  }

  function updateRemaining() {
    var d = state.draft;
    if (!d) return;
    var chars = C.countChars($('#draft-editor').value);
    var f = D.FORMATS.filter(function (x) { return x.id === d.format; })[0] || D.FORMATS[0];
    var note = $('#remaining-note');
    if (d.format === 'thread') {
      note.textContent = '훅 250자 · 타래 3개 이상 · 본문 링크 0건이 기준입니다. 지금 ' + chars + '자.';
    } else if (d.format === 'blog') {
      var left = Math.max(0, f.target - chars);
      note.textContent = left > 0
        ? '완성 목표(' + f.target + '자)까지 ' + left + '자 남았습니다. 경험 메모를 한 줄 더 넣거나 Pro·구독 AI로 채우세요.'
        : '목표 ' + f.target + '자를 채웠습니다. 지금 ' + chars + '자.';
    } else {
      note.textContent = '상세페이지는 ' + f.target + '자 안팎이 읽기 좋습니다. 지금 ' + chars + '자.';
    }
  }

  /* ── 점검 ─────────────────────────────────────────────── */
  function runScore() {
    if (!state.draft) return;
    var text = $('#draft-editor').value;
    state.draft.body = text;
    var report = C.scoreDraft(text, currentInput());
    state.report = report;
    renderScore(report);
  }

  function renderScore(r) {
    var f = D.FORMATS.filter(function (x) { return x.id === state.draft.format; })[0] || D.FORMATS[0];
    $('#score-num').innerHTML = r.score + '<span>/100</span>';
    var g = $('#score-grade');
    g.textContent = r.grade.id;
    g.setAttribute('data-g', r.grade.id);
    $('#score-label').textContent = r.grade.label;
    $('#char-line').textContent = r.chars.toLocaleString('ko-KR') + '자 / 목표 ' + f.target.toLocaleString('ko-KR') + '자';
    var meter = $('#score-meter');
    meter.style.width = r.score + '%';
    meter.parentNode.setAttribute('title', '점수 ' + r.score + ' / 100');

    var list = $('#issue-list');
    list.innerHTML = (r.items || []).map(function (it) {
      var lv = it.id === 'legal' || it.id === 'privacy' ? 'high' : (it.penalty >= 6 ? 'mid' : 'low');
      var samples = (it.samples || []).slice(0, 4).map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('');
      return '<li class="issue" data-lv="' + lv + '">' +
        '<span class="bar" aria-hidden="true"></span>' +
        '<div class="ib"><strong>' + esc(it.label) + ' · ' + it.count + '건</strong>' +
        '<p>' + esc(it.detail) + '</p>' +
        (samples ? '<div class="samples">' + samples + '</div>' : '') +
        '</div>' +
        '<span class="ip">−' + it.penalty + '</span></li>';
    }).join('');
    $('#issue-empty').hidden = (r.items || []).length > 0;
    var chips = (r.positives || []).map(function (p) {
      return '<span>' + esc(p) + '</span>';
    });
    if (r.psych && typeof r.psych.total === 'number' && r.psych.total >= 20) {
      var label;
      if (r.psych.total >= 60 && r.psych.strengths && r.psych.strengths[0]) {
        label = '전환 심리 ' + r.psych.total + '점 · 강점 ' + r.psych.strengths[0].name;
      } else if (r.psych.gaps && r.psych.gaps[0]) {
        label = '전환 심리 ' + r.psych.total + '점 · 보완 ' + r.psych.gaps[0].name;
      } else {
        label = '전환 심리 ' + r.psych.total + '점';
      }
      chips.unshift('<span class="psych">' + esc(label) + '</span>');
    }
    $('#positive-list').innerHTML = chips.join('');
    $('#quality-meta').textContent = (r.items || []).length
      ? (r.items.length + '개 항목 · −' + Math.round(100 - r.score) + '점')
      : '걸리는 항목 없음';
    updateHook();
    updateRemaining();
  }

  /* ── Pro ──────────────────────────────────────────────── */
  function buildProConfig() {
    var sel = $('input[name=provider]:checked');
    var pid = sel ? sel.value : 'openai';
    var key = $('#pro-key').value.trim();
    var model = $('#pro-model').value.trim() || Pro.defaultModel(pid, 'text');
    return {
      provider: pid,
      apiKey: pid === 'custom' ? '' : key,
      bearerToken: pid === 'custom' ? key : '',
      endpointUrl: pid === 'custom' ? $('#pro-server').value.trim() : '',
      models: { text: model },
      remember: false
    };
  }

  function proReadiness() {
    var cfg = buildProConfig();
    var p = Pro.providerById(cfg.provider);
    if (!p) return { ok: false, name: '—', reason: '제공자를 고르세요.' };
    if (p.id === 'custom') {
      var okUrl = /^https?:\/\/[^\s]+$/i.test(cfg.endpointUrl);
      return { ok: okUrl, name: p.name, cfg: cfg, reason: '4번 자체 서버 주소를 입력하세요. http(s)로 시작해야 합니다.' };
    }
    var key = cfg.apiKey;
    if (!key) {
      var st = Pro.getState();
      if (st.connected && st.provider === p.id) return { ok: true, saved: true, name: p.name, cfg: cfg };
      return { ok: false, name: p.name, cfg: cfg, reason: p.name + ' API 키를 입력하세요. 키는 이 탭 메모리에만 남습니다.' };
    }
    if (/^bearer\s/i.test(key)) return { ok: false, name: p.name, cfg: cfg, reason: '“Bearer”를 빼고 키 값만 붙여넣으세요.' };
    if (key.length < 8) return { ok: false, name: p.name, cfg: cfg, reason: '키가 너무 짧습니다. 전체 키를 붙여넣었는지 확인하세요.' };
    if (/\s/.test(key)) return { ok: false, name: p.name, cfg: cfg, reason: '키에 공백이 있습니다. 한 번에 복사해 붙여넣어 주세요.' };
    return { ok: true, name: p.name, cfg: cfg };
  }

  function renderProStatus() {
    var st = Pro.getState();
    var cfg = buildProConfig();
    var p = Pro.providerById(cfg.provider) || Pro.providers()[0];
    var ready = proReadiness();
    var savedSame = st.connected && st.provider === p.id;
    var keyShown = cfg.apiKey
      ? Pro.maskKey(cfg.apiKey)
      : (cfg.bearerToken ? Pro.maskKey(cfg.bearerToken) : (savedSame ? st.keyMasked : '없음'));

    $('#pd-provider').textContent = p.name;
    $('#pd-model').textContent = cfg.models.text || '—';
    $('#pd-key').textContent = keyShown || '없음';
    var endpoint = '—';
    try {
      var plan = Pro.buildRequest(p.id, 'text', { prompt: 'x' }, cfg);
      if (plan && plan.url) endpoint = plan.url.replace(/\?.*$/, '');
    } catch (e) { endpoint = '—'; }
    $('#pd-endpoint').textContent = endpoint.length > 52 ? endpoint.slice(0, 52) + '…' : endpoint;
    $('#pd-ready').textContent = ready.ok ? (savedSame ? '연결됨' : '저장하면 연결') : '무료 모드';
    $('#pd-note').textContent = p.id === 'custom'
      ? '자체 서버는 주소만 있으면 됩니다. 토큰은 선택입니다.'
      : p.keyNote;
    var dot = $('.pro-dot');
    if (dot) dot.style.opacity = st.connected ? '1' : '.25';
  }

  function setStatus(message, kind) {
    var el = $('#pro-status');
    el.textContent = message;
    el.className = 'status' + (kind ? ' is-' + kind : '');
  }

  function setBusy(on) {
    state.busy = on;
    ['#btn-pro-generate', '#btn-pro-polish-now', '#btn-pro-polish', '#btn-assemble'].forEach(function (s) {
      var el = $(s);
      if (el) el.disabled = on;
    });
  }

  function runPro(kind) {
    if (state.busy) return;
    var ready = proReadiness();
    if (!ready.ok) {
      setStatus(ready.reason, 'error');
      switchTab('pro');
      return;
    }
    if (!state.draft || !$('#draft-editor').value.trim()) {
      if (!$('#f-topic').value.trim()) {
        toast('주제를 먼저 적어 주세요.');
        switchTab('write');
        $('#f-topic').focus();
        return;
      }
      if (!state.draft) assemble();
    }
    var cfg = ready.cfg;
    var saved = Pro.saveConfig(cfg);
    if (!saved.ok) {
      setStatus(saved.errors[0] || '연결 정보를 저장하지 못했습니다.', 'error');
      return;
    }
    if (saved.warning) setStatus(saved.warning, 'busy');

    var payload = kind === 'polish'
      ? C.buildPolishPrompt($('#draft-editor').value, currentInput())
      : C.buildPrompt(currentInput(), state.draft);

    setBusy(true);
    setStatus(ready.name + '에 요청 중… (보통 10~40초)', 'busy');

    Pro.generate({
      task: 'text',
      prompt: payload.prompt,
      system: payload.system,
      options: { temperature: Number($('#pro-temp').value) }
    }, { config: cfg, timeoutMs: 120000 }).then(function (res) {
      setBusy(false);
      renderProStatus();
      if (!res || !res.ok) {
        var msg = (res && res.message) ? res.message : '요청이 실패했습니다.';
        if (res && res.reason === 'not_connected') msg = '키가 비어 있습니다. ' + msg;
        setStatus(msg, 'error');
        toast('요청이 실패했습니다. 상태 문구를 확인하세요.');
        return;
      }
      var text = C.parseProOutput(res.text || '');
      if (!text) {
        setStatus('응답은 왔지만 글이 비어 있습니다. 모델 이름을 확인해 보세요.', 'error');
        return;
      }
      $('#draft-editor').value = text;
      autosizeEditor();
      if (state.draft.format === 'thread') updateHook();
      runScore();
      saveStore(true);
      var chars = C.countChars(text);
      var bits = [];
      bits.push(kind === 'polish' ? '다듬은 원고를 편집기에 넣었습니다.' : '완성 원고를 편집기에 넣었습니다.');
      bits.push(chars.toLocaleString('ko-KR') + '자');
      bits.push('점검 ' + state.report.score + '점');
      if (res.model) bits.push(res.model);
      if (res.latencyMs) bits.push(Math.round(res.latencyMs / 1000) + '초');
      setStatus(bits.join(' · '), 'ok');
      toast(kind === 'polish' ? 'AI 티를 다듬었습니다.' : 'Pro 원고를 받았습니다.');
      switchTab('write');
    });
  }

  /* ── 브리지 ───────────────────────────────────────────── */
  function buildBridge() {
    var prompt = C.buildPrompt(currentInput(), state.draft);
    $('#bridge-prompt').value = prompt.prompt;
    var f = fmtLabel(state.format);
    var input = C.normalizeInput(currentInput());
    $('#bridge-context').textContent = f + ' · ' + toneLabel(state.tone) + ' · 경험 ' + input.experience.length + '문장'
      + (state.draft ? ' · 현재 초안 ' + C.countChars(state.draft.body) + '자' : ' · 초안 없음(구조만 전달)');
  }

  function openAI(which) {
    var urls = {
      chatgpt: 'https://chatgpt.com/',
      claude: 'https://claude.ai/new',
      gemini: 'https://gemini.google.com/app'
    };
    var url = urls[which];
    if (!url) return;
    window.open(url, '_blank', 'noopener');
    toast('새 탭에서 열었습니다. 프롬프트를 붙여넣으세요.');
  }

  /* ── 초기화 ───────────────────────────────────────────── */
  function init() {
    state.provider = Pro.getState().provider || 'openai';

    var store = loadStore();
    if (store) {
      state.format = store.format || 'blog';
      state.tone = store.tone || 'talk';
      state.seed = store.seed || 0;
      if (store.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      writeForm(store.form);
      if (store.draft && store.draft.body) {
        if (store.draft.format) state.format = store.draft.format;
        state.draft = {
          format: store.draft.format || state.format,
          body: store.draft.body,
          titles: store.draft.titles || [],
          firstComment: store.draft.firstComment || '',
          photos: [],
          outline: [],
          input: C.normalizeInput(currentInput()),
          usedExperience: C.splitExperience(($('#f-experience') || {}).value || '').length
        };
        // 저장된 본문에서 구조·사진 안내를 다시 계산한다.
        if (!store.titles && state.format !== 'thread') {
          state.draft.titles = C.buildTitles(state.draft.input);
        }
        var rebuilt = C.buildDraft(currentInput());
        state.draft.photos = rebuilt.photos;
        state.draft.outline = state.draft.format === 'thread'
          ? state.draft.body.split(/\n{2,}/).map(function (b, i, a) {
            return { label: i === 0 ? '훅 (250자)' : (i === a.length - 1 ? '마무리' : (i + 1) + '부'), text: b };
          })
          : (rebuilt.format === state.draft.format ? rebuilt.outline : []);
      }
    }

    renderFormats();
    renderTones();
    renderProviders();
    applyFormatUI();
    $('#pro-model').value = Pro.defaultModel(state.provider, 'text');
    $('#pro-server').value = '';
    $('#pro-temp').value = '0.7';
    $('#pro-key').value = '';
    selectProvider(state.provider);

    if (state.draft) renderDraft();

    /* 탭 */
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
    });
    $$('[data-tab-link]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        switchTab(a.getAttribute('data-tab-link'));
      });
    });

    /* 테마 */
    $('#btn-theme').addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      $('#btn-theme').setAttribute('aria-label', next === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
      saveStore(true);
    });

    /* 입력 */
    ['#f-topic', '#f-target', '#f-keyword', '#f-product', '#f-price'].forEach(function (s) {
      $(s).addEventListener('input', function () { saveStore(); });
    });
    $('#f-experience').addEventListener('input', function () { updateExpCount(); saveStore(); });
    $('#btn-clear-exp').addEventListener('click', function () {
      $('#f-experience').value = '';
      updateExpCount();
      saveStore();
    });
    $('#btn-sample').addEventListener('click', function () {
      var s = D.SAMPLES[state.format] || D.SAMPLES.blog;
      $('#f-topic').value = s.topic;
      $('#f-target').value = s.target;
      $('#f-keyword').value = s.keyword || '';
      $('#f-experience').value = s.experience || '';
      if (s.product) $('#f-product').value = s.product;
      if (s.price) $('#f-price').value = s.price;
      updateExpCount();
      saveStore(true);
      toast('예시를 채웠습니다. 그대로 조립해 보세요.');
    });

    $('#write-form').addEventListener('submit', function (e) {
      e.preventDefault();
      assemble();
    });
    $('#btn-pro-write').addEventListener('click', function () {
      var ready = proReadiness();
      if (!ready.ok) {
        switchTab('pro');
        setStatus('키를 넣고 제공자를 고르면 여기서 바로 원고를 받습니다.', 'busy');
        $('#pro-key').focus();
        return;
      }
      runPro('draft');
    });
    $('#btn-bridge-write').addEventListener('click', function () {
      buildBridge();
      switchTab('bridge');
      toast('프롬프트를 만들었습니다. 복사해서 붙여넣으세요.');
    });

    /* 편집기 */
    $('#draft-editor').addEventListener('input', function () {
      if (!state.draft) return;
      autosizeEditor();
      clearTimeout(state.scoreTimer);
      state.scoreTimer = setTimeout(function () { runScore(); saveStore(); }, 320);
    });
    window.addEventListener('resize', autosizeEditor);
    $('#btn-variant').addEventListener('click', function () {
      if (!state.draft) return;
      state.seed += 1;
      var d = C.buildDraft(currentInput());
      state.draft = d;
      renderDraft();
      saveStore(true);
      toast('같은 조건으로 다른 구성을 만들었습니다.');
    });
    $('#btn-polish').addEventListener('click', function () {
      if (!state.draft) return;
      var res = C.localPolish($('#draft-editor').value);
      if (!res.changed) { toast('규칙으로 바꿀 표현이 없습니다.'); return; }
      $('#draft-editor').value = res.text;
      autosizeEditor();
      runScore();
      saveStore(true);
      toast('규칙으로 ' + res.applied.length + '가지를 다듬었습니다. ' + res.before + '→' + res.after + '점.');
    });

    /* 복사·내보내기 */
    $('#btn-copy').addEventListener('click', function () {
      copyText($('#draft-editor').value, this, '본문을 복사했습니다.');
    });
    $('#top-primary').addEventListener('click', function () {
      if (!state.draft) { assemble(); return; }
      var d = currentDraft();
      copyText(C.toText(d), $('#top-primary'), '원고를 복사했습니다.');
    });
    $('#btn-md').addEventListener('click', function () {
      var d = currentDraft();
      download(C.fileName(d, 'md'), C.toMarkdown(d), 'text/markdown;charset=utf-8');
    });
    $('#btn-html').addEventListener('click', function () {
      var d = currentDraft();
      download(C.fileName(d, 'html'), '<!DOCTYPE html>\n<meta charset="utf-8">\n' + C.toHtml(d), 'text/html;charset=utf-8');
    });
    $('#btn-txt').addEventListener('click', function () {
      var d = currentDraft();
      download(C.fileName(d, 'txt'), C.toText(d), 'text/plain;charset=utf-8');
    });
    $('#btn-copy-md').addEventListener('click', function () {
      copyText(C.toMarkdown(currentDraft()), this, 'Markdown으로 복사했습니다.');
    });
    $('#btn-copy-html').addEventListener('click', function () {
      copyText(C.toHtml(currentDraft()), this, 'HTML로 복사했습니다.');
    });
    $('#btn-copy-txt').addEventListener('click', function () {
      copyText(C.toText(currentDraft()), this, '텍스트로 복사했습니다.');
    });
    $('#btn-copy-comment').addEventListener('click', function () {
      copyText($('#first-comment').value, this, '첫 댓글을 복사했습니다.');
    });
    $('#first-comment').addEventListener('input', function () {
      if (state.draft) state.draft.firstComment = $('#first-comment').value;
      saveStore();
    });

    /* 브리지 */
    $('#btn-bridge-build').addEventListener('click', function () { buildBridge(); toast('지금 입력으로 다시 만들었습니다.'); });
    $('#btn-bridge-copy').addEventListener('click', function () {
      copyText($('#bridge-prompt').value, this, '프롬프트를 복사했습니다.');
    });
    $$('[data-open-ai]').forEach(function (b) {
      b.addEventListener('click', function () { openAI(b.getAttribute('data-open-ai')); });
    });
    $('#btn-ai-import').addEventListener('click', function () {
      var raw = $('#ai-paste').value;
      if (!raw.trim()) { toast('붙여넣은 원고가 없습니다.'); return; }
      if (!state.draft) {
        if (!$('#f-topic').value.trim()) { toast('주제를 먼저 적어 주세요.'); switchTab('write'); return; }
        assemble();
      }
      var text = C.parseProOutput(raw);
      $('#draft-editor').value = text;
      autosizeEditor();
      runScore();
      saveStore(true);
      switchTab('write');
      toast('가져왔습니다. 점검을 다시 계산했습니다.');
    });

    /* Pro */
    $('#pro-key').addEventListener('input', function () { renderProStatus(); });
    $('#pro-model').addEventListener('input', function () { renderProStatus(); });
    $('#pro-server').addEventListener('input', function () { renderProStatus(); });
    $('#pro-temp').addEventListener('change', function () { renderProStatus(); });
    $('#btn-pro-generate').addEventListener('click', function () { runPro('draft'); });
    $('#btn-pro-polish-now').addEventListener('click', function () { runPro('polish'); });
    $('#btn-pro-polish').addEventListener('click', function () {
      var ready = proReadiness();
      if (!ready.ok) {
        switchTab('pro');
        setStatus('다듬기는 Pro 연결이 필요합니다. 무료라면 편집기의 AI 티 다듬기를 쓰세요.', 'busy');
        return;
      }
      runPro('polish');
    });
    $('#btn-pro-clear').addEventListener('click', function () {
      Pro.clearConfig();
      $('#pro-key').value = '';
      $('#pro-server').value = '';
      $('#pro-model').value = Pro.defaultModel(state.provider, 'text');
      renderProStatus();
      setStatus('연결 정보를 지웠습니다. 무료 모드로 동작합니다.', 'ok');
      toast('연결 정보를 지웠습니다.');
    });
    $('#btn-key-page').addEventListener('click', function () {
      var sel = $('input[name=provider]:checked');
      var p = Pro.providerById(sel ? sel.value : 'openai');
      if (!p.keyUrl) { toast('자체 서버는 키 발급 페이지가 없습니다.'); return; }
      window.open(p.keyUrl, '_blank', 'noopener');
    });

    updateExpCount();
    renderProStatus();
    saveStore(true);
  }

  function currentDraft() {
    var d = state.draft || { body: '', titles: [], firstComment: '', format: state.format, input: C.normalizeInput(currentInput()) };
    return {
      format: d.format || state.format,
      body: $('#draft-editor') ? $('#draft-editor').value : d.body,
      titles: d.titles || [],
      firstComment: $('#first-comment') ? $('#first-comment').value : (d.firstComment || ''),
      input: C.normalizeInput(currentInput())
    };
  }

  function autosizeEditor() {
    var el = $('#draft-editor');
    if (!el) return;
    el.style.height = 'auto';
    var h = Math.max(el.scrollHeight, window.innerWidth <= 720 ? 320 : 420);
    el.style.height = h + 'px';
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

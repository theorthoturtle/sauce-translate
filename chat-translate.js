/*
 * Chat Translate — Sauce for Zwift mod
 * Runs in every Sauce window but only does anything in the Chat window.
 * Replaces each chat message that is not in your chosen language with its translation,
 * marked with a flag + language badge. Click a translated message to toggle the original.
 * Rider names are never translated; right-click any word to never translate it.
 */
(function() {
    'use strict';
    if (!/\/chat(\.___.+___)?\.html$/.test(location.pathname)) {
        return;
    }

    const STORE_KEY = 's4z-chat-translate-v1';
    const LANGS = [
        ['off', 'Off'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
        ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['da', 'Danish'],
        ['sv', 'Swedish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['pl', 'Polish'],
        ['cs', 'Czech'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'],
        ['el', 'Greek'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh-CN', 'Chinese'],
        ['ar', 'Arabic'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['id', 'Indonesian'],
    ];
    const CHUNK_SEL = '.entry .message > .chunk';
    const HAS_WORD = /\p{L}{2,}/u;
    const lc = s => s.toLowerCase();

    // ---------- Settings (shared by all Chat windows) ----------
    function loadPrefs() {
        let p = {};
        try { p = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e) {/* ignore */}
        if (!p.target) {
            const nav = (navigator.language || 'en').split('-')[0];
            p.target = LANGS.some(([c]) => c === nav) ? nav : 'en';
        }
        p.keep = Array.isArray(p.keep) ? p.keep : [];
        return p;
    }
    const prefs = loadPrefs();
    let keptSet = new Set(prefs.keep.map(lc));   // words you chose to never translate (lowercase)

    function savePrefs() {
        keptSet = new Set(prefs.keep.map(lc));
        try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch(e) {/* ignore */}
    }

    // ---------- Translation providers ----------
    const CACHE_MAX = 500;
    const MAX_PARALLEL = 4;          // never fire more than this many requests at once
    const cache = new Map();         // key -> Promise<{text, source}>, most recently used last
    let googleBlockedUntil = 0;
    let active = 0;
    const waiting = [];

    async function limited(fn) {
        if (active >= MAX_PARALLEL) {
            await new Promise(resolve => waiting.push(resolve));
        }
        active++;
        try {
            return await fn();
        } finally {
            active--;
            if (waiting.length) {
                waiting.shift()();
            }
        }
    }

    async function viaGoogle(text, target) {
        const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto' +
            `&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(text)}`);
        if (!r.ok) {
            throw new Error(`google ${r.status}`);
        }
        const data = await r.json();
        return {
            text: (data[0] || []).map(x => x && x[0]).filter(Boolean).join(''),
            source: lc(data[2] || ''),
        };
    }

    const entityBox = document.createElement('textarea');
    const decodeEntities = s => {
        if (!s.includes('&')) {
            return s;
        }
        entityBox.innerHTML = s;
        return entityBox.value;
    };

    async function viaMyMemory(text, target) {
        const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) +
            `&langpair=autodetect|${encodeURIComponent(target)}`);
        if (!r.ok) {
            throw new Error(`mymemory ${r.status}`);
        }
        const data = await r.json();
        if (String(data.responseStatus) !== '200') {
            throw new Error(`mymemory ${data.responseDetails || data.responseStatus}`);
        }
        return {
            text: decodeEntities(data.responseData.translatedText),
            source: lc(data.responseData.detectedLanguage || ''),
        };
    }

    function translate(text, target) {
        const key = target + '\u0000' + text;
        const hit = cache.get(key);
        if (hit) {
            cache.delete(key);          // keep recently used entries
            cache.set(key, hit);
            return hit;
        }
        const p = limited(async () => {
            if (Date.now() > googleBlockedUntil) {
                try {
                    return await viaGoogle(text, target);
                } catch(e) {
                    console.warn('Chat Translate: Google failed, falling back', e);
                    googleBlockedUntil = Date.now() + 5 * 60 * 1000;
                }
            }
            return viaMyMemory(text, target);
        });
        cache.set(key, p);
        p.catch(() => cache.delete(key));
        if (cache.size > CACHE_MAX) {
            cache.delete(cache.keys().next().value);
        }
        return p;
    }

    // ---------- Rider names: never translate them ----------
    // Names come from chat senders and Sauce's list of nearby riders. Before translating, each
    // name in a message is swapped for a placeholder and put back afterwards, so names like
    // "Sereena" or "Jonnie" are never translated and don't confuse language detection.
    const ALWAYS_KEEP = ['Sereena', 'Jonnie'];   // kept even when that rider isn't nearby or chatting
    const NAMES_MAX = 3000;                      // most recently seen names are kept
    const knownNames = new Set();                // lowercase single words
    const NAME_WORD = /^\p{L}[\p{L}'’]*$/u;
    const TRIM_QUOTES = /^['’]+|['’]+$/g;

    function addName(name) {
        for (const raw of String(name || '').split(/[\s.,;:/|()[\]{}<>_+=*#@!?"-]+/)) {
            const w = raw.replace(TRIM_QUOTES, '');
            if (w.length >= 3 && NAME_WORD.test(w)) {
                const k = lc(w);
                knownNames.delete(k);            // re-insert = mark as recently seen
                knownNames.add(k);
            }
        }
        while (knownNames.size > NAMES_MAX) {
            knownNames.delete(knownNames.values().next().value);
        }
    }
    ALWAYS_KEEP.forEach(addName);

    let nameTimer;
    async function refreshNearbyNames() {
        clearTimeout(nameTimer);
        nameTimer = setTimeout(refreshNearbyNames, 30000);
        if (document.hidden || prefs.target === 'off') {
            return;                                  // nothing to translate right now
        }
        try {
            const C = await getCommon();
            for (const x of await C.rpc.getNearbyData() || []) {
                const a = x && x.athlete;
                if (a) {
                    (a.sanitizedName || a.name || []).forEach(addName);
                }
            }
        } catch(e) {/* Sauce not ready yet */}
    }

    const isKeptName = w => keptSet.has(lc(w)) || ALWAYS_KEEP_LC.has(lc(w)) ||
        // Short names (3-4 letters) must be capitalised, so common words like "mar" or "sol"
        // in a Spanish message still get translated.
        (knownNames.has(lc(w)) && (w.length >= 5 || w[0] !== lc(w[0])));
    const ALWAYS_KEEP_LC = new Set(ALWAYS_KEEP.map(lc));
    const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
    const TOKEN = /ZQX(\d+)/g;

    // Returns {masked, names}: names replaced by tokens "ZQX0", "ZQX1", ...
    function maskNames(text) {
        const names = [];
        const masked = text.replace(WORD, word => {
            const w = word.replace(TRIM_QUOTES, '');
            let name = w && isKeptName(w) ? w : null;
            if (!name) {
                const head = w.split(/['’]/)[0];      // "Jonnie's" -> "Jonnie"
                name = head !== w && head && isKeptName(head) ? head : null;
            }
            if (!name) {
                return word;
            }
            names.push(name);
            return word.replace(name, `ZQX${names.length - 1}`);
        });
        return {masked, names};
    }

    // Translate with names protected. Falls back to translating the pieces between names
    // if the translator mangled a placeholder.
    async function translateKeepingNames(text, target) {
        const {masked, names} = maskNames(text);
        if (!names.length) {
            return translate(text, target);
        }
        if (!HAS_WORD.test(masked.replace(TOKEN, ' '))) {
            return null;   // only names (and punctuation / emoji): nothing to translate
        }
        const res = await translate(masked, target);
        const found = new Set([...res.text.matchAll(/ZQX\s?(\d+)/gi)].map(m => Number(m[1])));
        if (names.every((_, i) => found.has(i))) {
            return {...res, text: res.text.replace(/ZQX\s?(\d+)/gi, (m, i) => names[Number(i)] ?? m)};
        }
        let source = res.source;
        const out = await Promise.all(masked.split(/(ZQX\d+)/).map(async part => {
            const m = part.match(/^ZQX(\d+)$/);
            if (m) {
                return names[Number(m[1])];
            }
            if (!HAS_WORD.test(part)) {
                return part;
            }
            const r = await translate(part.trim(), target);
            source = source || r.source;
            return part.match(/^\s*/)[0] + r.text + part.match(/\s*$/)[0];
        }));
        return {text: out.join(''), source};
    }

    // ---------- Flags ----------
    // Languages spoken mainly in one country get that country's flag. Everything else (English,
    // Spanish, French, German, Portuguese, Arabic, Russian, Chinese...) uses the rider's own flag.
    const LANG_COUNTRY = {
        ja: 'jp', ko: 'kr', it: 'it', pl: 'pl', cs: 'cz', sk: 'sk', da: 'dk', sv: 'se', no: 'no',
        nb: 'no', nn: 'no', fi: 'fi', el: 'gr', tr: 'tr', uk: 'ua', he: 'il', iw: 'il', hu: 'hu',
        ro: 'ro', th: 'th', vi: 'vn', id: 'id', sl: 'si', hr: 'hr', lt: 'lt', lv: 'lv', et: 'ee',
        is: 'is', bg: 'bg', ka: 'ge', hy: 'am', fa: 'ir',
    };
    const athleteCountry = new Map();  // athleteId -> Promise<alpha2|null>
    let commonMod, flagData;

    // Sauce's own page module (same instance the Chat window uses) for RPC + flag data.
    const getCommon = () => (commonMod ||= import(new URL('src/common.mjs', location.href).href));

    function getFlagData() {
        return (flagData ||= getCommon().then(C => C.initNationFlags()).catch(e => {
            flagData = null;
            throw e;
        }));
    }

    function getRiderCountry(athleteId) {
        if (!athleteId) {
            return Promise.resolve(null);
        }
        if (!athleteCountry.has(athleteId)) {
            const p = (async () => {
                const C = await getCommon();
                // allowFetch: pull the Zwift profile if Sauce only has a partial record cached.
                let a = await C.rpc.getAthlete(athleteId, {allowFetch: true});
                if (a && a.countryCode == null) {
                    a = await C.rpc.getAthlete(athleteId, {refresh: true});
                }
                if (!a || a.countryCode == null) {
                    return null;
                }
                const m = ((await getFlagData()).flags[a.countryCode] || '').match(/([a-z]{2})\.png$/);
                return m ? m[1] : null;
            })();
            p.catch(() => athleteCountry.delete(athleteId));
            athleteCountry.set(athleteId, p.catch(() => null));
        }
        return athleteCountry.get(athleteId);
    }

    function flagFor(lang, chunk) {
        const country = LANG_COUNTRY[(lang || '').split('-')[0]];
        if (country) {
            return country;
        }
        const entry = chunk.closest('.entry');
        return getRiderCountry(entry && Number(entry.dataset.from));
    }

    function makeFlag(alpha2) {
        if (alpha2) {
            const img = document.createElement('img');
            img.className = 's4z-tr-flag';
            img.src = `deps/flags/${alpha2}.png`;
            img.alt = '';
            img.onerror = () => img.replaceWith(document.createTextNode('\u{1F310}'));
            return img;
        }
        const span = document.createElement('span');
        span.className = 's4z-tr-flag';
        span.textContent = '\u{1F310}';
        return span;
    }

    // ---------- Chat messages ----------
    const norm = s => lc(s).replace(/[\s\p{P}]+/gu, '');
    const sameLang = (a, b) => a && b && a.split('-')[0] === b.split('-')[0];

    function originalText(chunk) {
        return (chunk._s4zOrig ??= chunk.textContent.trim());
    }

    function restoreOriginal(chunk) {
        chunk._s4zTr = null;
        if (chunk.classList.contains('s4z-has-tr')) {
            chunk.classList.remove('s4z-translated', 's4z-has-tr');
            chunk.removeAttribute('title');
            chunk.textContent = chunk._s4zOrig;
        }
    }

    function renderChunk(chunk) {
        const st = chunk._s4zTr;
        const showingOriginal = !!chunk._s4zShowOriginal;
        const badge = document.createElement('span');
        badge.className = 's4z-tr-badge' + (showingOriginal ? ' original' : '');
        const code = document.createElement('span');
        code.className = 's4z-tr-code-btn';
        code.textContent = st.lang ? st.lang.split('-')[0].toUpperCase() : '??';
        badge.append(makeFlag(st.flag), code);
        chunk.replaceChildren(badge, ' ' + (showingOriginal ? chunk._s4zOrig : st.text));
        chunk.classList.toggle('s4z-translated', !showingOriginal);
        chunk.classList.add('s4z-has-tr');
        chunk.title = showingOriginal ? 'Click to show translation' :
            'Original: ' + chunk._s4zOrig + '\n(click to show original)';
    }

    // Clicking anywhere on a translated message toggles it.
    // (Double-click still reaches Sauce's "watch this rider" handler; two toggles cancel out.)
    document.addEventListener('click', ev => {
        const chunk = ev.target.closest?.(CHUNK_SEL + '.s4z-has-tr');
        if (chunk && chunk._s4zTr) {
            chunk._s4zShowOriginal = !chunk._s4zShowOriginal;
            renderChunk(chunk);
        }
    }, true);

    async function processChunk(chunk) {
        const target = prefs.target;
        const text = originalText(chunk);
        restoreOriginal(chunk);
        chunk._s4zTarget = target;
        if (target === 'off' || !HAS_WORD.test(text)) {   // also skips emoji/number-only messages
            return;
        }
        addName(chunk.closest('.entry')?.querySelector('.header .name')?.textContent);
        try {
            const res = await translateKeepingNames(text, target);
            const stale = () => chunk._s4zTarget !== target || !chunk.isConnected;
            if (!res || stale() || sameLang(res.source, target) || !res.text || norm(res.text) === norm(text)) {
                return;
            }
            const flag = await flagFor(res.source, chunk);
            if (stale()) {
                return;
            }
            chunk._s4zTr = {text: res.text, lang: res.source, flag};
            chunk._s4zShowOriginal = false;
            renderChunk(chunk);
        } catch(e) {
            console.error('Chat Translate error:', e);
        }
    }

    function scan(root) {
        const chunks = root.matches(CHUNK_SEL) ? [root] : root.querySelectorAll(CHUNK_SEL);
        for (const c of chunks) {
            if (!c._s4zSeen) {
                c._s4zSeen = true;
                processChunk(c);
            }
        }
    }

    // Re-translate every message, or only those containing one of `words`.
    function retranslate(words) {
        const only = words && new Set(words.map(lc));
        for (const c of document.querySelectorAll(CHUNK_SEL)) {
            if (!only || wordsOf(originalText(c)).some(w => only.has(lc(w)))) {
                processChunk(c);
            }
        }
    }

    // ---------- Menus ----------
    // Sauce cancels pointerdown on title bar buttons, which stops a native <select> from
    // opening, so these are small in-page menus.
    let menuEl = null;

    function closeMenu() {
        menuEl?.remove();
        menuEl = null;
    }

    function newMenu() {
        closeMenu();
        menuEl = document.createElement('div');
        menuEl.className = 's4z-tr-menu';
        return menuEl;
    }

    function addMenuHead(menu, label) {
        const head = document.createElement('div');
        head.className = 's4z-tr-menu-head';
        head.textContent = label;
        menu.appendChild(head);
    }

    function addMenuItem(menu, label, onPick, cls = '') {
        const item = document.createElement('div');
        item.className = 's4z-tr-menu-item ' + cls;
        item.textContent = label;
        item.addEventListener('click', ev => {
            ev.stopPropagation();
            closeMenu();
            onPick();
        });
        menu.appendChild(item);
        return item;
    }

    function setKept(word, keep) {
        prefs.keep = prefs.keep.filter(w => lc(w) !== lc(word));
        if (keep) {
            prefs.keep.push(word);
        }
        prefs.keep.sort((a, b) => a.localeCompare(b));
        savePrefs();
        retranslate([word]);
    }

    // ---------- Right-click a word: "Never translate" ----------
    const WORD_CHARS = /[\p{L}\p{N}'’]/u;

    function wordAt(x, y, chunk) {
        const r = document.caretRangeFromPoint?.(x, y);
        if (!r || r.startContainer.nodeType !== Node.TEXT_NODE || !chunk.contains(r.startContainer)) {
            return null;
        }
        const t = r.startContainer.textContent;
        let a = r.startOffset, b = r.startOffset;
        while (a > 0 && WORD_CHARS.test(t[a - 1])) a--;
        while (b < t.length && WORD_CHARS.test(t[b])) b++;
        const w = t.slice(a, b).replace(TRIM_QUOTES, '');
        return HAS_WORD.test(w) ? w : null;
    }

    function wordsOf(text) {
        const seen = new Set(), out = [];
        for (const m of text.matchAll(WORD)) {
            const w = m[0].replace(TRIM_QUOTES, '');
            if (HAS_WORD.test(w) && !seen.has(lc(w))) {
                seen.add(lc(w));
                out.push(w);
            }
        }
        return out;
    }

    document.addEventListener('contextmenu', ev => {
        const chunk = ev.target.closest?.(CHUNK_SEL);
        if (!chunk) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        const words = wordsOf(originalText(chunk));
        // The clicked word only counts if it's in the original (a translation may already have changed it).
        const clicked = wordAt(ev.clientX, ev.clientY, chunk);
        const pick = clicked && words.find(w => lc(w) === lc(clicked));
        const menu = newMenu();
        const offer = w => keptSet.has(lc(w)) ?
            addMenuItem(menu, `Translate “${w}” again`, () => setKept(w, false), 'remove') :
            addMenuItem(menu, `Never translate “${w}”`, () => setKept(w, true));
        if (pick) {
            offer(pick);
        }
        const others = words.filter(w => w !== pick)
            .sort((a, b) => (b[0] !== lc(b[0])) - (a[0] !== lc(a[0])));   // capitalised (likely names) first
        if (others.length) {
            const showingTranslation = chunk._s4zTr && !chunk._s4zShowOriginal;
            addMenuHead(menu, showingTranslation || !pick ? 'Words in the original message' : 'Other words');
            others.slice(0, 12).forEach(offer);
        }
        if (!menu.children.length) {
            return closeMenu();
        }
        document.body.appendChild(menu);
        const x = ev.clientX + 2, y = ev.clientY + 2;
        menu.style.left = Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4)) + 'px';
        menu.style.top = Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4)) + 'px';
        menu.style.maxHeight = (innerHeight - 8) + 'px';
    }, true);

    // ---------- Title bar language picker ----------
    function syncPicker() {
        const btn = document.querySelector('#titlebar .s4z-tr-picker');
        if (btn) {
            btn.classList.toggle('off', prefs.target === 'off');
            btn.querySelector('.s4z-tr-code').textContent =
                prefs.target === 'off' ? '' : prefs.target.split('-')[0].toUpperCase();
        }
    }

    function setTarget(code) {
        if (code !== prefs.target) {
            prefs.target = code;
            savePrefs();
            syncPicker();
            retranslate();
            if (code !== 'off') {
                refreshNearbyNames();
            }
        }
    }

    function openLanguageMenu(btn) {
        const menu = newMenu();
        if (prefs.keep.length) {
            addMenuHead(menu, 'Never translate (click to remove)');
            for (const w of prefs.keep) {
                addMenuItem(menu, `✕  ${w}`, () => setKept(w, false), 'remove');
            }
        }
        addMenuHead(menu, 'Translate chat to');
        for (const [code, name] of LANGS) {
            const item = addMenuItem(menu, name, () => setTarget(code), code === prefs.target ? 'selected' : '');
            item.dataset.code = code;
        }
        document.body.appendChild(menu);
        const r = btn.getBoundingClientRect();
        const w = menu.offsetWidth;
        menu.style.top = Math.round(r.bottom + 2) + 'px';
        menu.style.left = Math.max(4, Math.min(r.right - w, innerWidth - w - 4)) + 'px';
        menu.style.maxHeight = Math.max(80, innerHeight - r.bottom - 10) + 'px';
        menu.querySelector('.selected')?.scrollIntoView({block: 'nearest'});
    }

    function addPicker() {
        const buttons = document.querySelector('#titlebar .buttons');
        if (!buttons || buttons.querySelector('.s4z-tr-picker')) {
            return;
        }
        const btn = document.createElement('div');
        btn.className = 'button s4z-tr-picker';
        btn.title = 'Chat Translate: choose language';
        btn.innerHTML = '<ms>translate</ms><span class="s4z-tr-code"></span>';
        btn.addEventListener('click', ev => {
            ev.stopPropagation();
            menuEl ? closeMenu() : openLanguageMenu(btn);
        });
        buttons.insertBefore(btn, buttons.firstChild);
        syncPicker();
    }

    document.addEventListener('click', ev => {
        if (menuEl && !ev.target.closest('.s4z-tr-menu, .s4z-tr-picker')) {
            closeMenu();
        }
    });
    document.addEventListener('keydown', ev => ev.key === 'Escape' && closeMenu());
    window.addEventListener('blur', closeMenu);
    document.addEventListener('visibilitychange', () => !document.hidden && refreshNearbyNames());

    // Keep other Chat windows (if several are open) in sync.
    window.addEventListener('storage', ev => {
        if (ev.key !== STORE_KEY) {
            return;
        }
        const next = loadPrefs();
        const keepChanged = JSON.stringify(next.keep) !== JSON.stringify(prefs.keep);
        const targetChanged = next.target !== prefs.target;
        prefs.keep = next.keep;
        prefs.target = next.target;
        keptSet = new Set(prefs.keep.map(lc));
        if (targetChanged || keepChanged) {
            syncPicker();
            retranslate();
        }
    });

    function start() {
        const content = document.querySelector('#content');
        if (!content) {
            return setTimeout(start, 200);
        }
        try { addPicker(); } catch(e) {/* ignore */}
        for (const n of content.querySelectorAll('.entry .header .name')) {
            addName(n.textContent);
        }
        refreshNearbyNames();
        scan(content);
        new MutationObserver(muts => {
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.nodeType === Node.ELEMENT_NODE && !n.classList.contains('s4z-tr-badge')) {
                        scan(n);
                    }
                }
            }
        }).observe(content, {childList: true, subtree: true});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

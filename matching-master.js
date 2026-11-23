/* ======================================================================
   CLICK-TO-CLICK MATCHING  -  MASTER LIBRARY  -  Storyline 360
   ----------------------------------------------------------------------
   Created by : Chittibabu Kollipara
   Version    : 1.0  (23 Nov 2026)
   Updates    : please contact Chittibabu Kollipara for any change to this
                script (also shown at the bottom of the debug panel).
   ----------------------------------------------------------------------
   PUT THIS SCRIPT ONCE IN THE SLIDE MASTER (or the layout your matching
   slides use):
       View > Slide Master > select the master/layout > Triggers
       Action: Execute JavaScript    When: Timeline starts    Object: this slide
   It only defines  window.initMatching(config)  - nothing happens until a
   slide asks for it.

   ON EVERY MATCHING SLIDE add ONE small trigger (see "Matching Slide.js"):
       window.__matchingPending = { answers: { left1:"right2", left2:"right1" } };
       if (window.initMatching) { window.initMatching(); }

   CONFIG OPTIONS (all optional except answers or count)
       answers : { left1:"right2", ... }   correct pair for each left item.
                 The left items = the keys, the right items = the values.
       count   : 4        shortcut when pair i matches pair i
                          (left1->right1, left2->right2 ...)
       rights  : [...]    only needed if there are EXTRA right items
                          (distractors) that are not in "answers"
       leftPrefix / rightPrefix : default "left" / "right" (used by count)
       vars    : { submitOn:"submitOn", correct:"matchCorrect",
                   allCorrect:"matchAllCorrect" }  (null = skip a variable)
       colors, lineWidth, dotRadius, drawMs, wobble, debug ... see DEFAULTS

   REQUIRED SETUP
     - Alt text of each object = left1, left2 ... / right1, right2 ...
     - Storyline variables: submitOn (T/F), matchCorrect (Number),
       matchAllCorrect (T/F)
     - Submit button  -> Execute JavaScript:  window.matchingLines.check();
     - Reset button   -> Execute JavaScript:  window.matchingLines.reset();

   RETRY + SHOW ANSWERS  (optional - set maxAttempts on the slide)
       window.__matchingPending = { maxAttempts: 2, answers: {...} };
     - maxAttempts 1 (default): Submit locks everything, no retry.
       maxAttempts 2: the learner gets ONE retry. 3: two retries ...
     - Extra Storyline variables (create them):
         matchAttempt    Number     Submit clicks used so far
         matchCanRetry   True/False true after a wrong Submit while an
                                    attempt is left  (show the Retry button)
     - Retry button      -> Execute JavaScript:  window.matchingLines.retry();
         Correct pairs stay (green, locked). Wrong pairs just disappear.
         submitOn turns false until every item is linked again.
     - Show Answer button -> Execute JavaScript: window.matchingLines.showAnswers();
         Works only after the final attempt (matchCanRetry = false after
         Submit). It draws the CORRECT lines (green, solid) and keeps the
         learner's WRONG lines (red, dashed, faded) so they can compare.
         Slide option  showAnswersMode: "correct"  shows only the correct
         lines (wrong ones are removed).
     - Suggested button logic (Storyline conditions):
         Retry        visible when  matchCanRetry = True
         Show Answer  visible when  matchAttempt >= <maxAttempts>
                                    and matchAllCorrect = False

   DEBUG PANEL
     - Press Ctrl + Shift + E to open it. It shows the live state and a
       log of every click/action (nothing is written to the browser console).
     - Built in: if the project has no "Storyline Debug" panel this file
       creates one. If the project already has one, a "Matching" section is
       added to it. Set debug:false in DEFAULTS to switch the logging off.

   BEHAVIOUR
     - Click any item, then an item on the OPPOSITE side (either order).
       The line grows from the item that was clicked FIRST.
     - One connection per item. Clicking a connected item removes its line
       and selects it again. Clicking the selected item deselects it.
   ====================================================================== */
(function () {
    "use strict";

    // ------------------------------------------------------------------
    // DEFAULTS (shared by every slide). A slide can override any of them.
    // ------------------------------------------------------------------
    const DEFAULTS = {
        leftPrefix: "left",
        rightPrefix: "right",

        maxAttempts: 1,          // 1 = Submit locks everything (no retry); 2 = one retry ...
        showAnswersMode: "both", // Show Answer: "both" = correct lines + learner's wrong lines (dashed red)
                                 //              "correct" = only the correct lines

        vars: {
            submitOn:   "submitOn",
            attempt:    "matchAttempt",
            canRetry:   "matchCanRetry",
            correct:    "matchCorrect",
            allCorrect: "matchAllCorrect"
        },

        colors: ["#2F75B5", "#70AD47", "#ED7D31", "#8064A2", "#00A3A3",
                 "#C0504D", "#B8860B", "#4B8BBE", "#D2691E", "#2E8B57"],
        selectColor: "#2F75B5",
        correctColor: "#2E9E5B",
        wrongColor: "#D64545",
        lineWidth: 5,
        dotRadius: 7,
        anchor: "edge",          // "edge" or "center"

        drawMs: 600,             // time for the line to travel
        pointCount: 9,           // line smoothness
        wobble: 16,              // wobble size in px when the line lands
        settleSec: 0.35,         // how fast the wobble dies out
        periodSec: 0.40,         // wobble speed

        hideOnLayer: true,       // hide lines while a feedback layer is open
        debug: true              // log every click / action to the console
    };

    // Shared log buffer (survives slide changes). Shown in the Debug panel.
    const LOG_MAX = 120;
    window.__matchingLog = window.__matchingLog || [];
    function pushLog(text) {
        const d = new Date();
        const p = function (n) { return (n < 10 ? "0" : "") + n; };
        window.__matchingLog.push(p(d.getMinutes()) + ":" + p(d.getSeconds()) + " " + text);
        while (window.__matchingLog.length > LOG_MAX) { window.__matchingLog.shift(); }
    }

    // ------------------------------------------------------------------
    // Version / credit (shown at the bottom of the debug panel)
    // ------------------------------------------------------------------
    const ENGINE_VERSION = "1.0";
    const ENGINE_UPDATED = "23 Nov 2026";
    const ENGINE_AUTHOR  = "Chittibabu Kollipara";

    // ------------------------------------------------------------------
    // DEBUG PANEL (Ctrl + Shift + E)
    // If the project already has a "Storyline Debug" panel
    // (#storyline-debug-panel) the engine adds a "Matching" section to it.
    // If not, the engine creates the same style of panel by itself, so this
    // single file works in any project.
    // ------------------------------------------------------------------
    function ensurePanel() {
        let panel = document.getElementById("storyline-debug-panel");
        if (panel) { return panel; }
        if (window.__storylineDebugInitialized) { return null; }   // the project's own Debug will build it

        panel = document.createElement("div");
        panel.id = "storyline-debug-panel";
        panel.setAttribute("data-created-by", "matching-engine");
        panel.style.cssText = "position:fixed;top:20px;right:20px;width:430px;" +
            "max-width:calc(100vw - 40px);background:#0756A3;color:#FFFFFF;border-radius:6px;" +
            "font-family:Arial,sans-serif;font-size:13px;line-height:1.6;z-index:999999;" +
            "box-shadow:0 4px 16px rgba(0,0,0,0.35);display:none;overflow:hidden;user-select:none;";

        const header = document.createElement("div");
        header.style.cssText = "padding:10px 14px;background:#06447F;font-size:15px;" +
            "font-weight:bold;cursor:move;border-bottom:1px solid rgba(255,255,255,0.25);";
        header.innerHTML = '<span>Storyline Debug</span><span style="float:right;' +
            'font-size:11px;font-weight:normal;opacity:0.75;">Drag to move</span>';

        const footer = document.createElement("div");
        footer.style.cssText = "padding:8px 14px;border-top:1px solid rgba(255,255,255,0.25);" +
            "font-size:11px;opacity:0.8;";
        footer.textContent = "Ctrl + Shift + E - Toggle Debug";

        panel.appendChild(header);
        panel.appendChild(footer);
        document.body.appendChild(panel);

        // drag to move
        let drag = null;
        header.addEventListener("mousedown", function (e) {
            const r = panel.getBoundingClientRect();
            drag = { x: e.clientX - r.left, y: e.clientY - r.top };
            panel.style.right = "auto";
            panel.style.left = r.left + "px";
            panel.style.top = r.top + "px";
            e.preventDefault();
        });
        document.addEventListener("mousemove", function (e) {
            if (!drag) { return; }
            panel.style.left = Math.max(0, Math.min(e.clientX - drag.x,
                window.innerWidth - panel.offsetWidth)) + "px";
            panel.style.top = Math.max(0, Math.min(e.clientY - drag.y,
                window.innerHeight - panel.offsetHeight)) + "px";
        });
        document.addEventListener("mouseup", function () { drag = null; });
        return panel;
    }

    // Keyboard shortcut - used only when THIS file created the panel.
    // (If the project's own Debug script is present it handles the key.)
    if (!window.__matchingKeyBound) {
        window.__matchingKeyBound = true;
        document.addEventListener("keydown", function (e) {
            if (window.__storylineDebugInitialized) { return; }
            if (!(e.ctrlKey && e.shiftKey && String(e.key).toLowerCase() === "e")) { return; }
            const panel = document.getElementById("storyline-debug-panel");
            if (!panel || panel.getAttribute("data-created-by") !== "matching-engine") { return; }
            e.preventDefault();
            panel.style.display = (panel.style.display === "none") ? "block" : "none";
        });
    }

    function buildConfig(user) {
        user = user || {};
        const cfg = Object.assign({}, DEFAULTS, user);
        cfg.vars = Object.assign({}, DEFAULTS.vars, user.vars || {});

        let answers = user.answers;
        if (!answers && user.count) {
            answers = {};
            for (let i = 1; i <= user.count; i++) {
                answers[cfg.leftPrefix + i] = cfg.rightPrefix + i;
            }
        }
        if (!answers) {
            pushLog("ERROR: config needs  answers  or  count");
            console.error("[Matching] config needs  answers  or  count");
            return null;
        }
        cfg.answers = answers;
        if (!cfg.lefts) { cfg.lefts = Object.keys(answers); }
        if (!cfg.rights) {
            cfg.rights = [];
            Object.keys(answers).forEach(function (k) {
                if (cfg.rights.indexOf(answers[k]) < 0) { cfg.rights.push(answers[k]); }
            });
        }
        return cfg;
    }

    // ------------------------------------------------------------------
    // One matching instance (created per slide by initMatching)
    // ------------------------------------------------------------------
    function start(CONFIG) {

        // ==================================================================
        // RE-RUN SAFE: clean up a previous instance (slide revisited)
        // ==================================================================
        if (window.matchingLines && window.matchingLines.destroy) {
            window.matchingLines.destroy();
        }
    
        const lc = function (s) { return String(s || "").trim().toLowerCase(); };
        const LEFTS  = CONFIG.lefts.map(lc);
        const RIGHTS = CONFIG.rights.map(lc);
        const ANSWERS = {};
        Object.keys(CONFIG.answers).forEach(function (k) {
            ANSWERS[lc(k)] = lc(CONFIG.answers[k]);
        });
    
        const links = {};            // leftAlt -> link
        let selected = null;         // currently selected left alt
        let locked = false;          // true after check()
        let rafId = 0;
        let destroyed = false;
        let everSeen = false;        // have we ever found a configured object?
        let lostSince = 0;           // time when all objects disappeared
        const outlined = new Map();  // element -> previous outline styles
        let clickNo = 0;
        let uiTimer = 0;

        // ---- debug helpers -------------------------------------------------
        // Nothing is written to the browser console. Messages go to the
        // "Matching" section of your Storyline Debug panel (Ctrl+Shift+E).
        function dbg() {
            if (!CONFIG.debug) { return; }
            const parts = Array.prototype.slice.call(arguments).map(function (p) {
                return (p && typeof p === "object") ? JSON.stringify(p) : String(p);
            });
            pushLog(parts.join(" "));
        }

        // true when the event happened inside the debug panel itself
        function inDebugPanel(event) {
            return !!(event.target && event.target.closest &&
                      event.target.closest("#storyline-debug-panel"));
        }

        // ---- "Matching" section inside the Storyline Debug panel -----------
        const SEC_ID = "storyline-debug-matching";
        let lastLogText = "";

        function getSection() {
            const panel = ensurePanel();
            if (!panel) { return null; }
            let sec = document.getElementById(SEC_ID);
            if (sec) { return sec; }

            sec = document.createElement("div");
            sec.id = SEC_ID;
            sec.style.cssText = "padding:10px 16px;border-top:1px solid rgba(255,255,255,0.25);" +
                                "user-select:text;cursor:auto;";
            const btn = "background:#06447F;color:#fff;border:1px solid rgba(255,255,255,0.4);" +
                        "border-radius:3px;font-size:11px;padding:1px 8px;margin-left:4px;cursor:pointer;";
            sec.innerHTML =
                '<div style="font-weight:bold;margin-bottom:4px;">Matching' +
                '<span style="float:right;">' +
                '<button data-act="copy" style="' + btn + '">Copy log</button>' +
                '<button data-act="clear" style="' + btn + '">Clear</button></span></div>' +
                '<div id="' + SEC_ID + '-state" style="font-size:12px;white-space:pre;' +
                'font-family:Consolas,monospace;"></div>' +
                '<pre id="' + SEC_ID + '-log" style="margin:6px 0 0;max-height:180px;overflow:auto;' +
                'background:rgba(0,0,0,0.25);padding:6px;font:11px/1.35 Consolas,monospace;' +
                'white-space:pre-wrap;word-break:break-all;"></pre>' +
                '<div style="margin-top:8px;font-size:10.5px;opacity:0.8;line-height:1.4;">' +
                'Matching engine v' + ENGINE_VERSION + ' (' + ENGINE_UPDATED + ') | ' +
                'Created by <strong>' + ENGINE_AUTHOR + '</strong><br>' +
                'Please contact ' + ENGINE_AUTHOR + ' for any update or change to this script.</div>';

            sec.addEventListener("click", function (e) {
                const act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
                if (act === "clear") { window.__matchingLog.length = 0; lastLogText = ""; refreshUI(); }
                if (act === "copy") { copyText(window.__matchingLog.join("\n")); }
            });

            // keep it above the footer ("Ctrl + Shift + E - Toggle Debug")
            panel.insertBefore(sec, panel.lastElementChild);
            return sec;
        }

        function copyText(text) {
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text);
                    return;
                }
            } catch (e) { /* fall through */ }
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.cssText = "position:fixed;left:-9999px;top:0;";
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); } catch (e) { /* ignore */ }
            ta.remove();
        }

        function refreshUI() {
            const panel = document.getElementById("storyline-debug-panel");
            if (!panel || panel.style.display === "none") { return; }   // hidden
            const sec = getSection();
            if (!sec) { return; }

            // --- live state ---
            const total = LEFTS.length;
            const lines = [
                "selected : " + (selected || "-") + "    locked : " + locked,
                "linked   : " + userLinkCount() + " / " + total +
                    "    submitOn : " + (userLinkCount() === total),
                "attempt  : " + attempt + " / " + MAX + "    canRetry : " + canRetryNow +
                    "    final : " + finalNow
            ];
            LEFTS.forEach(function (l) {
                const k = links[l];
                let txt = "  " + l + " -> " + (k ? k.right : "-");
                if (k && locked) { txt += ANSWERS[l] === k.right ? "  OK" : "  WRONG"; }
                else if (k && k.fixed) { txt += "  OK (locked)"; }
                lines.push(txt);
            });
            document.getElementById(SEC_ID + "-state").textContent = lines.join("\n");

            // --- log (only touch the DOM when it changed, keep scroll position) ---
            const pre = document.getElementById(SEC_ID + "-log");
            const text = window.__matchingLog.join("\n");
            if (text !== lastLogText) {
                const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
                pre.textContent = text;
                lastLogText = text;
                if (atBottom) { pre.scrollTop = pre.scrollHeight; }
            }
        }

        uiTimer = setInterval(refreshUI, 300);
        // Build the panel if the project has none (wait a moment so the
        // project's own Debug script, if any, can create its panel first).
        if (CONFIG.debug) { setTimeout(ensurePanel, 1500); }

        // short description of a DOM element:  div.slide-object[alt=left1]
        function desc(el) {
            if (!el || !el.tagName) { return String(el); }
            let s = el.tagName.toLowerCase();
            if (el.id) { s += "#" + el.id; }
            if (el.classList && el.classList.length) {
                s += "." + Array.prototype.slice.call(el.classList, 0, 2).join(".");
            }
            const alt = el.getAttribute && (el.getAttribute("data-acc-text") ||
                                            el.getAttribute("aria-label"));
            if (alt) { s += "[alt=" + alt + "]"; }
            return s;
        }
    
        function snapshot() {
            const l = {};
            Object.keys(links).forEach(function (k) { l[k] = links[k].right; });
            return JSON.stringify({ selected: selected, locked: locked, links: l });
        }
    
        // ==================================================================
        // STORYLINE HELPERS
        // ==================================================================
        function setVar(name, value) {
            if (!name) { return; }
            try { GetPlayer().SetVar(name, value); } catch (e) { /* ignore */ }
        }
    
        function altOf(el) {
            return lc(el.getAttribute("data-acc-text") ||
                      el.getAttribute("aria-label") || "");
        }
    
        function isVisible(el) {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) { return false; }
            const cs = window.getComputedStyle(el);
            return cs.display !== "none" && cs.visibility !== "hidden";
        }
    
        const rectCache = {};        // alt -> last known good rectangle
        const missLogged = {};       // alt -> time of last "not found" log
    
        function findObject(alt) {
            const nodes = document.querySelectorAll("[data-acc-text], [aria-label]");
            let found = null, sized = null, any = null;
            for (let i = 0; i < nodes.length; i++) {
                if (altOf(nodes[i]) !== alt) { continue; }
                any = any || nodes[i];
                const r = nodes[i].getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    sized = nodes[i];                       // has a real size
                    if (isVisible(nodes[i])) { found = nodes[i]; }
                }
            }
            // prefer fully visible; otherwise any element that still has a size
            const best = found || sized;
            if (!best && CONFIG.debug && any) {
                const t = performance.now();
                if (!missLogged[alt] || t - missLogged[alt] > 2000) {
                    missLogged[alt] = t;
                    const r = any.getBoundingClientRect();
                    const cs = window.getComputedStyle(any);
                    dbg("NOT FOUND (visible):", alt, "-> candidate", desc(any),
                                "rect=" + [r.left, r.top, r.width, r.height].map(Math.round).join(","),
                                "display=" + cs.display, "visibility=" + cs.visibility,
                                "opacity=" + cs.opacity);
                }
            }
            return best;
        }
    
        // Rectangle of an object: live if possible, else the last known one
        function rectOf(alt) {
            const el = findObject(alt);
            if (el) {
                const r = el.getBoundingClientRect();
                rectCache[alt] = { left: r.left, top: r.top, right: r.right,
                                   bottom: r.bottom, width: r.width, height: r.height };
                return rectCache[alt];
            }
            return rectCache[alt] || null;
        }
    
        function altFromTarget(target, x, y) {
            // 1) climb from the clicked element
            let el = target;
            while (el && el !== document.body && el.getAttribute) {
                const alt = altOf(el);
                if (alt && (LEFTS.indexOf(alt) > -1 || RIGHTS.indexOf(alt) > -1)) {
                    return alt;
                }
                el = el.parentElement;
            }
            // 2) fallback: which configured object is under the pointer?
            //    (rectOf also refreshes the remembered position of every object)
            const all = LEFTS.concat(RIGHTS);
            all.forEach(rectOf);
            for (let i = 0; i < all.length; i++) {
                const r = rectOf(all[i]);
                if (!r) { continue; }
                if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                    return all[i];
                }
            }
            return null;
        }
    
        function anchorPoint(r, side) {
            const cy = r.top + r.height / 2;
            if (CONFIG.anchor === "center") {
                return { x: r.left + r.width / 2, y: cy };
            }
            return { x: side === "right" ? r.right : r.left, y: cy };
        }
    
        // ==================================================================
        // SVG OVERLAY
        // ==================================================================
        const NS = "http://www.w3.org/2000/svg";
        const old = document.getElementById("storylineMatchSVG");
        if (old) { old.remove(); }
    
        const svg = document.createElementNS(NS, "svg");
        svg.id = "storylineMatchSVG";
        Object.assign(svg.style, {
            position: "fixed", left: "0px", top: "0px",
            width: "100vw", height: "100vh",
            pointerEvents: "none", overflow: "visible", zIndex: "999990"      /* above the player, below the debug panel (999999) */
        });
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        (document.body || document.documentElement).appendChild(svg);
    
        // ==================================================================
        // SELECTION HIGHLIGHT
        // ==================================================================
        function highlight(alt, on) {
            const el = findObject(alt);
            if (!el) { return; }
            if (on) {
                if (!outlined.has(el)) {
                    outlined.set(el, { o: el.style.outline, f: el.style.outlineOffset });
                }
                el.style.outline = "3px solid " + CONFIG.selectColor;
                el.style.outlineOffset = "2px";
            } else if (outlined.has(el)) {
                const p = outlined.get(el);
                el.style.outline = p.o;
                el.style.outlineOffset = p.f;
                outlined.delete(el);
            }
        }
    
        function select(alt) {
            if (selected) { highlight(selected, false); }
            selected = alt;
            if (selected) { highlight(selected, true); }
        }
    
        // ==================================================================
        // LINKS
        // ==================================================================
        // opts.key lets "show answers" keep the learner's line AND add the
        // correct one for the same left item (stored as "ans:<left>").
        function createLink(left, right, firstClicked, opts) {
            const key = (opts && opts.key) || left;
            const color = CONFIG.colors[LEFTS.indexOf(left) % CONFIG.colors.length];
    
            const path = document.createElementNS(NS, "path");
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", color);
            path.setAttribute("stroke-width", CONFIG.lineWidth);
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            svg.appendChild(path);
    
            const dotA = document.createElementNS(NS, "circle");
            const dotB = document.createElementNS(NS, "circle");
            [dotA, dotB].forEach(function (d) {
                d.setAttribute("r", CONFIG.dotRadius);
                d.setAttribute("fill", color);
                svg.appendChild(d);
            });
    
            const points = [];
            for (let i = 0; i < CONFIG.pointCount; i++) {
                points.push({ x: 0, y: 0, vx: 0, vy: 0 });
            }
    
            links[key] = {
                key: key, left: left, right: right, color: color,
                fromLeft: firstClicked !== right,   // line grows from the item clicked first
                path: path, dotA: dotA, dotB: dotB,
                points: points, init: false, born: performance.now()
            };
            dbg("line created", left, "->", right,
                        "| svg in page:", document.body.contains(svg));
        }
    
        function removeLink(left) {
            const l = links[left];
            if (!l) { return; }
            l.path.remove(); l.dotA.remove(); l.dotB.remove();
            delete links[left];
        }
    
        function leftOfRight(right) {
            const keys = Object.keys(links);
            for (let i = 0; i < keys.length; i++) {
                if (links[keys[i]].right === right) { return keys[i]; }
            }
            return null;
        }
    
        function updateVars() {
            const all = userLinkCount() === LEFTS.length;
            setVar(CONFIG.vars.submitOn, all);
        }

        // number of the LEARNER's lines (not the extra "correct answer" lines)
        function userLinkCount() {
            return Object.keys(links).filter(function (k) { return k.indexOf("ans:") !== 0; }).length;
        }
    
        // ==================================================================
        // CLICK HANDLING
        // ==================================================================
        // Logs EVERY click on the page (even ones we ignore) and what lies
        // under the pointer - this shows what is blocking a click.
        function rawLogger(event) {
            if (!CONFIG.debug || destroyed || inDebugPanel(event)) { return; }
            clickNo++;
            let stack = [];
            try {
                stack = document.elementsFromPoint(event.clientX, event.clientY)
                    .slice(0, 6).map(desc);
            } catch (e) { /* ignore */ }
            dbg("#" + clickNo, event.type,
                        "at " + Math.round(event.clientX) + "," + Math.round(event.clientY),
                        "| target:", desc(event.target),
                        "| under pointer (top->bottom):", stack.join("  >  "));
        }
        document.addEventListener("pointerdown", rawLogger, true);
        document.addEventListener("click", rawLogger, true);
    
        function onClick(event) {
            const n = clickNo;
            if (destroyed || inDebugPanel(event)) { return; }   // never treat panel clicks as item clicks
            if (locked) { dbg("#" + n, "IGNORED - interaction is locked (check() already ran; call reset())"); return; }
            LEFTS.concat(RIGHTS).forEach(rectOf);   // remember positions before Storyline reacts
            const alt = altFromTarget(event.target, event.clientX, event.clientY);
            if (!alt) {
                dbg("#" + n, "IGNORED - click is not on any left/right item");
                return;
            }
            dbg("#" + n, "resolved item:", alt, "| before:", snapshot());

            // pairs that were marked correct (after a retry / show answers) are locked
            const ownerKey = LEFTS.indexOf(alt) > -1 ? alt : leftOfRight(alt);
            if (ownerKey && links[ownerKey] && links[ownerKey].fixed) {
                dbg("#" + n, "IGNORED -", alt, "belongs to a correct, locked pair");
                return;
            }
    
            const isLeft = LEFTS.indexOf(alt) > -1;
    
            // the line that currently touches the clicked item (if any)
            function partnerLinkOf(a) {
                return LEFTS.indexOf(a) > -1 ? (links[a] ? a : null) : leftOfRight(a);
            }
            // remove the clicked item's existing line (one connection only)
            function dropLinkOf(a, why) {
                const key = partnerLinkOf(a);
                if (key) {
                    dbg("#" + n, "ACTION  unlink", key, "->", links[key].right, "(" + why + ")");
                    removeLink(key);
                }
            }
    
            if (!selected) {
                // nothing selected yet: first click can be on EITHER side
                dropLinkOf(alt, alt + " clicked again - removing its line and re-selecting it");
                dbg("#" + n, "ACTION  select", alt);
                select(alt);
            } else if (selected === alt) {
                dbg("#" + n, "ACTION  deselect", alt);
                select(null);
            } else if ((LEFTS.indexOf(selected) > -1) === isLeft) {
                // second click on the SAME side: just switch the selection
                dropLinkOf(alt, alt + " re-selected");
                dbg("#" + n, "ACTION  switch selection", selected, "->", alt);
                select(alt);
            } else {
                // second click on the OPPOSITE side: make the connection
                const left  = isLeft ? alt : selected;
                const right = isLeft ? selected : alt;
                dropLinkOf(left,  "replaced by new link");
                dropLinkOf(right, "replaced by new link");
                dbg("#" + n, "ACTION  link", left, "->", right);
                createLink(left, right, selected);
                select(null);
            }
            updateVars();
            dbg("#" + n, "after:", snapshot(),
                "| submitOn =", userLinkCount() === LEFTS.length);
        }
    
        document.addEventListener("click", onClick, true);
    
        // ==================================================================
        // ROPE PHYSICS (same feel as the reference file)
        // ==================================================================
        function initRope(link, s, e) {
            const n = CONFIG.pointCount;
            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                const p = link.points[i];
                p.x = s.x + (e.x - s.x) * t;
                p.y = s.y + (e.y - s.y) * t;
                p.vx = 0; p.vy = 0;
            }
            link.init = true;
        }
    
        function simulate(link, s, e) {
            const pts = link.points;
            const n = CONFIG.pointCount;
            const last = n - 1;
    
            pts[0].x = s.x;    pts[0].y = s.y;
            pts[last].x = e.x; pts[last].y = e.y;
    
            for (let i = 1; i < last; i++) {
                const p = pts[i];
                p.vy += CONFIG.gravity;
                p.vx *= CONFIG.damping;
                p.vy *= CONFIG.damping;
                p.x += p.vx;
                p.y += p.vy;
            }
    
            const dist = Math.hypot(e.x - s.x, e.y - s.y);
            const target = Math.max(1, dist / last);
    
            for (let it = 0; it < CONFIG.iterations; it++) {
                for (let i = 0; i < last; i++) {
                    const a = pts[i], b = pts[i + 1];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const cur = Math.hypot(dx, dy) || 1;
                    const diff = (cur - target) / cur;
                    const fx = dx * diff * CONFIG.spring;
                    const fy = dy * diff * CONFIG.spring;
                    if (i !== 0)        { a.x += fx; a.y += fy; }
                    if (i + 1 !== last) { b.x -= fx; b.y -= fy; }
                }
                pts[0].x = s.x;    pts[0].y = s.y;
                pts[last].x = e.x; pts[last].y = e.y;
            }
        }
    
        function drawRope(link) {
            const pts = link.points;
            const n = CONFIG.pointCount;
            let d = "M " + pts[0].x + " " + pts[0].y;
            for (let i = 1; i < n - 1; i++) {
                const c = pts[i], nx = pts[i + 1];
                d += " Q " + c.x + " " + c.y + " " +
                     (c.x + nx.x) / 2 + " " + (c.y + nx.y) / 2;
            }
            const p = pts[n - 2], l = pts[n - 1];
            d += " Q " + p.x + " " + p.y + " " + l.x + " " + l.y;
            link.path.setAttribute("d", d);
        }
    
        // overshoot easing -> the line "snaps" onto the target and settles
        function easeOutBack(t) {
            const c1 = 1.70158, c3 = c1 + 1;
            return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        }
    
        // ==================================================================
        // MAIN LOOP
        // ==================================================================
        let lastRender = 0;
        let timerId = 0;
    
        function frame() {
            if (destroyed) { return; }
            rafId = requestAnimationFrame(frame);
            render();
        }
    
        // Fallback: the preview window can pause requestAnimationFrame when it
        // is not focused (e.g. while DevTools has focus). A timer keeps drawing.
        timerId = setInterval(function () {
            if (!destroyed && performance.now() - lastRender > 100) { render(); }
        }, 100);
    
        function render() {
            const now = performance.now();
            lastRender = now;
    
            // slide changed -> clean up (all configured objects gone for 1.5s)
            let anySeen = false;
            const everyone = LEFTS.concat(RIGHTS);
            for (let i = 0; i < everyone.length && !anySeen; i++) {
                if (findObject(everyone[i])) { anySeen = true; }
            }
            if (anySeen) { everSeen = true; lostSince = 0; }
            else if (everSeen) {
                if (!lostSince) { lostSince = now; }
                if (now - lostSince > 1500) {
                    dbg("no configured object found for 1.5s -> slide left, cleaning up");
                    destroy();
                    return;
                }
            }
    
            if (CONFIG.hideOnLayer) {
                // hide only when a layer OTHER than the base layer is open
                const shown = document.querySelectorAll(".slide-layer.shown");
                const extra = document.querySelector(".slide-layer.shown:not(.base-layer)");
                const overlayOpen = shown.length > 1 && !!extra;
                svg.style.display = overlayOpen ? "none" : "block";
            }
    
            LEFTS.concat(RIGHTS).forEach(rectOf);   // keep remembered positions fresh
    
            Object.keys(links).forEach(function (key) {
                const link = links[key];
                // "from" = the item clicked first, "to" = the item clicked second
                const fromAlt = link.fromLeft ? link.left : link.right;
                const toAlt   = link.fromLeft ? link.right : link.left;
                const a = rectOf(fromAlt);
                const b = rectOf(toAlt);
                const vis = (a && b) ? "" : "none";
                if (link.lastVis !== vis) {
                    link.lastVis = vis;
                    dbg("link", link.left, "->", link.right,
                        vis === "" ? "VISIBLE" : "HIDDEN (object not found/visible: " +
                        [!a ? fromAlt : "", !b ? toAlt : ""].filter(Boolean).join(", ") + ")");
                }
                link.path.style.display = vis;
                link.dotA.style.display = vis;
                link.dotB.style.display = vis;
                if (!a || !b) { return; }
    
                // a left item connects at its RIGHT edge, a right item at its LEFT edge
                const s = anchorPoint(a, link.fromLeft ? "right" : "left");
                const e = anchorPoint(b, link.fromLeft ? "left" : "right");
    
                const t = Math.max(0, Math.min(1, (performance.now() - link.born) / CONFIG.drawMs));
                const k = easeOutBack(t);
                const end = { x: s.x + (e.x - s.x) * k, y: s.y + (e.y - s.y) * k };
    
                // Straight line + decaying sine wobble after it lands
                // (deterministic: always settles perfectly straight)
                const tau = Math.max(0, performance.now() - link.born - CONFIG.drawMs) / 1000;
                const dist = Math.hypot(end.x - s.x, end.y - s.y) || 1;
                const nx = -(end.y - s.y) / dist, ny = (end.x - s.x) / dist;
                const amp = CONFIG.wobble * Math.exp(-tau / CONFIG.settleSec) *
                            Math.sin(2 * Math.PI * tau / CONFIG.periodSec);
                const last = CONFIG.pointCount - 1;
                for (let i = 0; i <= last; i++) {
                    const u = i / last;
                    const off = amp * Math.sin(Math.PI * u);
                    link.points[i].x = s.x + (end.x - s.x) * u + nx * off;
                    link.points[i].y = s.y + (end.y - s.y) * u + ny * off;
                }
                drawRope(link);
    
                link.dotA.setAttribute("cx", s.x);
                link.dotA.setAttribute("cy", s.y);
                link.dotB.setAttribute("cx", end.x);
                link.dotB.setAttribute("cy", end.y);
    
                if (!link.logged) {
                    link.logged = true;
                    dbg("drawing", link.left, "from",
                                Math.round(s.x) + "," + Math.round(s.y), "to",
                                Math.round(e.x) + "," + Math.round(e.y),
                                "| svg display:", svg.style.display || "block");
                }
            });
        }
    
        rafId = requestAnimationFrame(frame);
    
        // ==================================================================
        // PUBLIC API  (call from Storyline "Execute JavaScript" triggers)
        // ==================================================================
        // ---- attempts / retry -----------------------------------------------
        const MAX = Math.max(1, parseInt(CONFIG.maxAttempts, 10) || 1);
        let attempt = 0;            // Submit clicks used so far
        let canRetryNow = false;    // wrong pairs exist and an attempt is left
        let finalNow = false;       // no attempt left (or everything correct)
        let lastResult = null;
        let answersShown = false;

        function paint(l, color) {
            l.path.setAttribute("stroke", color);
            l.dotA.setAttribute("fill", color);
            l.dotB.setAttribute("fill", color);
        }

        // Submit button  ->  window.matchingLines.check();
        function check() {
            if (locked) {
                dbg("CHECK ignored - already checked (use retry() or reset())");
                return lastResult;
            }
            attempt++;
            let correct = 0;
            Object.keys(links).forEach(function (key) {
                const l = links[key];
                const ok = ANSWERS[l.left] === l.right;
                if (ok) { correct++; }
                paint(l, ok ? CONFIG.correctColor : CONFIG.wrongColor);
            });
            const all = correct === LEFTS.length &&
                        userLinkCount() === LEFTS.length;
            locked = true;
            select(null);
            canRetryNow = !all && attempt < MAX;
            finalNow = !canRetryNow;
            lastResult = { correct: correct, total: LEFTS.length, allCorrect: all,
                           attempt: attempt, maxAttempts: MAX, canRetry: canRetryNow };
            dbg("CHECK -> attempt " + attempt + "/" + MAX + ":", correct + "/" + LEFTS.length,
                "correct; allCorrect =", all, "; canRetry =", canRetryNow);
            setVar(CONFIG.vars.correct, correct);
            setVar(CONFIG.vars.allCorrect, all);
            setVar(CONFIG.vars.attempt, attempt);
            setVar(CONFIG.vars.canRetry, canRetryNow);
            return lastResult;
        }

        // Retry button  ->  window.matchingLines.retry();
        // Correct pairs stay (locked, green). Wrong pairs just disappear.
        function retry() {
            if (!locked || !canRetryNow) {
                dbg("RETRY ignored - needs a wrong Submit with an attempt left",
                    "(attempt " + attempt + "/" + MAX + ")");
                return false;
            }
            let kept = 0, removed = 0;
            Object.keys(links).forEach(function (k) {
                const l = links[k];
                if (ANSWERS[l.left] === l.right) { l.fixed = true; kept++; }
                else { removeLink(k); removed++; }
            });
            locked = false;
            canRetryNow = false;
            finalNow = false;
            select(null);
            dbg("RETRY -> kept " + kept + " correct (locked), removed " + removed + " wrong");
            setVar(CONFIG.vars.canRetry, false);
            setVar(CONFIG.vars.allCorrect, false);
            updateVars();                     // submitOn stays false until all items are linked
            return true;
        }

        // Show Answer button  ->  window.matchingLines.showAnswers();
        // Only after the final attempt. Wrong pairs are replaced by the right ones.
        function showAnswers() {
            if (!locked || !finalNow) {
                dbg("SHOW ANSWERS ignored - available only after the final attempt");
                return false;
            }
            if (answersShown) { dbg("SHOW ANSWERS ignored - already shown"); return false; }
            answersShown = true;
            const keepMine = CONFIG.showAnswersMode !== "correct";   // "both" (default) | "correct"
            let drawn = 0, kept = 0;
            LEFTS.forEach(function (l) {
                const mine = links[l];
                const right = ANSWERS[l];
                if (mine && mine.right === right) { mine.fixed = true; return; }   // already correct
                if (mine) {
                    if (keepMine) {
                        // keep the learner's wrong line, faded + dashed, so they can see it
                        mine.fixed = true;
                        paint(mine, CONFIG.wrongColor);
                        mine.path.setAttribute("stroke-dasharray", "9 7");
                        [mine.path, mine.dotA, mine.dotB].forEach(function (e) { e.style.opacity = "0.6"; });
                        kept++;
                    } else {
                        removeLink(l);
                    }
                }
                if (!right) { return; }
                createLink(l, right, l, { key: "ans:" + l });   // grows from the left item
                links["ans:" + l].fixed = true;
                paint(links["ans:" + l], CONFIG.correctColor);
                drawn++;
            });
            dbg("SHOW ANSWERS -> drew " + drawn + " correct line(s), kept " + kept +
                " of the learner's wrong line(s) (mode: " + (keepMine ? "both" : "correct") + ")");
            return true;
        }

        function reset() {
            Object.keys(links).forEach(removeLink);
            select(null);
            locked = false;
            attempt = 0;
            canRetryNow = false;
            finalNow = false;
            lastResult = null;
            answersShown = false;
            setVar(CONFIG.vars.submitOn, false);
            setVar(CONFIG.vars.correct, 0);
            setVar(CONFIG.vars.allCorrect, false);
            setVar(CONFIG.vars.attempt, 0);
            setVar(CONFIG.vars.canRetry, false);
            dbg("RESET");
        }
    
        // Type  matchingLines.dump()  in the DevTools console at any time.
        function dump() {
            dbg("DUMP", snapshot());
            dbg("svg in page:", document.body.contains(svg),
                        "| display:", svg.style.display || "block",
                        "| z-index:", svg.style.zIndex);
            LEFTS.concat(RIGHTS).forEach(function (a) {
                const el = findObject(a);
                const r = el && el.getBoundingClientRect();
                dbg("object", a, el ? desc(el) + " rect=" +
                    [r.left, r.top, r.width, r.height].map(Math.round).join(",") : "NOT FOUND");
            });
            Object.keys(links).forEach(function (k) {
                const l = links[k];
                let bb = "n/a";
                try { const b = l.path.getBBox(); bb = [b.x, b.y, b.width, b.height].map(Math.round).join(","); } catch (e) { /* hidden */ }
                dbg("link", l.left, "->", l.right,
                            "| display:", l.path.style.display || "block",
                            "| bbox:", bb, "| d:", (l.path.getAttribute("d") || "").slice(0, 70));
            });
        }
    
        function getState() {
            const out = {};
            Object.keys(links).forEach(function (k) { out[k] = links[k].right; });
            return out;
        }
    
        function destroy() {
            destroyed = true;
            cancelAnimationFrame(rafId);
            clearInterval(timerId);
            clearInterval(uiTimer);
            const sec = document.getElementById(SEC_ID);
            if (sec) { sec.remove(); }
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("click", rawLogger, true);
            document.removeEventListener("pointerdown", rawLogger, true);
            select(null);
            svg.remove();
            if (window.matchingLines && window.matchingLines.destroy === destroy) {
                delete window.matchingLines;
            }
        }
    
        window.matchingLines = {
            check: check, retry: retry, showAnswers: showAnswers, reset: reset,
            getState: getState, dump: dump, destroy: destroy
        };
    
        // diagnostics (open the browser console with F12)
        setTimeout(function () {
            const miss = LEFTS.concat(RIGHTS).filter(function (a) { return !findObject(a); });
            if (miss.length) {
                const seen = [];
                document.querySelectorAll("[data-acc-text]").forEach(function (e) {
                    seen.push(e.getAttribute("data-acc-text"));
                });
                dbg("WARN:", "objects NOT found by alt text:", miss,
                             "| alt texts present on page:", seen);
            } else {
                dbg("ready - all objects found");
            }
        }, 1000);
    
        dbg("INIT", LEFTS.length + " left /", RIGHTS.length + " right items; answers =", ANSWERS);

        // initial variable state
        setVar(CONFIG.vars.submitOn, false);
        setVar(CONFIG.vars.correct, 0);
        setVar(CONFIG.vars.allCorrect, false);
        setVar(CONFIG.vars.attempt, 0);
        setVar(CONFIG.vars.canRetry, false);
    }

    // ------------------------------------------------------------------
    // PUBLIC ENTRY POINT  (called by the small slide-level trigger)
    // ------------------------------------------------------------------
    window.initMatching = function (userCfg) {
        const cfg = buildConfig(userCfg || window.__matchingPending);
        window.__matchingPending = null;
        if (cfg) { start(cfg); }
    };

    // The slide trigger may have run BEFORE this master script: pick it up.
    if (window.__matchingPending) { window.initMatching(); }
})();

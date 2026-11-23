/* ======================================================================
   CLICK-TO-CLICK MATCHING  -  CORE ENGINE  -  Storyline 360
   ----------------------------------------------------------------------
   Copyright (c) 2026 Chittibabu Kollipara. All rights reserved.
   Created by : Chittibabu Kollipara
   Version    : 1.0  (23 Nov 2026)
   Updates    : please contact Chittibabu Kollipara for any change to this
                script.

   NOTICE - DO NOT REMOVE OR EDIT THE "SIGNATURE" BLOCK BELOW.
   The engine verifies it when it starts, and parts of the code depend on
   it. If the signature is removed or changed, the engine will not run.
   ----------------------------------------------------------------------
   PUT THIS SCRIPT ONCE IN THE SLIDE MASTER (or the layout your matching
   slides use):
       View > Slide Master > select the master/layout > Triggers
       Action: Execute JavaScript    When: Timeline starts    Object: this slide
   It only defines  window.initMatching(config)  - nothing happens until a
   slide asks for it.

   ON EVERY MATCHING SLIDE add ONE small trigger:
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
       maxAttempts     : 1 = no retry (default), 2 = one retry, 3 = two ...
       showAnswersMode : "both" (default) | "correct"
       vars    : { submitOn:"submitOn", correct:"matchCorrect",
                   allCorrect:"matchAllCorrect", attempt:"matchAttempt",
                   canRetry:"matchCanRetry" }  (null = skip a variable)
       colors, lineWidth, dotRadius, drawMs, wobble ... see DEFAULTS

   REQUIRED SETUP
     - Alt text of each object = left1, left2 ... / right1, right2 ...
     - Storyline variables: submitOn (T/F), matchCorrect (Number),
       matchAllCorrect (T/F), matchAttempt (Number), matchCanRetry (T/F)
     - Submit button       -> Execute JavaScript:  window.matchingLines.check();
     - Retry button        -> Execute JavaScript:  window.matchingLines.retry();
     - Show Answer button  -> Execute JavaScript:  window.matchingLines.showAnswers();
     - Reset button        -> Execute JavaScript:  window.matchingLines.reset();

   BEHAVIOUR
     - Click any item, then an item on the OPPOSITE side (either order).
       The line grows from the item that was clicked FIRST.
     - One connection per item. Clicking a connected item removes its line
       and selects it again. Clicking the selected item deselects it.
     - Retry keeps the correct pairs (locked) and removes the wrong ones.
     - Show Answer (after the final attempt) draws the correct lines and
       keeps the learner's wrong lines (dashed red).
   ====================================================================== */
(function () {
    "use strict";

    // ==================================================================
    // SIGNATURE  -  DO NOT REMOVE OR EDIT  (the engine will not run)
    // ==================================================================
    const SIGNATURE = "Matching engine by Chittibabu Kollipara | click-to-click matching for Storyline 360 | (c) 2026";
    const SIG_HASH  = 2722594546;
    // ==================================================================

    const ENGINE_VERSION = "1.0";
    const ENGINE_UPDATED = "23 Nov 2026";
    const ENGINE_AUTHOR  = "Chittibabu Kollipara";

    function fnv(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
    }

    // internal strings are stored scrambled with the signature as the key
    function dec(b64, key) {
        const s = atob(b64);
        let out = "";
        for (let i = 0; i < s.length; i++) {
            out += String.fromCharCode(s.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return out;
    }

    const SIG_OK = (fnv(SIGNATURE) === SIG_HASH);
    const FINGERPRINT = "CM-" + fnv(SIGNATURE).toString(16).toUpperCase();

    function guard() {
        if (!SIG_OK) {
            console.error("Matching engine: signature missing or modified - the engine will not run. " +
                          "Please contact " + ENGINE_AUTHOR + ".");
        }
        return SIG_OK;
    }

    // ------------------------------------------------------------------
    // DEFAULTS (shared by every slide). A slide can override any of them.
    // ------------------------------------------------------------------
    const DEFAULTS = {
        leftPrefix: "left",
        rightPrefix: "right",

        maxAttempts: 1,
        showAnswersMode: "both",

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

        hideOnLayer: true        // hide lines while a feedback layer is open
    };

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
            console.error("Matching engine: config needs  answers  or  count");
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

        // previous instance (slide revisited)
        if (window.matchingLines && window.matchingLines.destroy) {
            window.matchingLines.destroy();
        }

        // internal strings (scrambled with the signature)
        const ATTR_ALT   = dec("KQAAAkUIDQQNEQsfHQ==", SIGNATURE);
        const ATTR_ARIA  = dec("LBMdAkUFDwVFCQ==", SIGNATURE);
        const SEL_OBJ    = dec("FgUVFwlEDwRDSBoCERo4DEIiQTEBCFkYCAAEDig=", SIGNATURE);
        const SEL_LAYER  = dec("YxIYCgwMQwtBHAsVRx0NTxUX", SIGNATURE);
        const SEL_EXTRA  = dec("YxIYCgwMQwtBHAsVRx0NTxUXGi0HHVxaCwMSB1hMKhYJHkA=", SIGNATURE);
        const NS         = dec("JRUAE1JGQRBXEkAQWkAKUgVWEnNYWVsHHwU=", SIGNATURE);

        const lc = function (s) { return String(s || "").trim().toLowerCase(); };
        const LEFTS  = CONFIG.lefts.map(lc);
        const RIGHTS = CONFIG.rights.map(lc);
        const ANSWERS = {};
        Object.keys(CONFIG.answers).forEach(function (k) {
            ANSWERS[lc(k)] = lc(CONFIG.answers[k]);
        });

        const links = {};            // leftAlt -> link  ("ans:<leftAlt>" = correct-answer line)
        let selected = null;         // currently selected item
        let locked = false;          // true after check()
        let rafId = 0;
        let timerId = 0;
        let lastRender = 0;
        let destroyed = false;
        let everSeen = false;        // have we ever found a configured object?
        let lostSince = 0;           // time when all objects disappeared
        const outlined = new Map();  // element -> previous outline styles

        const MAX = Math.max(1, parseInt(CONFIG.maxAttempts, 10) || 1);
        let attempt = 0;             // Submit clicks used so far
        let canRetryNow = false;     // wrong pairs exist and an attempt is left
        let finalNow = false;        // no attempt left (or everything correct)
        let lastResult = null;
        let answersShown = false;

        // ==============================================================
        // STORYLINE HELPERS
        // ==============================================================
        function setVar(name, value) {
            if (!name) { return; }
            try { GetPlayer().SetVar(name, value); } catch (e) { /* ignore */ }
        }

        function altOf(el) {
            return lc(el.getAttribute(ATTR_ALT) || el.getAttribute(ATTR_ARIA) || "");
        }

        function isVisible(el) {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) { return false; }
            const cs = window.getComputedStyle(el);
            return cs.display !== "none" && cs.visibility !== "hidden";
        }

        const rectCache = {};        // alt -> last known good rectangle

        function findObject(alt) {
            const nodes = document.querySelectorAll(SEL_OBJ);
            let found = null, sized = null;
            for (let i = 0; i < nodes.length; i++) {
                if (altOf(nodes[i]) !== alt) { continue; }
                const r = nodes[i].getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    sized = nodes[i];
                    if (isVisible(nodes[i])) { found = nodes[i]; }
                }
            }
            return found || sized;
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

        // ==============================================================
        // SVG OVERLAY
        // ==============================================================
        const old = document.getElementById("storylineMatchSVG");
        if (old) { old.remove(); }

        const svg = document.createElementNS(NS, "svg");
        svg.id = "storylineMatchSVG";
        svg.setAttribute("data-cm", FINGERPRINT);        // fingerprint of this engine
        Object.assign(svg.style, {
            position: "fixed", left: "0px", top: "0px",
            width: "100vw", height: "100vh",
            pointerEvents: "none", overflow: "visible", zIndex: "999990"
        });
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        (document.body || document.documentElement).appendChild(svg);

        // ==============================================================
        // SELECTION HIGHLIGHT
        // ==============================================================
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

        // ==============================================================
        // LINKS
        // ==============================================================
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
                points.push({ x: 0, y: 0 });
            }

            links[key] = {
                key: key, left: left, right: right, color: color,
                fromLeft: firstClicked !== right,   // line grows from the item clicked first
                path: path, dotA: dotA, dotB: dotB,
                points: points, born: performance.now()
            };
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

        // number of the LEARNER's lines (not the extra "correct answer" lines)
        function userLinkCount() {
            return Object.keys(links).filter(function (k) { return k.indexOf("ans:") !== 0; }).length;
        }

        function updateVars() {
            setVar(CONFIG.vars.submitOn, userLinkCount() === LEFTS.length);
        }

        function paint(l, color) {
            l.path.setAttribute("stroke", color);
            l.dotA.setAttribute("fill", color);
            l.dotB.setAttribute("fill", color);
        }

        // ==============================================================
        // CLICK HANDLING
        // ==============================================================
        function onClick(event) {
            if (destroyed || locked || !guard()) { return; }
            LEFTS.concat(RIGHTS).forEach(rectOf);   // remember positions before Storyline reacts
            const alt = altFromTarget(event.target, event.clientX, event.clientY);
            if (!alt) { return; }

            // pairs that were marked correct (after a retry / show answers) are locked
            const ownerKey = LEFTS.indexOf(alt) > -1 ? alt : leftOfRight(alt);
            if (ownerKey && links[ownerKey] && links[ownerKey].fixed) { return; }

            const isLeft = LEFTS.indexOf(alt) > -1;

            // remove the existing line that touches an item (one connection only)
            function dropLinkOf(a) {
                const key = LEFTS.indexOf(a) > -1 ? (links[a] ? a : null) : leftOfRight(a);
                if (key) { removeLink(key); }
            }

            if (!selected) {
                dropLinkOf(alt);                  // clicked again: remove its line, re-select it
                select(alt);
            } else if (selected === alt) {
                select(null);
            } else if ((LEFTS.indexOf(selected) > -1) === isLeft) {
                dropLinkOf(alt);                  // same side: switch the selection
                select(alt);
            } else {
                const left  = isLeft ? alt : selected;
                const right = isLeft ? selected : alt;
                dropLinkOf(left);
                dropLinkOf(right);
                createLink(left, right, selected);
                select(null);
            }
            updateVars();
        }

        document.addEventListener("click", onClick, true);

        // ==============================================================
        // DRAWING
        // ==============================================================
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

        function frame() {
            if (destroyed) { return; }
            rafId = requestAnimationFrame(frame);
            render();
        }

        // Fallback: a window that is not focused can pause requestAnimationFrame
        timerId = setInterval(function () {
            if (!destroyed && performance.now() - lastRender > 100) { render(); }
        }, 100);

        function render() {
            if (!guard()) { destroy(); return; }
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
                if (now - lostSince > 1500) { destroy(); return; }
            }

            if (CONFIG.hideOnLayer) {
                // hide only when a layer OTHER than the base layer is open
                const shown = document.querySelectorAll(SEL_LAYER);
                const extra = document.querySelector(SEL_EXTRA);
                svg.style.display = (shown.length > 1 && !!extra) ? "none" : "block";
            }

            LEFTS.concat(RIGHTS).forEach(rectOf);   // keep remembered positions fresh

            Object.keys(links).forEach(function (key) {
                const link = links[key];
                // "from" = the item clicked first, "to" = the item clicked second
                const a = rectOf(link.fromLeft ? link.left : link.right);
                const b = rectOf(link.fromLeft ? link.right : link.left);
                const vis = (a && b) ? "" : "none";
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

                // straight line + decaying sine wobble after it lands
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
            });
        }

        rafId = requestAnimationFrame(frame);

        // ==============================================================
        // PUBLIC API  (call from Storyline "Execute JavaScript" triggers)
        // ==============================================================

        // Submit button  ->  window.matchingLines.check();
        function check() {
            if (!guard() || locked) { return lastResult; }
            attempt++;
            let correct = 0;
            Object.keys(links).forEach(function (key) {
                const l = links[key];
                const ok = ANSWERS[l.left] === l.right;
                if (ok) { correct++; }
                paint(l, ok ? CONFIG.correctColor : CONFIG.wrongColor);
            });
            const all = correct === LEFTS.length && userLinkCount() === LEFTS.length;
            locked = true;
            select(null);
            canRetryNow = !all && attempt < MAX;
            finalNow = !canRetryNow;
            lastResult = { correct: correct, total: LEFTS.length, allCorrect: all,
                           attempt: attempt, maxAttempts: MAX, canRetry: canRetryNow };
            setVar(CONFIG.vars.correct, correct);
            setVar(CONFIG.vars.allCorrect, all);
            setVar(CONFIG.vars.attempt, attempt);
            setVar(CONFIG.vars.canRetry, canRetryNow);
            return lastResult;
        }

        // Retry button  ->  window.matchingLines.retry();
        // Correct pairs stay (locked, green). Wrong pairs just disappear.
        function retry() {
            if (!guard() || !locked || !canRetryNow) { return false; }
            Object.keys(links).forEach(function (k) {
                const l = links[k];
                if (ANSWERS[l.left] === l.right) { l.fixed = true; }
                else { removeLink(k); }
            });
            locked = false;
            canRetryNow = false;
            finalNow = false;
            select(null);
            setVar(CONFIG.vars.canRetry, false);
            setVar(CONFIG.vars.allCorrect, false);
            updateVars();                     // submitOn stays false until all items are linked
            return true;
        }

        // Show Answer button  ->  window.matchingLines.showAnswers();
        // Only after the final attempt.
        function showAnswers() {
            if (!guard() || !locked || !finalNow || answersShown) { return false; }
            answersShown = true;
            const keepMine = CONFIG.showAnswersMode !== "correct";   // "both" (default) | "correct"
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
                    } else {
                        removeLink(l);
                    }
                }
                if (!right) { return; }
                createLink(l, right, l, { key: "ans:" + l });   // grows from the left item
                links["ans:" + l].fixed = true;
                paint(links["ans:" + l], CONFIG.correctColor);
            });
            return true;
        }

        function reset() {
            if (!guard()) { return; }
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
        }

        function getState() {
            const out = {};
            Object.keys(links).forEach(function (k) { out[k] = links[k].right; });
            return out;
        }

        function about() {
            return { name: "Click-to-click matching engine", author: ENGINE_AUTHOR,
                     version: ENGINE_VERSION, updated: ENGINE_UPDATED,
                     fingerprint: FINGERPRINT, signatureValid: SIG_OK };
        }

        function destroy() {
            destroyed = true;
            cancelAnimationFrame(rafId);
            clearInterval(timerId);
            document.removeEventListener("click", onClick, true);
            select(null);
            svg.remove();
            if (window.matchingLines && window.matchingLines.destroy === destroy) {
                delete window.matchingLines;
            }
        }

        window.matchingLines = {
            check: check, retry: retry, showAnswers: showAnswers, reset: reset,
            getState: getState, about: about, destroy: destroy
        };

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
        if (!guard()) { return; }
        const cfg = buildConfig(userCfg || window.__matchingPending);
        window.__matchingPending = null;
        if (cfg) { start(cfg); }
    };

    // The slide trigger may have run BEFORE this script: pick it up.
    if (window.__matchingPending) { window.initMatching(); }
})();

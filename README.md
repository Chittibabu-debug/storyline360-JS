# custom-matching

Click-to-click matching interaction for Articulate Storyline 360 (single JavaScript file).

- `matching-master.js` - the engine. Loaded once from the slide master.
- Each slide only sets its pairs, for example:

```js
window.__matchingPending = {
    maxAttempts: 2,
    answers: { left1: "right1", left2: "right2", left3: "right3" }
};
if (window.initMatching) { window.initMatching(); }
```

Full setup notes are at the top of `matching-master.js`.

Created by Chittibabu Kollipara. Please contact Chittibabu Kollipara for any update or change.
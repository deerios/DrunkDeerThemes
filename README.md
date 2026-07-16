# DrunkDeer Themes

Keyboard lighting themes for [DrunkDeer keyboards](https://github.com/deerios/DrunkDeerSDK), shared
by the people who made them.

## Publishing a theme

Use the **Publish** button in the app's theme gallery. It opens a
[new issue](https://github.com/deerios/DrunkDeerThemes/issues/new?template=new-theme.yml) with your
theme already filled in — read it, tick the box, submit.

You will get a comment back within a minute or two: either your theme is published, or the comment
says what is wrong with it. If something is wrong, **edit the issue** rather than opening a new one;
every edit is checked again.

To do it by hand, open the same issue form and paste your theme JSON in yourself. A profile exported
from the app works as it is — only its lighting is published.

## What a theme has to be

- A **name** and a **credit**, each up to 40 characters, and no two themes share a name.
- Lighting that **shows something**. A theme where every key is black is turned away.
- Colours in range: `r`, `g` and `b` from 0 to 255, `brightness` and `baseBrightness` from 0 to 9.
- Keys the SDK knows, by name — `W`, `Space`, `ArrowUp`, `LeftShift` and so on, matched without
  regard to case. The full list is [`tools/lib/keys.json`](tools/lib/keys.json).

```json
{
  "brightness": 9,
  "baseColor": { "r": 0, "g": 40, "b": 120 },
  "baseBrightness": 4,
  "keys": {
    "W": { "r": 255, "g": 120, "b": 0 },
    "A": { "r": 255, "g": 120, "b": 0 }
  }
}
```

`baseColor` is every key that is not named in `keys`. `baseBrightness` dims only the base, in
software, so a background can sit behind brighter keys — the keyboard itself has one brightness for
the whole board, which is what `brightness` sets.

## What is in here

| | |
| --- | --- |
| `themes/<id>.json` | One theme, as published, with the name, the credit and the issue it came from. |
| `index.json` | Every theme in one file, for the gallery to fetch. **Generated** — run `node tools/build-index.mjs`. |
| `tools/lib/` | The rules: reading an issue, checking a theme, building the catalogue. |
| `tools/submit.mjs` | One submission, checked and turned into a theme file. Run by the workflow. |
| `tools/check.mjs` | Everything already in here, checked. Run by CI. |

Nothing here has dependencies; it is Node's standard library and nothing else. Tests:

```sh
node --test "tools/**/*.test.mjs"
```

## How a submission becomes a theme

`.github/workflows/new-theme.yml` runs when an issue labelled `new-theme` is opened or edited:

1. `tools/submit.mjs` reads the issue and checks it.
2. If it does not pass, the issue is labelled **`invalid`** and gets a comment saying why. Editing
   the issue runs all of this again.
3. If it passes, the issue is labelled **`accepted`**, and a pull request adding the theme is opened
   and merged.
4. The issue is labelled **`merged`** and closed.

There is no human in that loop, so **the checks are the only gate** — anything they accept is
published. They are about the shape of a theme, not its taste, and they cannot judge a name. Themes
are removed the same way they arrive: open an issue with the `remove-theme` label.

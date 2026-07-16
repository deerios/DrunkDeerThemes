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

## Changing or removing your own theme

The gallery's **My themes** section has a **Modify** and an **Unpublish** button on each theme you
published. Both open a prefilled issue the same way Publish does, and both are applied automatically.

- **Modify** ([`update-theme.yml`](.github/ISSUE_TEMPLATE/update-theme.yml)) replaces a theme's
  lighting. Its name and credit stay as they are; to rename a theme, unpublish it and publish it
  again, because the name is where the id — and so the file name — comes from.
- **Unpublish** ([`remove-theme.yml`](.github/ISSUE_TEMPLATE/remove-theme.yml)) takes it out of the
  gallery. Anyone who already copied it into a profile of their own keeps their copy, and the file
  stays in this repository's history.

**Only the account that published a theme can do either.** The check is against the GitHub account
that opens the issue, matched against the `submittedBy` recorded in the theme's own file — not
against anything the issue says, which is the submitter's text and proves nothing. If you published
a theme from an account you have lost, open an ordinary issue and a maintainer can sort it out.

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
| `themes/<id>.json` | One theme, as published: the lighting, the name, the credit, the account that submitted it and the issue it came from. `"issue": 0` means it came from no issue. |
| `index.json` | What every theme is *called* — id, name, credit, submitter, issue — and not what any of them looks like. The gallery fetches this once and then `themes/<id>.json` for the themes it is drawing, so a page of cards costs a page of themes rather than all of them. **Generated** — run `node tools/build-index.mjs`. |
| `tools/lib/` | The rules: reading an issue, checking a theme, whose theme it is, building the catalogue. |
| `tools/submit.mjs` | One submission, checked and turned into a theme file. |
| `tools/update.mjs` | One update, checked and written over the theme it names. |
| `tools/unpublish.mjs` | One removal, checked and applied. |
| `tools/check.mjs` | Everything already in here, checked. Run by CI. |

The three scripts are run by the three workflows, which share
[`.github/actions/theme-change`](.github/actions/theme-change/action.yml) — the labelling, the pull
request and the merge are the same job whichever of the three asked for it.

Nothing here has dependencies; it is Node's standard library and nothing else. Tests:

```sh
node --test "tools/**/*.test.mjs"
```

## How a request becomes a change

One workflow per label — `new-theme`, `update-theme`, `remove-theme` — and all three run the same
steps when an issue carrying theirs is opened or edited:

1. The flow's script reads the issue and checks it.
2. If it does not pass, the issue is labelled **`invalid`** and gets a comment saying why. Editing
   the issue runs all of this again.
3. If it passes, the issue is labelled **`accepted`**, and a pull request making the change is opened
   and merged.
4. The issue is labelled **`merged`** and closed.

There is no human in that loop, so **the checks are the only gate** — anything they accept happens.
They are about the shape of a theme and about whose it is, not about its taste, and they cannot judge
a name.

That is why a maintainer deleting `themes/<id>.json` by hand and re-running
`node tools/build-index.mjs` is still the backstop. Unpublishing is automated for *your own* themes;
it is not an answer to somebody else's theme that passes every check and should still not be in the
gallery. Nothing but a person can decide that one.

## A note on `tools/lib/keys.json`

That file is a copy of the `DDKey` enum from
[the SDK](https://github.com/deerios/DrunkDeerSDK/blob/master/DrunkDeer/Keys/DDKey.cs), which is
where key names are really defined. It is a copy because checking a submission here should not mean
building a C# SDK first.

Being a copy, it can fall behind. If the SDK gains a key, this file needs the same key adding or
themes using it will be turned away for a key that exists. It is generated from the enum, in
declaration order, and nothing else in here depends on that order.

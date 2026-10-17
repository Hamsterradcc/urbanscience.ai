# urbanscience.ai

Website of the Urban Science AI Lab. Static site served by GitHub Pages at <https://urbanscience.ai>.

## Site map

| Page | Role |
| --- | --- |
| `index.html` | Identity and agenda: hero, the five research directions, approach, the three platforms, contact |
| `research.html` | The research agenda in full: one section per direction with question, data, and methods |
| `404.html` | Not-found page (served by GitHub Pages) |

Shared assets: `assets/site.css` (one stylesheet for every page) and `assets/site.js` (mobile navigation). No build step and no external dependencies.

## Division of labour between the sites

This site holds the lab's agenda and identity only. Outputs are released elsewhere:

- data, indicators, maps, and methods → <https://urbanprobe.com>
- models, agents, and benchmarks → <https://xurbanai.com>
- community and collaboration → <https://citycomputingcollective.com>

## Reserved sections

Sections that are added only when there is something to list, so the site never shows an empty board:

- **Work** — selected outputs, each linking to its platform entry or publication.
- **Teaching** — courses and learning materials.
- **People** — added when the lab has more than one member.

## Network footer and social card

Every page ends with the network footer: the four sites in the same order (Urban Science AI Lab, UrbanProbe, XUrbanAI, City Computing Collective), each with its role, and the current site marked. Keep the order and wording identical across the four repositories.

`assets/og.png` is the 1200×630 card shown when a page is shared; the `<head>` of each page points to it.

## Editing

Pages share the same header, footer, and `<head>` block. When changing them, change every page. Navigation marks the current page with `aria-current="page"`. Direction anchors on `research.html` are `#representation`, `#perception`, `#mobility`, `#climate`, `#agents`; the index links to them.

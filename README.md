# The World Daily — 24 November 2026

[![news-image-20261124](https://make.fun/badge/news-image-20261124.svg)](https://make.fun/bounty/news-image-20261124)
[![rank](https://make.fun/badge/news-image-20261124/bee6en9/news-image-20261124/rank.svg)](https://make.fun/bounty/news-image-20261124)
[![reward](https://make.fun/badge/news-image-20261124/bee6en9/news-image-20261124/reward.svg)](https://make.fun/bounty/news-image-20261124)

[The World Daily — 24 November 2026](https://make.fun/bounty/news-image-20261124)

One page. One day. Every story dated **Tuesday 24 November 2026**.

A classic newspaper front page summing up the world's news of 24 November 2026:
36 stories from 7 regions, drawn entirely in code. Three lead stories — the
Israeli strikes in Gaza, the Russian strike on Zaporizhzhia, and Asia's stock
rally as Jensen Huang returned to lead Nvidia — plus ten illustrated briefs,
a numbered world map, 23 more stories, and a DATE CHECK box naming the
near-miss stories we deliberately left out (the Abu Dhabi talks, the SpaceX /
Grok lawsuit, COP31, Norway's Supreme Court ruling, the Listyo Sigit charges)
because they did not happen on 24 November.

## How it is made

`main.ts` (Node 22, standard library only, no network) draws `entry.png`
(1024×1024) with a small built-in canvas: flat illustrated scenes per story,
a serif masthead and serif headlines, clean sans decks, a six-number KPI
strip of hard news figures, a seven-region bar, and a bright numbered map.
Text is rendered from `font.json`, a bitmap atlas rasterised from the
Liberation Serif / Liberation Sans faces. The program is deterministic:
two runs write byte-identical PNGs.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Referral

Play code: `vfk2n47z`

# hob.chat

Vercel deploys this directory from `main`. Keep the independent install:

```sh
pnpm install --ignore-workspace --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

The approved marketing page is `content/home.html`, with styles, motion scripts, font, and images in `public/marketing/`. Next prerenders the HTML route at build time. This preserves the reviewed markup and animations without a client React wrapper. The private design-study controls and alternate concepts are excluded.

The hero is a scripted UI reconstruction, not a video or a live model. Its editable source is in `demo/`, pinned to the upstream components listed in `demo/source.json`. After installing the root app dependencies, run `pnpm demo:build` to regenerate `public/marketing/hero-app/index.html` and commit the generated output with the source. The normal website build uses that checked-in output and needs no Electron dependencies.

The demo embeds its CSS, fonts, scripts, and mascot so the sandbox also works on authenticated previews. It respects reduced motion and stops its clock when hidden. The chart values reproduce the recording's bar heights; they are illustrative, not a bundled customer spreadsheet. Timing is condensed for the website.

Download links target GitHub's latest release. They become available when the first installers are published.

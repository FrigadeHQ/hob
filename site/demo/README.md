# Hob hero UI

The hero reconstructs Christian's `HobExample2.mp4` using the actual open-source app UI, pinned in `source.json`. It types the prompt, briefly shows the actual drop zone, attaches `q3-sales.xlsx`, sends, shows the working states, renders the chart, streams the response, and holds the finished result before repeating.

The vendored app files are unchanged and retain their MIT license. `Hero.tsx` follows App/Chat's composition and uses the real Sidebar, Composer, AttachmentChip, Mascot, WorkLog, ChartCard, CopyButton, and starter code. The chart uses the app's Recharts renderer, colors, axes, and export affordance. Its fixture reproduces the four bar heights visible in the recording; it is not the underlying spreadsheet. No customer file is included.

`sequence.ts` defines this single example and its condensed presentation timing. `Demo.tsx` runs it only while the hero is visible, freezes the clock in hidden tabs, and shows the finished result for reduced motion. The 17.2-second loop leaves 6.3 seconds between sending and the chart, including the real Thinking and Running code states, then holds the completed result for 4.2 seconds. There are no visitor controls or live AI calls. The app's `Worked for 33s` label is retained from the recording, not used as a benchmark claim.

`preview-api.ts` provides in-memory sidebar data and the chart fixture. It has no Electron, AI, filesystem, account, or microphone connection. The entire preview is inert and lives in a script-only sandbox, without parent-origin access. A static welcome screen is present before the script loads. The parent page scales the 1280×800 app frame and sends visibility messages.

The build removes Composer's autofocus and makes ChartCard's bar animation respect reduced motion; those two build-time adaptations do not alter the vendored originals. Styles, fonts, mascot images, and the animation bundle are embedded in one HTML document: the opaque-origin sandbox cannot authenticate separate asset requests on the private Site. The other additions are the recorded data, transition choreography, and native window lights.

Build with Node 24 and the app checkout's installed dependencies:

```
node demo/build.cjs /path/to/hob/app/package.json
node checks/site.mjs
node checks/demo.cjs
```

Output is in `public/marketing/hero-app/`. The DOM test exercises the actual React components and chart renderer with mocked geometry; it does not replace visual browser review.

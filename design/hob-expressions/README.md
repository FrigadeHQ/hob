# Hob expression study

This is an expression study outside the shipped app. It reuses the app's body artwork and Hanken font. The app now uses the warm smile, blink, neutral face, raised eyebrow, content smile, wink, and laugh; the other expressions remain here for review.

From the repository root:

```sh
python3 -m http.server 8902 --bind 127.0.0.1
```

Open http://127.0.0.1:8902/design/hob-expressions/.

Choose any of the 14 faces to compare it at setup, welcome, and sidebar sizes. “Setup personality” previews cursor following, idle glances, blinks, smiles, and a raised eyebrow. “Cycle all faces” is for comparing the exploration; it is not app behavior. Appearance can be System, Light, or Dark. Automatic motion respects reduced motion.

The production app rests with a small smile, with occasional neutral moments. Setup and the empty chat follow the cursor and respond to a click: content smile, wink, then laugh, with a raised eyebrow after six quick clicks. A pause resets the sequence. The small sidebar mascot stays quiet and becomes neutral while working. Click reactions also work with Enter or Space; reduced motion keeps a still smile and explicit face changes. No new dependencies or model downloads are needed to view this study.

Big grin and Surprised were removed after review: their exaggerated mouth shapes departed from Hob’s simple expression language. The remaining faces preserve the small square eyes and compact mouth; differences come from the gaze, eyelids, eyebrow, or a small change in the mouth.

![Fourteen Hob expressions, with Curious shown at app sizes](preview.png)

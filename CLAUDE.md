# project-shanni-happy — working notes for Claude

A hands-free, voice-driven build of a small **flat papercraft** game. The user does
not hand-author art or code; everything is programmatic and driven through Claude Code.

## Locked art direction (do not drift)

Flat, minimal, **clean** Paper-Mario papercraft. NOT realistic, NOT anime, NOT noir
(noir was tried and dropped). "High fidelity" to this user = clean execution: no
clutter, no clashing colours, no stray lines/artifacts, calm negative space.

- One base graphic per NPC (chibi, generated in Gemini), static by default. A *few*
  characters add a SMALL set (1–3) of alternate **pose images** for the rare moment the
  drawing itself must change (e.g. Chrees curling a dumbbell). These **hard-swap** —
  instant, no tween, Paper-Mario style. Every pose image of a character shares ONE
  canvas + foot baseline + body scale (registered by `studio/register_poses.py`,
  vision-checked by `studio/qa_vision.py`) so the swap can't resize or unground them.
  Most characters still have exactly one image. See the `papercraft-asset` skill §4.
- ALL motion = the paper cutout physically moving: hop-walk (squash on contact, stretch
  in air, slight lean), jump (squash → launch → airborne → land squash), contact shadow
  that shrinks/fades with height. Personality is in the motion (and, sparingly, a pose
  swap) — **never a tween between two drawings.** (The old "jump-for-joy" celebration +
  pastel sparkles were removed at the user's request — do NOT re-add them.)
- Character **Shen** = `studio/refs/shen-chibi-4.png` (pink bucket hat, round glasses,
  dark braids, dusty-rose jacket over gray tee, cream floral skirt).
- Environments use the same flat pastel paper set (flat bands, soft rounded hills,
  cream die-cut props, contact shadows). See the 6 mood specs in `studio/specs/all.json`.
- **Foreground = model it; texture only flat grain.** In the reachable world (plaza,
  street, stairs, park) build structure as *separate modeled paper pieces* (sign board,
  awning, window frames, door) and keep the kit small (no fussy mullions, brick, or trim).
  Texture carries only flat pastel grain: one small shared seamless tile at a single fixed
  texels-per-metre, big or unique textures are reserved for the unreachable backdrop, and
  every in-world sign sits on its **own die-cut board**, never baked into a wall. Test: if
  you can NAME it (a sign, a window, a door) model it; if you can only FEEL it (grain,
  mottle) texture it. Full how-to lives in the **`papercraft-texture`** skill.

## Renderers (two, by purpose)

- **PIL (`studio/env_render.py`)** — fast 2D iteration. `SceneSpec (data) -> PNG`.
  Used to explore environment concepts quickly. NOT the game engine.
- **Three.js (`studio/*.html`)** — the real renderer. Orthographic camera (flat
  papercraft → no perspective warp). `poseAt(t)` is a pure deterministic pose function.

### Three.js gotcha — preview playback

The Claude preview renders pages as a **background tab where `requestAnimationFrame`
is suspended** (frozen frame). Drive real-time playback with a `setInterval` clock
keyed off `performance.now()` instead (see `env-live.html` `__startAuto`). The shoot
scripts call `__stopAuto()` then `__render(t)` for deterministic capture.

## Sound — every interaction makes a sound (do not ship silent interactions)

**The rule:** if the player does something, or the world reacts to them, it is **audible.**
Any new interaction — a new collectible, NPC action, button, door, quest beat, menu, screen
transition — **ships its sound effect in the same change that adds it.** A silent interaction
is a bug, not a "later." Stay on-aesthetic: soft, warm, calm pastel — never harsh or loud (the
master chain caps level, but still pick gentle params). Like the art, personality lives in
motion + sound, not in louder.

**The second rule: world sounds are spatial.** A sound that comes from a *place* in the world
— an NPC's animation loop, an ambient prop, a distant event — **must be attenuated by the
player's distance to it**: full only when the player is near, fading with distance, and **not
fired at all** once they're far. A world sound audible across the whole map is a bug, exactly
like a silent interaction is. (Player-centric sounds — the player's own footsteps / jumps —
and UI / dialogue sounds are *not* spatial; they play full.) Mechanism: pass a 0..1
multiplier to `Sound.sfx(name, mul)`; `proxGain(x,z)` in `game.html` is the standard rolloff
(full ≤~2.5u, squared falloff to silent ~9u, skips the call past the edge). **When you add any
sound, ask: does it come from a spot in the world? If yes, gate it through `proxGain` in the
same change** — same reflex as shipping its sound at all.

**The third rule: sound is CONTEXTUAL to the space (right sound, right loudness).** A sound must
MATCH its source — never reuse a sound just because it's wired up. (Christopher flagged this: the
fish tanks used the **fountain water** ambient — wrong identity AND wrong level, "fountains are
obviously louder than fish"; "remember this general concept, not this exact example.") So pick the
SFX that fits the object and scale its base level to how loud that object really is — a fish tank is
a soft `bubble` (its own `CFG.sfx` level), quieter than a fountain, not the fountain rush. **Music
is per-scene/contextual too:** each scene declares a `music` track (`spec.music`). The **overworld
track is EXCLUSIVE to the overworld**; an interior gets its own track, OR one **shared across like
rooms** (e.g. every pet-shop-style indoor can share one indoor loop). `Sound.startMusic(url)`
switches on a scene change — it crossfades to a DIFFERENT url, no-ops (keeps looping) for the SAME
url, and caches each decoded buffer by url (returning is instant); it tracks the PLAYING url
separately so it never stops the old track without starting the new (the "music gone / wrong song
everywhere" bug). `game.html`'s `buildScene` calls it on every scene build; `beginGame` starts the
boot scene's track; never let one scene's music bleed into another. When you add a room, pick (or
reuse) its music + ambient SFX to fit that space — same reflex as the two rules above.

**The system:** all **SFX + the dialogue voice** are **procedural Web Audio**, synthesized at
play time in `studio/js/audio.js` — **no asset files for those** (same ethos as the art:
programmatic, no hand-authoring). The module exports `Sound`; it's already wired into
`game.html`, so new sounds plug into existing seams rather than new plumbing. The one
**exception is background music** — a single seamless ~26s loop **generated programmatically
with MusicGen** (`gen_music.py` + `make_loop.py`, NOT hand-authored) and committed as one small
OGG (`out/music/calm.ogg`), because real-time music synthesis isn't practical. It plays through a
**music sub-bus** under the master, so the volume slider + mute already scale it.

- **Add a new SFX:** write a tiny synth fn in the `SFX` map in `audio.js` (use the `note()`
  and `noise()` helpers; set its level in `CFG.sfx`), then trigger it with `Sound.sfx('name')`.
- **Trigger it — two patterns, pick by where the event lives:**
  1. **Sim-driven** (emerges from the deterministic sim/physics: footsteps, jump, land,
     hamster pickup `squeak`) → detect the **state transition** in `audioStep(s)` in `game.html`,
     comparing against `aprev` (mode / onGround / walkPhase). It runs every fixed step, so fire on
     the *edge* (changed-since-last), never every frame.
  2. **Discrete UI/events** (menus, buttons, dialogue, transitions) → call `Sound.sfx('name')`
     right at the event site, or wire a `Dialogue.on*` hook (`onReveal`, `onChoiceOpen/Move/Pick`,
     `onLine`, `onEnd`) in `game.html`.
- **Positional sounds are proximity-gated** — see the "world sounds are spatial" rule above; any
  world-anchored sound goes through `proxGain` (Chrees' rep `lift` does), with the multiplier passed
  to `Sound.sfx(name, mul)`.
- **Dialogue voice:** the Charlie-Brown muted-brass "wah" is `Sound.blip(ch, speaker)`, one per
  revealed glyph (fired from `Dialogue.onReveal`). A new speaker gets its timbre in `VOICES`.
- **Gesture gate:** browsers block audio until a user gesture — `Sound.resume()` is already
  wired to the title **Start** / first key / first tap, so new triggers don't handle it.
- **Background music:** `Sound.startMusic(url, autoplay=true)` (called from `beginGame()`,
  after the gesture) fetches+decodes once and loops a single `AudioBufferSourceNode` (gapless —
  NOT an `<audio>` element) through the music sub-bus. **Auto-plays only on a real deploy:**
  `beginGame` passes `BUILD!=='dev'`, so the loop starts itself on GitHub Pages (where `build.json`
  exists → `BUILD` is a git sha) but stays **silent in a local dev worktree** (no `build.json` →
  `BUILD==='dev'`). `autoplay=false` only *arms* the track (sets URL + preloads); the music slider
  (`setMusicVolume`) still starts it on demand, so it isn't a dead control in dev. `Sound.stopMusic()` /
  `Sound.setMusicVolume(0..1)` (0 = off) / `Sound.toggleMusic()`; the **music** pause-menu slider
  drives it, persisted to `shen.musicvol` (own key — NOT in the save blob). Decode failure degrades
  to "no music", never a crash.
- **⚠️ Background music MUST loop seamlessly — every time, no exceptions.** A loop with an audible
  seam/click/gap is a bug, not "good enough." MusicGen (and most generators) do NOT loop natively,
  so you always run the loop step: render a little long (~30s), then `make_loop.py` does an
  **equal-power crossfade of the tail back over the head** so the wrap lands on two
  originally-consecutive samples (no click) with a continuous envelope (no level jump). NEVER commit
  a raw generated clip as the loop. **VERIFY the seam** before shipping (don't trust your ear over a
  background tab): decode the OGG in an `OfflineAudioContext` and check the wrap discontinuity
  `|x[0]-x[N-1]|` sits within the clip's own adjacent-sample-delta distribution (well under its max)
  — that's a numeric proof the loop is gapless. To make a NEW loop, follow the `gen_music.py` →
  `make_loop.py` flow in `requirements-music.txt`. **⚠️ Pick the seed by LOOP-CLEANLINESS, not only
  by `make_loop.py --analyze`'s "calmest" score.** The OGG wrap is decoder-dependent: a brighter /
  busier clip (higher centroid + `max_delta`) leaves a vorbis+resample seam at the loop point even
  though it's seamless at the source rate — for `shop.ogg`, the analyzer's "fewest-transients" pick
  (seed 2) had a browser wrap **1.78× p99.9** (a real seam) while the mellower seed 0 was **0.01×**
  (perfect). Build a loop from EACH seed, decode each in the browser, and pick the lowest
  `wrap/p999` (mellower clips also fit cozy interiors better).
- **Three independent levels, all automatic** — **master** "volume" + mute (`shen.vol`/`shen.muted`,
  scales everything), **effects** (`shen.sfxvol`, the SFX+voice sub-bus), **music** (`shen.musicvol`,
  the music sub-bus). Each has its own pause-menu slider. Never gate or scale a sound yourself —
  SFX/`blip` route through the effects sub-bus and music through the music sub-bus, both under the
  master, so just call `Sound.sfx` / `Sound.blip` / `Sound.startMusic` and the sliders cover it.
- **Verify in preview** (don't assume): spy on `Sound.sfx` / `Sound.blip`, drive the interaction,
  assert the event fired the sound, console clean. (Exactly how the audio work verified
  step/collect/blip — wrap the fn, push calls to a log, read it back.) `Sound` is on
  `window.audio` for spying. The reusable version is **`node studio/qa_audio.mjs`** (fresh
  headless context, no module-cache trap): it spies on `window.audio` to assert the tanks emit
  `bubble` (not the fountain `setWaterLevel`) and that music is per-scene (calm→shop→calm across
  the door). Add an assert there when you add a contextual sound.

## Cutscenes — scripted Paper-Mario set-pieces (the world plays itself)

A cutscene is a **beat timeline** played by `studio/js/cutscene.js` (`Cutscene`) — a generic,
UI/scene-agnostic sequencer (same ethos as `dialogue.js`/`quests.js`). game.html supplies the
staging; the engine just keeps time. During a cutscene the player **cannot move** — input is
locked, the camera is a **director camera**, and the world is "played out" until each little
dialogue box is dismissed with **Next**, then the next set-piece runs. Exactly like Paper Mario.

- **A beat** is `{ dur?, ease?, hold?, until?, start?, update?(u,dt), end? }`. Pick a completion
  rule: `dur` (timed, auto-advance; `update` gets eased `u` 0..1), `hold` (wait for Next), `until`
  (wait for a predicate — used for dialogue: `until:()=>!Dialogue.active`), or none (instant). `dur`
  + `until` together = a timed beat with an EARLY-OUT (the knockover runs with a `dur` cap but ends
  the instant the last hamster clears the door — `until:()=>allHamstersGone` — so there is NEVER a
  dead hold on the empty door). Author concurrency by driving several things in one beat's `update`
  (camera dollies WHILE Shen walks WHILE the hamsters scatter) — there is no separate group primitive.
- **Director camera:** beats write `Cutscene.cam = lookCam({tx,ty,tz,yaw,pitch,dist,fov})` (the same
  target+orbit+dolly convention as `window.__look`); `applyDirectorCam()` points the real camera at
  it each frame. Tween shots by lerping the look PARAMS (`lerpLook`) so it arcs+dollies, not a
  straight slide. On end, `CAMRIG` is seeded from the last shot so the normal zone camera eases back
  in (no pop). Cinematic framing is allowed here — the gameplay framing-QA floor (`CAM_MIN_FRAC`/
  `CAM_MAX_PITCH`) only governs the live zone cameras, not a cutscene.
- **Emotion = MOTION, never a tween between drawings** (the locked art rule still holds). A held
  `mood` (`moodOffset`: fluster/fret/perk/idle) + a decaying one-shot `impulse` (`applyImpulse`:
  stumble/startle/nod) layer additive squash/lean/hop offsets onto Shen (`csShen`) and an NPC
  (`o.emote`), applied in draw()/the npc loop ON TOP of the normal pose. (If a character ever needs a
  genuinely different drawing for a beat, that is a `poses` hard-swap via the asset pipeline — but
  prefer motion.)
- **Pacing + LOOPING (player-paced, easy to follow) — a standing rule for every cutscene.** Nothing
  rushes and nothing freezes. A bustling world element does NOT play once and then sit on an empty
  frame waiting; it **LOOPS continuously while a dialogue line holds**, and only **resolves when the
  player advances the CUE line**. The pet-shop hamsters model this: they spill out, then *scurry
  around the whole shop on autonomous wandering loops* (mode `perch`→`loose`→`flee`→`gone`, driven
  every frame in `updateCutsceneHamsters` — the beats only TRIGGER transitions, never freeze) the
  entire time Shen + Adrian react, and only **bolt for the door when the player advances past
  "there they go!"** (`fleeHamsters()`). Give the reader a beat to take it in (a held wide of the
  chaos), keep motion legible (a tight readable PACK or clear individual scurrying, not a fast blur),
  and end an action shot the moment the action leaves frame (`dur` + `until` early-out). When you
  build a cutscene, make these calls deliberately: what loops, what's the cue, how slow is "easy to
  follow."
- **No IMPOSSIBLE MOVEMENT — actors never pass THROUGH solid props.** Shen walks UP TO the table and
  BUMPS it (stops at contact), she does not clip through it. Author the approach so the path doesn't
  cross a standing prop's footprint (the pet-shop walk goes forward into the open floor first, THEN
  turns to the table). Guarded deterministically: `__csReport().clip` counts frames where Shen's
  footprint centre is inside a still-standing prop (`csTableBox`), asserted `0` — review the whole
  animation, not just keyframes, for any move that should be impossible.
- **Cutscene props: SWEEP what's transient, KEEP what's a consequence.** Every object a cutscene
  spawns is tagged `userData.csProp`; `endCutscene` sweeps all *remaining* csProp objects (generic, so
  a future cutscene that forgets can't leave junk in the world) and `window.__csProps().lingering`
  must be empty outside a cutscene. But a prop that should PERSIST as a consequence (the knocked-over
  table — Shen tipped it, it stays) is **converted to a permanent fixture** at the end (un-tag csProp,
  set `userData.fx`) AND **rebuilt on every later entry** by the scene builder gated on the cutscene
  being seen (petshop: `cutsceneTable` spec field → `buildInterior` builds the pre-tipped remnant when
  `seenCutscenes` has it). A persistent remnant that occupies floor space is a **SOLID obstacle** — give
  it a collider matching its (tipped) footprint (`addTippedTableCollider`: a `Box3` of the tipped group
  → `pushBoxColliders`), added BOTH on conversion (`endCutscene` → `SCENE_COLLIDERS`) and on the
  `buildInterior` rebuild (via `opts.cols`), so the player walks AROUND it, not through it. Size it so it
  never walls off the room (`cameraQA.reach()` stays clean). `scenarios/cutscene-persistence.mjs` asserts
  the remnant is present + SOLID + impassable after AND on re-entry, and `__clips()` stays empty.
- **Sound:** a cutscene ships its SFX in the same change (every interaction is audible). Its focal,
  camera-driven SFX (`knock`, `scurry`, hamster `squeak`) play **full** — they are the thing the
  camera is showing, like a Paper-Mario hit, NOT an ambient world loop, so the "world sounds are
  spatial" rolloff does NOT apply. Music stays per-scene (the shop track plays under the pet-shop
  cutscene). New speakers get a `VOICES` timbre (added Adrian).
- **Triggering + once-only (a cutscene happens ONCE — mark it seen at START, not end):** a scene
  names its first-visit cutscene with a top-level `"cutscene"` id in its spec. `maybeArmCutscene()`
  (called on a REAL entry — a finished door transition + boot Continue, NOT the debug `game.enter`
  teleport) arms it when `!seenCutscenes.has(id)`; the frame loop starts it. **Mark it SEEN + `persist()`
  the MOMENT it begins** (in `startPendingCutscene`, before any line plays) — NOT only in `endCutscene`.
  Why: the autosave (10s interval / `visibilitychange` / `pagehide`) fires *mid-cutscene*, so if seen is
  marked only at the end, a reload / tab-close mid-cutscene writes `scene=<here>, cutscenes=[]`, and the
  next Continue lands back in the scene with an empty seen-set and **re-arms it → it replays on every
  entry** (the exact "plays every time" bug Christopher hit on the shipped build). Once it has BEGUN it's
  done; the quest still starts at its beat on normal completion, and if interrupted Adrian re-offers it in
  dialogue. Seen ids persist in the save (`cutscenes` array — **additive, no `SAVE_VERSION` bump**); a New
  Game clears them so it replays. A **quest-giving** cutscene also skips+marks-seen if its quest is
  already underway (an old save that got the quest the previous way must NOT replay the intro mid-quest).
  Guarded by `scenarios/cutscene-persistence.mjs` (seen-at-start + autosave-then-reload-then-Continue = no
  replay). **This is the default for ALL one-time cutscenes**, not just the pet-shop one.
- **The pet-shop intro (`cs_petshop_intro`):** first time you enter the shop — Adrian greets, Shen
  ambles to a display table and **walks right into it**, knocking it over; **5 hamsters spill out and
  scurry around the whole shop** while she + Adrian react (Shen mortified, Adrian flustered), and on
  the player's cue ("there they go!") **they bolt out the door**; then the **Hamster Roundup quest
  starts here** (not from dialogue anymore — Adrian's old offer tree is a debug-only fallback). The
  table + cutscene hamsters are PROCEDURAL (built at cutscene start); the **hamsters are swept** at the
  end but the **knocked-over table STAYS** (converted to a persistent fixture + rebuilt on re-entry —
  she tipped it, it remains). **Town hamsters are GATED** on the quest being active
  (`activeCollectibles` filters them) — they don't exist anywhere until they "escape" in the
  cutscene; `initState` + `buildCollectibles` use the same gated list so `S.collectibles` ↔
  `pickups[]` stay index-aligned.
- **Camera shots MUST track the actor, never a hardcoded point.** A character shot whose target is
  a fixed coordinate frames empty floor the moment the actor isn't exactly there ("the camera zoomed
  in on someone who isn't there"). Author character shots as RUNTIME functions of the live position
  (`shenCU`/`adrianCU`/`twoShot` return `()=>({tx:S.x,…})`); the walk FOLLOWS Shen. Reserve fixed
  look-specs for genuinely static spots (establishing / the table / the door). Tag every camera/say
  beat with a `subject` ('shen'|'adrian'|'two'|'table'|'hamsters'|'wide') — the framing trace asserts
  that subject is actually on-screen.
- **No dead holds — and whip the transitions.** End an action shot the moment its action leaves
  frame (an `until` early-out cuts the instant the last hamster clears the door). The recurring
  offender is the *transition pan* from a now-empty action spot (the door) to the next subject: it
  lingers on empty floor. FIX: give that `camTo` an EASE-OUT (`u=>1-(1-u)**3`) so the camera whips off
  the empty space fast. (A frozen still of a moving camera mid-pan reads "empty" but plays fine — the
  real-time sweep over-flags these; see the two-tier QA note.)
- **Framing TWO actors in a small room (the head-stacking trap — generalize this).** With one actor
  behind the other (e.g. a clerk at the back counter behind the customer), a solo close-up keeps
  catching the bystander's head over the subject. **Lateral x-separation does NOT fix it** — a FAR
  bystander projects toward frame-CENTRE regardless of their x, so moving them sideways just slides
  them behind the subject's head. What excludes them is the camera ANGLE, three ways (pick per scene):
  (1) **shoot the subject from the side the bystander ISN'T** — stage the subject to one side, then yaw
  the camera so the through-subject sightline points AWAY from the bystander (subject LEFT → shoot from
  their RIGHT, +yaw, so the background is the far-left wall); (2) a **high-angle** close-up (`pitch`
  ~25–34) frames the subject against the FLOOR and pushes the back wall + bystander up out of frame
  (a high angle also suits a sheepish beat); (3) **opposite-side staging** so the two are a clean
  shot-reverse-shot. Two far-apart actors never make a good two-shot (both tiny, empty middle) — prefer
  single-subject shots. Guarded by `__csReport().bystanderInCU` (the bystander's HEAD clearly inside a
  CU = 0; gate it on a real close-up, not a wide two-shot).
- **Sprite scale is a MULTIPLIER (~1.0), never the sprite's own width/height** — setting a billboard's
  `scale` to its W×H shrinks it to ~0.4× ("the hamster shrunk"). Squash/stretch is `scale.set(~1, ~1)`.
- **Per-frame framing TRACE + deterministic FILMSTRIP = the permanent "go scene by scene" guard.**
  Every cutscene frame records the beat's `subject`, whether it's framed (Shen/Adrian/both/hamsters
  on-screen), Shen's on-screen SIZE, the camera eye + frame-to-frame JUMP, and the min hamster
  run-scale. `window.__csReport()` reduces it to violations the scenario asserts on. **Sample the
  TWEENS, not just keyframes:** `window.__csStep(1/30)` is a deterministic frame-stepper (stop the
  auto loop, then step + screenshot) that auto-advances dialogue — the scenario's "filmstrip" pass
  drives the WHOLE cutscene at a fixed dt so mid-animation weirdness is caught (a camera POP = a big
  per-frame `maxJump`; the camera swinging through a wall = `camBad`; an empty/clipped subject; a
  shrunk hamster; an escape that never reads). Framing is judged only while a dialogue line is
  showing (`dlg`), so camera TRANSITIONS aren't false-flagged; `maxJump`/`camBad` are asserted only
  in the deterministic stepped pass (fixed dt → a smooth tween is small per-frame).
- **Adding a cutscene:** write a `buildXxx()` in game.html returning a beat array (close over the
  scene objects), wire it in `startPendingCutscene`, name it in the scene spec's `cutscene` field,
  and ship its SFX. **QA (do ALL):** the deterministic check (`studio/qa/checks/cutscene.mjs`, via
  `window.__cutscene()` — engine wired + gating) AND the real-path scenario
  (`studio/qa/scenarios/cutscene.mjs`) which runs TWO passes — a **stepped FILMSTRIP** (`__csStep`,
  fixed dt, dense tween screenshots + asserts `maxJump`/`camBad`/framing/escape/scale) and a
  **real-time** path (door entry; asserts input-lock, quest start, seen-flag, table teardown, SFX
  fired, gating flips, no replay) — THEN the multi-agent visual sweep over the captured frames
  (adversarially verified) which catches edge-clips / dead holds / awkward head-stacking / artifacts
  the trace can't. **When iterating on look + feel, also self-`/grill-me`** the cutscene (pacing,
  emotion readability, camera language, charm) and act on it. Debug surface: `game.cutscene()` /
  `game.csNext()` / `game.csSkip()` / `game.playCutscene()`, probes `window.__cutscene()` /
  `window.__csReport()` / `window.__csTrace()` / `window.__csStep()` / `window.__csHam()` / `window.__csProps()`.
- **The two-tier QA — what each catches, which to trust.** (1) The **deterministic stepped pass**
  (`__csStep` + `__csReport`) samples EVERY tween frame at a fixed dt and is AUTHORITATIVE for held
  framing + physics (subject framed, no pop / wall-clip / prop-clip, no shrink, no head-stack); a green
  `__csReport` is the floor. (2) The **multi-agent visual sweep** over real-time stills catches
  composition the trace can't (dead holds, edge-crowding, awkward overlap, stray artifacts) — but it
  OVER-flags transient *transition* stills (a frozen mid-pan looks "empty"/"wrong" yet plays fine), so
  weigh severity: a defect on a HELD beat is real; one on a 1–2-frame camera move is the whip-it-faster
  fix (ease-out), not a redesign. Run the sweep ITERATIVELY — it CONVERGES (this set-piece went 8→3→1
  confirmed across runs); each pass, fix the worst + re-shoot. Trust the deterministic guard over the
  sweep's synthesizer when they disagree (same as env-QA `__camAbyss` vs the fog false-read).
- **New-cutscene CHECKLIST (the lessons, generalized — do every item, promote any NEW problem to a
  `__csReport` metric so it's caught forever):**
  - *Build:* beats with ONE completion rule (`dur`/`hold`/`until`/instant; `dur`+`until` = early-out);
    camera tracks ACTORS via runtime fns, never hardcoded coords; emotion = MOTION (mood + impulse) and
    make it READ; pacing is player-paced — world elements LOOP during dialogue + resolve on the player's
    CUE (autonomous, beats only trigger); ship SFX + per-scene music; once-only on a REAL entry + save
    the seen-flag + gate spawned collectibles; SWEEP transient props, CONVERT consequence props to
    fixtures + rebuild on re-entry.
  - *Per-frame invariants (`__csReport`, all asserted by the scenario, all must be clean):* `shenOff`/
    `adrianOff` 0 (speaker framed while a line shows) · `shenTiny`/`shenHuge` 0 · `bystanderInCU` 0
    (no head-stack — ANGLE not lateral) · `hamMax` ≥ peak (action reads) · `hamMinScale` ≳0.6 (no
    shrink) · `maxJump` small (no camera POP) · `camBad` 0 (camera never through a wall) · `clip` 0
    (no actor THROUGH a solid prop — bump, don't pass through) · `__csProps().lingering` empty.
  - *Run before deploy:* `qa_audit.mjs` → `scenarios/cutscene.mjs` (stepped filmstrip + real-time) →
    the multi-agent sweep (iterate to convergence) → self-`/grill-me` for feel → eyeball the dense
    filmstrip + any remnant.

## How to run

```sh
python3 -m venv studio/.venv && studio/.venv/bin/pip install -r studio/requirements.txt
npm install && npx playwright install chromium   # once per worktree — the QA scripts + Stop hook need it
.claude/serve.sh            # prints http://localhost:<port>/game.html for THIS worktree
```
The `npm`/playwright step powers `studio/qa_audit.mjs`, `studio/qa_shots.mjs`, and
`test/smoke.mjs` (all headless-Chromium). The committed **Stop hook** won't let a turn end
with un-audited world changes, and clearing it runs `qa_audit.mjs` — so without playwright
local QA can't pass. (See the **QA reflex** section.)
Then `preview_start` the **`game`** config and open the printed URL (e.g.
`/game.html` or `/env-live.html`). The asset pipeline is the `papercraft-asset`
skill (`.claude/skills/papercraft-asset/`).

### Showing the user something — ALWAYS via per-worktree localhost, never `file://`

Christopher works in **git worktrees** and needs to view *this* worktree's version of
the game, not the main checkout's. A raw `file://` path also can't actually run the
game (ES modules + `fetch` are CORS-blocked off `file://`). So whenever you want him to
look at the game (or any `studio/` page):

1. Run `.claude/serve.sh` — it writes a **git-ignored** `.claude/launch.json` pointed at
   *this* worktree's `studio/` and prints the URL. Each worktree gets its **own
   deterministic port** (base derived from the worktree path, first free port up), so
   multiple worktrees serve their own game side-by-side; the URL is stable once chosen.
2. `preview_start` the **`game`** config (this is also what you use to verify changes).
3. Give him the full `http://localhost:<port>/game.html` link — and **repeat that exact
   link every time** you point him at something, so he never has to scroll back for it.

`/done` tears the server down (`.claude/serve.sh stop` + `preview_stop`).

## Workflow: deploy & done (PR-based — never push to `main`)

Work happens in **git worktrees** (one per session/chat), each on its own branch.
`main` is **branch-protected**: it only accepts changes through a pull request that
passes the **`smoke`** check. Do NOT `git push origin main` (or `HEAD:main`) — that's
how work has accidentally landed on `main` before. Multiple sessions run at once, so
always `git fetch origin main` and check for peers before acting.

- **`/deploy`** = go live. Commit on the worktree branch → `git push -u origin HEAD` →
  open a PR (`gh pr create --base main`) → wait for `smoke` green (`gh pr checks --watch`)
  → if `BEHIND`, read the incoming diff then `gh pr update-branch` → squash-merge
  (`gh pr merge --squash --delete-branch`). Merging `main` triggers the Pages deploy
  (`deploy.yml`). After merge, the worktree branch is **refreshed to merged `main`**
  (`git reset --hard origin/main`) and you keep working in the same worktree; the next
  `/deploy` opens a fresh PR off the same branch name.
- **`/done`** = close out the worktree. Resolve pending work (offer `/deploy`), confirm
  the branch landed on `main` via its PR, sync the primary checkout, tear down the worktree.
- **CI**: `ci.yml` runs the `smoke` job on every PR — assembles the site and loads
  `game.html` in headless Chromium asserting `window.__ready` + no errors
  (`test/smoke.mjs`, uses `playwright`). This is the required check that gates merges.

## Conventions

- Python tooling lives in `studio/`, computes paths from `__file__` (repo-relative).
- Generated assets land in `studio/out/`. Keep the committed art (`shen-cut`,
  `shen-paper`, `env-bg`, concept sheets); intermediate frame dirs are git-ignored.
- Secrets: image gen uses the Gemini key from 1Password; **never commit keys**.
  `studio/.exec` is a machine-specific chrome path (git-ignored).
- `.claude/launch.json` is **generated per-worktree by `.claude/serve.sh` and
  git-ignored** (holds this worktree's unique port + absolute `studio/` path) — never
  commit it or hardcode a port.

## QA reflex — a problem pointed out ONCE becomes a permanent check (not optional)

Christopher reports a visual/world/interaction problem **once**. He should never have to
report the same *class* of problem twice. When he points one out, the job is not just to fix
*that instance* — it is to make sure that kind of defect is **caught automatically, forever,
before anything is ever called done.** This is the standing reflex; treat every bug report as
"add a permanent check," not "patch this spot."

**The four-step reflex — do all four, every time he flags something:**
1. **Fix** the instance he pointed at.
2. **Generalize** it to the class. "This hamster sits on the centre-line and freezes me" →
   "no pickup may sit on a forced corridor." "These two shops flicker where they touch" →
   "no two footprints overlap." Name the *category*, not the coordinate.
3. **Promote it to a check — prefer DETERMINISTIC code over an eyeball.** This is the most
   important step and the one that keeps the system from rotting:
   - **If it can be detected in code (geometry, reachability, framing, boot), write a
     deterministic assertion** that fails loudly — like `window.__overlaps()` or
     `cameraQA.reach()`. Add it as **a new file in `studio/qa/checks/`** (auto-discovered by
     `qa_audit.mjs` — no central file to edit, so branches never conflict; add a `window.__*`
     probe in `game.html` if the check needs one). Write it **generically** — "no overlaps in
     general", never "this one example". Code never forgets, runs in seconds, gates
     automatically. **Always try this first.** See `studio/qa/README.md`.
   - **Only if it is genuinely subjective** (colour clash, "reads as the wrong object",
     "looks web-ish") does it go into the **visual sweep as a NAMED line** — append it to the
     `TAXONOMY` in `.claude/skills/papercraft-env-qa/visual-qa.workflow.js` and the
     recurring-failure-modes table below, as "we were burned by X — specifically check X." A
     generic "look for clipping" is weaker than a named past failure.
4. **Record it** — the failure-modes table in the World/asset QA gate section below + a
   `feedback` memory, so it survives across sessions. See [[shanni-world-qa-gate]] and
   [[shanni-qa-capture-reflex]].

**Two tiers of QA, and the gate runs them automatically:**
- **Deterministic audit (fast, always-correct, never forgets):** `node studio/qa_audit.mjs`
  is a thin runner over an **auto-discovered registry** — every `studio/qa/checks/*.mjs`
  (boot, geometry, reachability, camera framing/visibility today). **Exit 1 on any failure**;
  on a clean pass it writes `.claude/.qa-stamp` (the world-file hash). Runs on **every**
  world-touching change — it is cheap. New deterministic checks are **new files** in
  `studio/qa/checks/`. All QA scripts boot via the shared `studio/qa/harness.mjs`
  (`withGamePage`, free port — never copy-paste a server or hardcode a port).
- **Visual sweep (needs EYES — screenshots, seriously looked at):** `node studio/qa_shots.mjs`
  (full screenshot battery + per-object close-ups, exit-coded + stamps) → the **multi-agent
  picture sweep** (`/papercraft-env-qa`). **The best way to catch a visual problem is to take
  a screenshot and actually study it** — a deterministic check is NOT a substitute for
  looking. Run this for **any** visual/world change (not deploy-only) and **always** before
  `/deploy` + `/done`. This is the "really big sub-agent QA run" — scale it up freely;
  thoroughness over brevity. Full contract + how to add checks/scenarios: `studio/qa/README.md`.
  - **For ANYTHING ANIMATED, sample the in-between (TWEEN) frames, not just start/end states.**
    Most animation bugs (a camera pop, an actor clipping through a prop, a sprite shrinking, a dead
    hold on empty space) live BETWEEN keyframes and are invisible if you only check the static
    before/after. The strongest guard is a **deterministic frame-stepper that drives the whole
    animation at a fixed dt and asserts per-frame invariants** — see the cutscene `window.__csStep` +
    `window.__csReport` (it turned every "looks weird mid-motion" report into a permanent metric).
    Build the same shape for any future animated system. The multi-agent sweep then judges the dense
    frames — but it OVER-flags transient transition stills, so trust the deterministic per-frame
    guard over a single frozen still (see the Cutscenes "two-tier QA" note).

**The hard gate (enforced, not just documented):** a committed **Stop hook**
(`.claude/settings.json` → `.claude/hooks/qa-gate.mjs`) refuses to let a turn end while
`studio/game.html`, `studio/specs/world.json`, or `studio/js/*` are **dirty vs `HEAD` AND
have not passed the deterministic audit since the last edit** (it compares the live world
hash to `.claude/.qa-stamp`). The hook is instant — it never launches a browser, it just
checks git + the stamp. **To clear a block: run `node studio/qa_audit.mjs`** (fix anything it
reports; it re-stamps on a clean pass). The hook fails *open* on any internal error, so it can
never wedge a session, and it self-limits to one block per stop via `stop_hook_active`. The
shared world-file list + hash live in `.claude/hooks/qa-lib.mjs` (imported by both the audit
and the hook so they can't drift). See [[shanni-qa-capture-reflex]].

## Cameras — ALWAYS QA them (not optional)

Whenever you add, move, or tune a camera/zone, you MUST run the camera QA as part of
building it — it is part of "done", not a follow-up. Invoke the **`/zone-camera`** skill
(`.claude/skills/zone-camera/`) and enforce its cardinal rule:

> **Shen must be visible from every reachable spot and through every transition.**

But **visible is the floor, not the goal** — also enforce the **framing rules**:
> **Shen is never a tiny dot (≥ ~13% of the screen, AIM ~15%+), and never looked
> down on top-down (3/4 view, angle ≤ ~32°).** She sits BEHIND and slightly above,
> not overhead. For an open area where she'd drift far, DON'T zoom out — keep the camera
> close and use a zone **`trackWid`** so the eye follows her across the field (constant
> size). The hard floor/ceiling are `CAM_MIN_FRAC` / `CAM_MAX_PITCH` in `game.html`.

Three design rules: **one fixed camera per zone** (never vary the angle by travel
direction — that flips the eye into a wall on reversal), **contain the player** so
every reachable spot is inside a zone, and **keep her big + low-angle** (small-ish
`back`, `height` ≲ ~0.7×`back`; pulling `back` way out to flatten the angle is the trap
that shrinks her and walks the eye into neighbouring buildings).

Workflow every time: author the camera → serve the worktree on localhost (never
`file://`) → in the preview run `cameraQA.static()` (visibility) AND `cameraQA.framing()`
(size + angle; reports `minSize`/`maxPitch`), `cameraQA.transition([a],[b])` for
cross-junction pairs, AND `cameraQA.path([...])` for **round-trips** (down a road and
back, up the stairs and back — reversals hit transitions a one-way sweep misses; they
also catch a blend grazing a building that `static` won't) → `cameraQA.warp(x,z)` +
screenshot any failure → fix → re-run until **0 failures** on both. (The occlusion
check raycasts BUILDINGS only, so eyeball prop-heavy areas — a tree between camera and
Shen won't be flagged.) A camera change with unrun or failing QA is not finished.
Reference + harness: `studio/test-scene.html`.

## World/asset QA gate — RUN EVERY PUSH that touches a world or asset (not optional)

Whenever you add/move/retexture buildings, props, surfaces, terrain, colliders, or a new
asset, you MUST run this gate before calling it done / before `/deploy`. `/zone-camera`
proves Shen is *visible*; it does NOT prove the world *looks right* or is *traversable*.
These bugs recur every build — audit for ALL of them, every time. Full how-to +
detection commands + root-cause code refs live in the **`/papercraft-env-qa`** skill
(this is the standing summary so it's not forgotten between sessions).

**The gate (all must pass):**
0. `node studio/qa_audit.mjs` → the fast deterministic audit (boot + `__overlaps` + `reach`
   + `framing` + `static`), **exit 0 = clean** (and it stamps `.claude/.qa-stamp`, clearing
   the Stop hook). This is the always-run floor; run it after every world edit. The steps
   below are the heavy battery on top of it.
1. `node test/smoke.mjs studio` → green (boots, no JS errors).
2. `node studio/qa_shots.mjs` → captures the zone battery + flicker pairs + a **per-object
   close-up of EVERY placed prop & building** (`studio/out/qa/props/`) AND prints
   **`✓ geometry audit clean`** (`window.__overlaps()`=`[]` and `cameraQA.reach()` all
   reachable). Footprint overlaps = z-fight/clipping; unreachable = a wall blocks a route.
   **Every single thing placed in a session must be screenshotted and looked at** — zone
   shots hide per-object defects (a barrier that reads as a bench, a prop facing wrong, a
   shrub clipping a wall). Inspect the `props/` close-ups, not just the wide shots. Also
   capture a **texture close-up of every textured surface at the CLOSEST reachable gameplay
   distance** (plus each sign straight-on); a blurry / stretched / clashing / low-res-text
   surface fails the gate (the whole-object `props/` frame is too far away to be a resolution
   read). Once a texel-density audit is wired into `qa_shots.mjs`, also require it to print
   **`✓ texture density uniform`**. (Both the close-up pass and the audit are to-build; see
   the `/papercraft-env-qa` and `/papercraft-texture` skills.)
3. In the preview (`/zone-camera`): `cameraQA.static()`=0 + `cameraQA.path()` round-trips=0,
   AND `cameraQA.walk([a],[b])` on every corridor (`stuckAt` null).
4. **Multi-agent picture sweep** over `studio/out/qa/*.png` (template
   `.claude/skills/papercraft-env-qa/visual-qa.workflow.js`) — but trust the geometric
   audit over the sweep's synthesizer (it once mis-dismissed a real z-fight as a "hedge join").
   Fix everything found → re-shoot → repeat until clean.

**Cardinal rules:** (1) **Never the abyss** — no reachable spot/angle may see off the
edge of the world; build PAST the edge, ring open areas with buildings, block with
believable objects (hedges / construction `barrier`), backfill with `buildBackdrop()` + fog.
(2) **Stay on the locked look** — no clipping, no stray outlines, no clashing colours.
(3) **Interior / loading-zone rooms** — three hard rules, all learned the hard way:
**(a) the background is NEVER pitch white** — every scene has an intentional background
colour (or skybox); interiors set it via `Sky.setInterior(on,{bg,…})`. **(b) the floor STOPS
at the walls** — it covers exactly the room footprint (tucks just under the wall thickness, no
seam) and must NEVER extend past the walls or into the non-accessible area beyond (a floor that
runs out into the background reads as a hard floating edge / soft abyss; do NOT "fix" an
edge-against-void by enlarging the floor — fix the background colour). **(c) walls LINE UP** —
a room's walls share ONE height so the corners meet cleanly (no step where a short side wall
meets a tall back wall). After ANY world/interior build, **screenshot it from several angles and
actually look at the consistency** (bg, floor boundary, wall alignment) — don't trust the geometry
audit alone for these.

**Recurring failure modes → root cause → fix (audit for each):**
| Symptom | Cause → Fix |
|---|---|
| Windows/door sunk into ground | building `base`=`groundHeight`; box `bottom=base` (NO downward extension) |
| Dark squares / mottled patch / flicker on a park-edge wall | box extended below base INTO the retaining wall (vertical z-fight) → `bottom=base` |
| Two buildings/stairs flicker where they meet | overlapping footprints → `window.__overlaps()` must be `[]`; separate them |
| Player clips THROUGH the steps going down stairs | `groundHeight` returned a SMOOTH RAMP through STEPPED stair boxes → her feet sat up to ~2 risers BELOW the tread tops in the lower half, so the step behind clipped her legs → snap grounding to the SAME tread tops the builder draws (`H - floor((z-zTop)/dz)*dy`); ease the RENDER height down (clamped `>=` true surface, never below) so descents glide without per-step snap. Guarded by `checks/stair-grounding.mjs` (`window.__stairGrounding()`=`[]`). General class: a billboard's grounding height must match the VISIBLE surface beneath her, never below it |
| Subtle "fold" / weird shadow slivers on the LEFT & RIGHT of a billboard (Shen) on stairs | the flat contact-shadow oval is ONE horizontal quad at foot height; a HARD-edged disc (solid core + thin rim) gets sliced by the step edges (occluded behind the higher tread, floating over the lower one) so it bands across steps + its wide L/R extremities poke out beside her hips → make the oval a soft radial gradient whose alpha reaches **0 at the rim** (keep a defined core so it still reads grounded); a rim that hits 0 can't show a hard clip on stepped/uneven ground. General class: a billboard contact shadow must dissolve at its rim, never be a hard-edged disc. Guarded by `checks/contact-shadow-soft.mjs` (`window.__contactShadowProfile()` rim≈0) |
| Road/plaza/sidewalk shimmer seam | coplanar surfaces same height → distinct per-kind `y`-eps (+ `lift`) |
| Stray white/cream outline lines | `EdgesGeometry` on the wrong thing → `edge=false` on buildings + rounded/small props (keep only as deliberate die-cut) |
| "Invisible circle" blocks a path | coarse box collider (`r=0.5·min(w,d)` → r=2 bulge) → tight perimeter ring (~0.55); confirm with `cameraQA.walk` |
| Silent unreachable area | a stray collider walled it off → `cameraQA.reach()` `unreachable` must be `[]` |
| Clip THROUGH a prop (slide/climber) | one centre collider → per-part `cols:[{dx,dz,r}]` |
| Prop faces the wrong way | make it orientation-free (lamp = top globe) or set per-prop `rot` |
| Props that don't belong / overlap | bushes on a road, bench on a bush → streets = lamps/trees, park = bushes; space props ≥~3u; the `placement` lens |
| Blurry / smeared wall or prop up close | 256px `paperTex` + fixed `repeat 1.6` (too few texels/m) → one 1024px `gen_paper` set via `loadPaper()`, `paperUV(geo,0.18)`, max anisotropy + mipmaps |
| Grain stretched (wide vs tall face differ) | `BoxGeometry` 0..1 UVs → `paperUV()` so texels-per-metre is constant on every face |
| Sign text low-res / stretched | text baked into the `facadeTex` wall canvas (`k=48` px/m) → a dedicated `makeSign()` board at ~220 px/m × dpr on its own thin box off the wall |
| Fake structure painted into a wall | a sign / window / door drawn into `facadeTex` → MODEL it as a thin box/plane in `makeFacade` (foreground = model it; texture only flat grain) |
| Neighbour textures clash at a seam | mismatched density/phase or two unrelated maps → ONE shared paper map, per-mesh tint, same `DENSITY`, world-space (`paperUV` or triplanar) phase |
| Texture not QA'd at resolution | the deterministic `texture-density` check (`window.__textureDensity()` → `{lowDensity:[]}`, run by `node studio/qa_audit.mjs`) now guards texels-per-metre per face; ALSO shoot every changed surface at the CLOSEST reachable distance + each sign straight-on (crisp / uniform / seamless / blended / legible) |
| Blurry / mis-aligned building textures | big stretched maps → MODEL foreground structure as separated thin geometry, texture only for flat grain + distant backdrop; uniform texel density; `checks/texture-density.mjs` |
| Hard seam where two textures/materials meet | adjacent maps don't blend → named sweep line; share a palette/tile, soften the join |
| Flat ground surface reads as an off-colour band "bleeding through" (e.g. a saturated yellow-green grass strip flipping G>R against warm-gray ground near the stairs) | surface hue clashes with the warm-neutral palette AND/OR the surface doesn't cover its region (warm base-ground slivers show) → HARMONISE the tint (soft, on-palette sage, warm-leaning low blue) AND extend it to FULLY blanket its area, tucking under believable boundaries (stairs/hedge/building) so the only edge is a deliberate lawn-meets-stone line, never a stray strip on open ground; subjective → named sweep line (h) in `visual-qa.workflow.js` |
| Sky/light seeping through a gap between adjacent shopfronts | facade gap to the void → close the gap / build city behind it (abyss rule); named sweep line |
| Sky/void over the rooftops or between backdrop blocks (short/gapped skyline) | backdrop ring too short or its near rings gapped → near rings GAPLESS (`fill>1, jit 0`) + tall in `buildBackdrop()`; deterministic `checks/sky-leak.mjs` (`window.__skyLeak()` → `leaks:[]`, casts outward from each edge) AND `checks/camera-abyss.mjs` (`window.__camAbyss()` → `leakCount:0`, raycasts the REAL zone camera at every reachable cell — catches a center-view gap the edge-cast misses) |
| Sweep cries "ABYSS/void" but geometry is sound | the vision synthesizer mis-reads **fog-washed / flat-grey backdrop or a retaining wall** as void — TRUST `__camAbyss()` (0 void rays from every reachable cell) over the synthesizer; the fix (if any) is warming/de-flattening the distant palette (diorama-lens taste), NOT adding geometry |
| **Interior background is pitch WHITE** | a colour string reached `THREE.Color` **without a leading `#`** → `THREE.Color('e8cba2')` silently parses to WHITE (only `'#e8cba2'` is correct). Normalise every colour (`v[0]==='#'?v:'#'+v`) before `new THREE.Color()` / `.set()`. Each scene sets an intentional non-white bg via `Sky.setInterior`. Guarded by `checks/scene-background.mjs` (`window.__sceneBackgrounds()`). |
| **Interior floor runs past the walls / floats against the bg** | the floor plane is bigger than the room → its cut edge floats. Size it to the room footprint only (`(x1-x0)+th × (zF-zB)+th`, no `+9`/forward bias). Beyond the walls is the BACKGROUND colour, not more floor. Guarded by `checks/floor-bounds.mjs` (`window.__floorOverruns()`=`[]`). |
| **Room walls don't line up at the corners** | side walls and back wall built at different heights (e.g. `wallH` 4.5 vs `backH` 5.4) → a step at the corner. Give a room ONE wall height. |
| **Door/shelf/sign has the WALL drawn over it; one prop clips THROUGH another** | a fixture recessed INTO the wall (placed at wall centre `z`) → the wall front occludes it; or a shelf board spans a tank. Mount fixtures PROUD of the wall front face (`zBack + th/2`); a tank SITS ON a shelf board (y-touch). `window.__clips()` / `window.__interiorOverlaps()` (3D per-mesh audit over `userData.fx`-tagged fixtures) must be `[]` — guarded by `checks/interior-overlap.mjs`. |
| **A long/thin prop (shelf) walls off the room** | a single circular collider `r=½·max(w,d)` (≈4u for a width-8 shelf) bulges a huge invisible wall → blocked the counter. Use `pushBoxColliders` matching the footprint (swap w/d when rotated). Tell: `cameraQA.static`/`framing` cell count drops. |
| **Muddy / blurry CAST shadows on the ground** | the sun's shadow map spread thin over a huge frustum (`±60` ÷ `2048` ≈ 17 texels/u) → smudge edges. Density = `mapSize ÷ (2·frustumHalf)`. Fit a FIXED frustum to the scene's reachable bounds (`Sky.setShadowBounds` from `spec.bounds`) + a bigger map: `4096`÷`±53` ≈ 38 t/u for town. Guarded by `checks/shadow-quality.mjs` (`window.__shadowInfo()` → `texelsPerUnit ≥ 28` + `soft` at the top tier). |
| **CAST shadows crawl / flicker as the player moves** | a shadow frustum that FOLLOWS the player swims its texels every frame (world-x/z snapping is wrong for an angled light → the edge crawls, worst under small props like bushes). FIX: a FIXED, world-locked frustum (`Sky.setShadowBounds(cx,cz,half)` per scene) — it physically can't shimmer. Never follow the player with the shadow camera. |
| **DOUBLE shadow under one object (a pool below + a cast shadow to the side)** | a 3D modelled prop both casts a REAL shadow (`M()` sets `castShadow=true`) AND gets a `contactShadow()` oval → two shadows. RULE: 3D props (tree/bench/bush/fountain…) cast the real shadow ONLY (no oval in `buildProps`); flat BILLBOARDS (Shen/NPCs/pickups, `castShadow=false`) get the oval ONLY. Each thing = exactly one shadow of the right kind. |
| **Cast shadow fuzzy / jagged / hard (not an accurate real-life bleed)** | the built-in shadow filters are all wrong for this: `PCFSoftShadowMap` is a fixed-width DITHERED blur (reads fuzzy/jagged), `PCFShadowMap` is hard, `VSMShadowMap` LIGHT-BLEEDS small props to nothing. FIX: **PCSS** (`js/pcss.js` patches `ShaderChunk.shadowmap_pars_fragment`) = contact-hardening soft shadows — crisp where an object meets the ground, bleeding softer with distance (sun read as an AREA light). `installPCSS()` runs BEFORE any material compiles; `renderer.shadowMap.type=PCFShadowMap` (PCSS short-circuits `getShadow`). Guarded by `checks/shadow-quality.mjs` (`__shadowInfo().pcss`). |
| **PCSS shadows wash out / small props lose their shadow** | the PCSS **filter radius is in shadow-UV, not texels** — `0.024` UV ≈ 98 texels at 4096 → samples over a huge area → averages the shadow to nothing. Keep `PCSS_MAX` a FEW texels (`~0.006` UV ≈ 24 tx); `PCSS_SOFT` ~0.13, `MIN` ~0.0006. Also tighten the shadow camera near/far to the light's real distance (`setShadowBounds`: outdoor ~40/178, interior ~2/48) so packed-depth precision resolves the blocker gap. |
| **Small-prop shadows vanish entirely** | (a) `VSMShadowMap` light-bleed (don't use VSM); (b) `shadow.normalBias` too high (`0.4` peter-pans the shadow off small casters) → keep `~0.02`; (c) PCSS filter radius too big (row above). The big building still casts (large occluder) while trees/benches lose theirs = the tell. |
| **Soft contact-shadow oval too sharp/dark (vs the soft cast shadows)** | the die-cut oval's rim feather too tight → widen the canvas blur so it matches the soft world shadows: `ctx.filter='blur(s*0.085)'` over a filled ellipse (`r≈0.355·s`, alpha ~0.46) on a 256px canvas + mipmaps. Visual-sweep item (subjective edge). |
| Edits not showing on reload | browser cached `specs/world.json` → fetched `cache:'no-store'`; hard-reload. **The preview hard-caches ES modules and WON'T re-fetch even on reload** — a fix can be in the served file yet the page runs old code (symptom: `'newThing' in window.audio` is false). FIX: `studio/js/*.js` are imported in `game.html` with a `?v=N` cache-bust — **bump N when you edit any module**. Also verify in a FRESH headless context (`node studio/qa_audit.mjs` / `studio/qa/scenarios/*`). |
| **Cutscene camera zooms in on someone who ISN'T there** | a character shot targeted a HARDCODED coord that didn't match where the actor actually ends up → frames empty floor. FIX: author character shots as RUNTIME fns of the live position (`shenCU`/`adrianCU`/`twoShot` → `()=>({tx:S.x,…})`); the walk FOLLOWS Shen. Guarded by the framing trace (`__csReport().shenOff/adrianOff` while a line is showing). |
| **Cutscene character clipped/merged at a frame edge, or a dead hold on empty space** | an action shot was too wide (caught a bystander half-cropped) or held after the action left frame (empty door after the hamsters exit). FIX: frame the action TIGHT with bystanders fully OUT, and END the shot as the action exits (cut straight to the next beat — no empty hold). Caught by the dense scene-by-scene screenshot + multi-agent sweep. |
| **Cutscene close-up stacks the OTHER character's head behind the subject** | the second actor sat on the close-up's sightline. FIX: angle the CU well to the side (strong `yaw`) + tighten, and recoil/stage the subject off the other's axis, so the bystander sits off-frame or clearly separated. Caught by the sweep (`awkward-overlap`). |
| **Cutscene sprite (hamster) SHRINKS the moment it animates** | `mesh.scale` was set to the sprite's own width/height (~0.4) as if a multiplier, but the geometry is already W×H → ~0.4×. FIX: `scale` is a MULTIPLIER ~1.0 (squash/stretch only). Guarded by `__csReport().hamMinScale` (must stay ≳0.6). |
| **Actor walks THROUGH a solid cutscene prop (impossible move)** | the walk target was INSIDE the prop footprint (Shen ended up inside the table). FIX: stop at CONTACT (target outside the footprint); route the approach path around standing props (go into the open floor, THEN turn to the prop). Guarded by `__csReport().clip` (Shen's centre inside a still-standing `csTableBox` = 0). Review the whole tween, not keyframes. |
| **A cutscene consequence (knocked-over table) VANISHES at the end** | `endCutscene` swept ALL csProp props including one that should persist. FIX: convert the consequence prop to a permanent fixture (un-tag csProp, set `userData.fx`) + rebuild it on later entries via the scene builder gated on `seenCutscenes` (spec `cutsceneTable` → `buildInterior`). Scenario asserts the remnant present after + on re-entry. |
| **Player walks THROUGH the knocked-over table remnant** | the persistent remnant was built as non-colliding decor (no collider). FIX: a remnant that occupies floor space is a SOLID obstacle — give it a collider matching its (tipped) XZ footprint (`addTippedTableCollider`: `Box3.setFromObject` → `pushBoxColliders`), added on `endCutscene` conversion (→ `SCENE_COLLIDERS`) AND the `buildInterior` rebuild (via `opts.cols`); size it so it doesn't wall off the room. Guarded by `scenarios/cutscene-persistence.mjs` (colliders at the footprint + interior impassable + `reach()` clean). |
| **A one-time cutscene REPLAYS on every entry** | seen was marked only at the END (`endCutscene`), but the autosave (10s interval / `visibilitychange` / `pagehide`) fires MID-cutscene → writes `scene=<here>, cutscenes=[]`; a reload / tab-close mid-cutscene then Continues back into the scene with an empty seen-set and re-arms it. FIX: mark SEEN + `persist()` the moment it STARTS (`startPendingCutscene`), before any line plays — once it has begun it's done. Default for ALL one-time cutscenes. Guarded by `scenarios/cutscene-persistence.mjs` (autosave-mid-cutscene → reload → Continue = no replay). |

Debug hooks (all on `window`): `cameraQA.{static,framing,clip,path,transition,reach,walk,warp}`,
`__overlaps()` (town 2D footprints), `__clips()`/`__interiorOverlaps()` (interior 3D per-mesh),
`__floorOverruns()`, `__sceneBackgrounds()`, `__fixtures()` (per-fixture AABBs), `__textureDensity()`,
`__skyLeak()`, `__camAbyss()`, `__shadowInfo()` (`{pcss,soft,texelsPerUnit,level,gfx,…}`),
`__worldState()`/`__dnState()` (day-night state + shop gating + track), `__dayBar()` (Pikmin bar state),
`__forceTime(h)` (snap clock to wall-hour h, no curtain) / `__triggerDayNight('DAY'|'NIGHT')` (force the curtain),
`__forceInputMode('desktop'|'touch'|'auto')` (force HUD chrome mode),
`__gfx()`/`__gfx(kind,val)` (read/set graphics quality: `shadows`/`fx`/`res`),
`__cutscene()`/`__csReport()`/`__csTrace()`/`__csStep(dt)`/`__csHam()` (cutscene engine + framing trace + tween stepper),
`__gh(x,z)`, `__probe(x,z)`, `__colliders(x,z,r)`,
`__freecam/__look` (free-cam for QA shots — they STOP the auto loop; call `__startAuto()` after).
Deterministic gate: `node studio/qa_audit.mjs` (auto-runs `studio/qa/checks/*`). See `studio/qa/README.md`.

## Status / next

- DONE: **Cutscene system + pet-shop first-visit set-piece** (`studio/js/cutscene.js` + game.html).
  A generic Paper-Mario beat-timeline engine: input-locked, a keyframed **director camera** that
  zooms/dollies onto the action + speakers, motion-based emotion (mood + impulse overlays, no
  drawing tweens), little dialogue boxes that hold for **Next**. First cutscene `cs_petshop_intro`:
  enter the shop → Adrian greets → Shen knocks over a table → **5 hamsters spill out + bolt for the
  door** → both react → the **Hamster Roundup quest starts here** (the cutscene is the giver now).
  Once-only (persisted `cutscenes` save field, additive — no `SAVE_VERSION` bump; skips if the quest
  already started, so old saves don't replay it mid-quest). **Town hamsters are gated** on the quest
  (none exist until they escape). New SFX `knock`/`scurry` + an Adrian voice. Full QA green:
  deterministic `checks/cutscene.mjs` (engine wired + gating), real-path `scenarios/cutscene.mjs`
  (input-lock, quest start, seen-flag, table teardown, SFX, gating-flip, no replay), all existing
  scenarios + audit + smoke + shot-battery geometry still clean; ~15 cutscene frames eyeballed
  (establishing, knock, 5-hamster scatter, dialogue, clean hand-back). See the **Cutscenes** section.
- DONE: **Shadow rework + graphics menu** — fixed three shadow problems Christopher flagged
  (first "always very blurry edges"; then on a follow-up: flicker, double shadows, too sharp).
  Final approach:
  - **Soft + ACCURATE (PCSS):** the built-in filters all fail here — PCFSoft is a fuzzy/jagged
    dither, VSM light-bleeds small props away. So `js/pcss.js` patches the shadow shader to do
    **PCSS** (contact-hardening soft shadows: crisp where an object meets the ground, bleeding
    softer with distance — the sun read as an AREA light). `installPCSS()` before any material
    compiles; type stays `PCFShadowMap` (PCSS short-circuits `getShadow`). Density from a FIXED
    frustum fit to the scene (`4096`÷`±53` ≈ 38 t/u for town), not the old muddy `±60`÷`2048` ≈ 17.
    ⚠️ PCSS filter radius is in shadow-UV (a few texels), NOT a big number — too big washes small
    props out. (First pass used PCFSoft/`shadow.radius`; the user flagged it as fuzzy → PCSS.)
  - **No flicker:** the shadow frustum is FIXED + world-locked (`Sky.setShadowBounds(cx,cz,half)`
    from `spec.bounds`, called by `buildScene`). The earlier player-FOLLOWING frustum is what made
    shadows crawl/swim under the bushes; a fixed one can't shimmer. (`setShadowFocus` removed.)
  - **No double shadows:** every 3D prop's `M()` meshes cast a REAL shadow, so `buildProps` no
    longer also adds a `contactShadow()` oval (that was the "one below + one to the side" the player
    saw on the tree). 3D props (tree/bench/bush/fountain…) → real cast shadow only; flat BILLBOARDS
    (Shen/NPCs/pickups, `castShadow=false`) → soft contact OVAL only (oval blur widened to match).
  - **Graphics menu** (Settings → `Gfx`): three independent chips on their own `shen.gfx.*` keys
    (like the volume mix), applied live + persisted — **shadows** (off/low/high; both tiers soft,
    the tier trades map resolution), **finish** (the `fx.js` lens: off/minimal/diorama/full,
    defaults **off** so it's opt-in), **resolution** (fast 1× / crisp `min(dpr,2)`). Mobile/
    coarse-pointer defaults shadows to **low**. Chip click plays `select`.
  - Deterministic **`checks/shadow-quality.mjs`** (`window.__shadowInfo()` → `soft` + `texelsPerUnit
    ≥ 28` + `blurRadius>0` at the top tier + the `__gfx` knobs wired) so shadows can't silently
    regress to muddy/hard. `window.__gfx()`/`__gfx(kind,val)` console+QA hook. Audit 10/10 green,
    smoke green; town + park (tree/bench/bush single soft shadows) + interior + all menu knobs
    verified in preview. See the failure-modes table (six shadow rows) + [[premium-look-overhaul]].
- DONE: **QA capture reflex + hard gate** — a problem Christopher reports once becomes a
  permanent check (fix → generalize → promote to a **deterministic** assertion → record).
  New **`studio/qa/`** = the single QA home: a shared `harness.mjs` (`withGamePage`, free
  port — kills the copy-pasted server + the `PORT=8788` collision) and an **auto-discovered
  check registry** (`qa/checks/*.mjs`); `studio/qa_audit.mjs` is now a thin runner over it,
  exit-coded, stamps `.claude/.qa-stamp` on a clean pass. **Add a check = add a file** (no
  central edit → branches don't conflict). `qa_shots.mjs` exit-codes + stamps. Contract +
  per-branch fold-in: `studio/qa/README.md`. A committed **Stop hook**
  (`.claude/settings.json` → `.claude/hooks/qa-gate.mjs`, shared hash in
  `.claude/hooks/qa-lib.mjs`) **blocks finishing a turn while world files are dirty + un-audited**
  (instant: git + stamp, never launches a browser; fails open; one block per stop). Clear it
  with `node studio/qa_audit.mjs`. Heavy multi-agent sweep runs on every `/deploy` + geometry
  change. Verified end-to-end (clean→pass, dirty→block exit 2, re-audit→clear). See the **QA
  reflex** section above + [[shanni-qa-capture-reflex]].
- DONE: **Camera framing pass** — every zone retuned to a calmer 3/4 view (no top-down;
  the worst, the `corner`, went from ~56° to ~26°) and a bigger Shen (min ~13%, AIM ~15%+
  of screen). New **`trackWid`** zone field gives the open `park` a 2D follow so she stays
  a constant size wherever she roams (was a tiny dot off-centre). New **`cameraQA.framing()`**
  + `CAM_MIN_FRAC`/`CAM_MAX_PITCH` guardrails in `game.html` make "not too small / not
  top-down" permanent 0-failure gates. Full QA green (framing, visibility, round-trips).
  Rules written into `/zone-camera` (SKILL + REFERENCE) and the Cameras section above.
- DONE: character cutout + die-cut; walk + jump (hop); 6 environment moods;
  pipeline migrated into the repo; **3D Paper-Mario game loop** (`studio/game.html`
  + `studio/js/sim.js`) — perspective follow-camera (Shen always centred),
  full-window responsive, 2D ground movement, depth-sorted billboard props
  (walk behind/in front), d-pad + keyboard; `/deploy` skill
  + GitHub Pages. **Live: https://metroxe.github.io/project-shanni-happy/**
- DONE: **Removed flower collecting + jump-for-joy** (user request). No more flower
  collectibles, no score/win HUD, no joy mode/button/`J` key/sound. The only
  collectibles are hamsters (Adrian's quest). The **Talk** action button is now
  contextual (shows only when beside an NPC); **hop** is always shown. Chrees kept as
  a flavour NPC with rewritten (non-flower, non-quest) dialogue. No `SAVE_VERSION`
  bump (removed ids drop via sanitize; the removed `q_chrees` is ignored on load).
- DONE: **NPC dialogue system** (`studio/js/dialogue.js`) — walk-up proximity prompt
  over the NPC, bottom dialogue box with typewriter reveal, advance-on-button, and
  branching **choice menus** (↑/↓ or d-pad to pick; Talk/Enter/Space/click to confirm).
  Movement is **not** gated while talking — any move input walks Shen and **ends the
  conversation** (`resolveInput` calls `Dialogue.end()`); in an open choice menu ↑/↓
  still navigate, ←/→ still walk you out. Data-driven: per-NPC trees live in `world.json` under
  `npcs[]` (`{name, tex, x, z, h, dialogue:{start, nodes:{id:{text, speaker?, next?,
  choices?}}}}`). NPCs render as grounded billboards with idle paper breathing + a greet
  hop. First NPC **Chrees** (buff, red headband, long hair, black tank) → `out/chrees-paper.png`.
- DONE: **`studio/gen_image.py`** — reusable Gemini image-gen (text→image, optional
  `--ref` style/face conditioning); made Chrees using chibi #4 as a style ref. Key: env
  `GEMINI_API_KEY` from 1Password item **"Bowmark Gemini Key"** (id
  `s66drdsfeobdn5brqel5kvdtta`, vault `Christopher-Macbook-CLI`); model `gemini-3-pro-image`.
  `cutout.py` now takes an optional name arg: `cutout.py <src.png> <name>` →
  `out/<name>-cut.png` + `out/<name>-paper.png`.
- DONE: **Save system** (`studio/js/save.js`) — localStorage persistence keyed
  `shanni-happy:save`. Saves on `visibilitychange→hidden` + `pagehide` (true "exit
  any time", sync write finishes during teardown), on every flower pickup, and a 10 s
  interval backstop for hard kills. **Title / continue screen** (`#title` in game.html):
  New Game / Continue over the dimmed live world; gameplay input gated by `started`;
  New Game asks "Erase save?" once before wiping an existing save. Defensive load:
  `sanitize()` clamps position to bounds, intersects collectible ids with the current
  world, recomputes score; the whole load is try/catch → worst case "fresh start" (bad
  blob stashed under `…:save:backup`). Debug surface: `window.game.{save,wipe,saveData,
  start,reset}`. Verified end-to-end (collect→reload→continue, stale-id drop, OOB clamp,
  corrupt JSON, future-version, erase guard).

  ### Save compatibility — WE control it (not the deploy/build version)
  `build.json` (the deploy git-sha) is a **debug label only and never decides whether a
  save loads.** Compatibility is governed by two things we own in the project:
  - **`SAVE_VERSION`** (integer in `studio/js/save.js`). A loaded save with an *older*
    `v` is **discarded → clean fresh start** UNLESS `migrate()` has a step that walks it
    up to the current `v` (then progress is preserved). A *newer* `v` (reverted deploy)
    is preserved-but-ignored. So bumping `SAVE_VERSION` is the deliberate "this breaks
    old saves" switch.
  - **Stable collectible ids** (`world.json` `id:"f1"…`). Progress is a SET of collected
    ids, never array indices. **⚠️ NEVER renumber/reuse an id once shipped** — that
    silently corrupts saves and is exactly what the id scheme prevents.

  **Bump rule — before every deploy, judge whether the diff breaks saves:**
  - **Do NOT bump (the common case):** new / moved / removed flower (ids + sanitize
    cover it), art / colour / prop / cloud / hill changes, new NPC or dialogue, physics
    tuning, or adding a NEW saved field that load defaults when it's absent.
  - **Bump `SAVE_VERSION`:** the *meaning or units* of a saved field change (e.g. the
    coordinate system, so old `x`/`z` map to the wrong place), a saved field load relies
    on is removed/renamed without a safe default, `collected` semantics change, or
    restoring an old position/progress would soft-lock or misplace the player. Bump =
    discard old saves; to keep progress instead, also add a `migrate()` step. When
    genuinely unsure, prefer bumping — a clean reset beats a silently broken world.
  The `/deploy` skill enforces this check at push time.
- DONE: **Procedural audio** (`studio/js/audio.js`) — all Web Audio synthesis, **no asset
  files**. Gameplay SFX via sim-transition detection (`audioStep` in game.html), UI/dialogue
  SFX via `Sound.sfx` + `Dialogue.on*` hooks, and a Charlie-Brown muted-brass dialogue voice
  (`Sound.blip`, per-speaker `VOICES`). **Pause menu** (Esc / ☰) with a master volume slider +
  mute, persisted (`shen.vol` / `shen.muted`); audio unlocks on first gesture. See the
  **Sound** section above for the "every interaction makes a sound" rule + how to add one.
- DONE: **Background music — PER-SCENE** (`calm.ogg` overworld, `shop.ogg` pet-shop) — each a
  seamless ~26s loop generated with **MusicGen-medium** (`gen_music.py` → 30s clips, `make_loop.py`
  → equal-power crossfade + `oggenc`; env in `requirements-music.txt`. Generated on **CPU**). Each
  scene declares `spec.music`; `Sound.startMusic(url)` **crossfades** to a different track, **no-ops**
  on the same one (seamless), and **caches each decoded buffer by url** so returning is instant.
  `buildScene` switches it on every scene build; `beginGame` starts the boot scene's track. The
  overworld song is exclusive to the overworld; interiors get their own (or a shared indoor) track —
  see the "third sound rule" above. `shop.ogg` = seed 0 (mellow/cozy, wrap 0.01× p999). Decode
  failure (e.g. a track not yet rendered) degrades to "no music", never a crash.
- DONE: **Independent volume mix** — `audio.js` now has **two sub-buses under the master**: SFX +
  dialogue-voice route through `sfxGain`, music through `musicGain`. **Three pause-menu sliders** —
  master **volume** (`shen.vol`/`shen.muted`), **effects** (`shen.sfxvol`), **music**
  (`shen.musicvol`, 0 = off) — each its own key, none in the save blob. `Sound.setSfxVolume` /
  `setMusicVolume` / `setVolume`; defaults reproduce the old single-volume behaviour exactly.
- DONE: **Quest system + journal book** (`studio/js/quests.js` + the journal UI in `game.html`).
  - **Engine** (`Quests`, UI-agnostic like `dialogue.js`): data-driven quests in `world.json`
    `quests[]` (`{id, name, giver?, summary?, steps:[{desc, goal?}]}`). Goal types auto-advance
    against the live world: `collect` (`{kind?,ids?,count?}` — counted from the collected set, so
    progress is **derived on load**, never stored), `talk` (`{npc}`), `reach` (`{x,z,r?}`),
    `manual`. State is compact (`{status,step}` per quest) + persisted in the save blob's new
    `quests` field (additive — **no `SAVE_VERSION` bump**; absent → fresh). Hooks `onStart/onAdvance/
    onComplete` drive sound + toasts. `Quests.note({type,...})` is fed from game seams; `Quests.list()`
    feeds the journal.
  - **Wiring**: dialogue nodes carry an optional `action` (`"start:q_hamsters"`) fired via
    `Dialogue.onAction`; NPCs get a `quest` field + `entryNode()` picks a **state-aware greeting**
    (default intro / `progress` / `ready` / `done` nodes by quest status). Collecting feeds
    `note('collect')`; talking feeds `note('talk')`.
  - **Journal** = the pause menu replacement (Esc / 📖). A **book** with **left binder-divider tabs**
    (📜 Quests, ⚙ Settings) and a **page-flip** on switch (`#pages` rotateY). Quests tab = expandable
    list (name + giver → summary, rose "current task" box with a progress bar, done/active/future
    step rows). Settings tab = the three volume sliders + mute + restart/resume (relocated, same ids).
    Quest milestones show a `#qtoast` + a badge dot on the 📖 button when closed.
  - **Content (Rocky-themed town)**: **Adrian** the shy pet-shop clerk (`out/adrian-paper.png`, Gemini
    chibi → `cutout.py`) gives **Hamster Roundup** — find 5 escaped **hamsters** (`out/hamster-paper.png`,
    collectible `kind:"hamster"`, scattered) and return them. This is now the **only** quest —
    **Chrees** is a flavour-only NPC (his "Bloom the Block" flower quest was removed with flowers).
  - **Sounds** (all procedural, `audio.js`): `squeak` (hamster), `quest`/`questStep`/`questDone`,
    `book`/`bookClose`/`flip`. Verified in preview: full lifecycle (accept→auto-track→complete),
    real dialogue acceptance for both NPCs, journal DOM + page-flip, save round-trip, **camera QA 0 fails**.
- DONE: **Loading zones (multi-scene + doors)** — the world is no longer a single scene. Each scene is
  a spec (`SCENE_URLS` in `game.html`: `town`=`specs/world.json`, `petshop`=`specs/petshop.json`); a
  scene swap is `clearScene()` (drop the `sceneRoot` group) → `buildScene(spec, spawn)` (rebuild city or
  interior + collectibles + npcs + colliders + camera warp). Persistent objects (base ground, Shen,
  shadow, burst, Sky) live OUTSIDE `sceneRoot` and travel between scenes.
  - **Doors/portals** are data-driven: a scene's `portals[]` (`{id,x,z,r,to,spawn,label,door:{…}}`) +
    named `spawns{}` (where you arrive from a given portal). Walk up → contextual **"🚪 Enter"** prompt
    (same seam as the Talk prompt; a door never fights an NPC for the key) → `startPortal()` runs a
    cream-fade **walk-through transition** (`updateTransition`: walk INTO the door + shrink → cover →
    swap scene → step out + uncover), with a shop-bell `door` SFX + footsteps. `#fade` overlay + `trans`
    state machine; gated so it can't fire mid-dialogue/mid-transition.
  - **Town door**: a framed "PET SHOP" entrance (`buildPortalDoors`, awning + sign + bell) set into the
    park-side cliff under the existing Pet Shop building (reachable park spot — the town is otherwise
    walled corridors with no reachable building face). **Adrian moved INSIDE** the shop (he was on the
    street); the hamster quest is now given/returned in the shop. Town keeps Chrees.
  - **Pet shop interior** (`specs/petshop.json`, `interior:true` → `buildInterior` + the `IPROP` map):
    a Rocky-style "J&M Tropical Fish" room — sage walls + wood floor + baseboards, a counter with Adrian
    behind it (thin front-face collider so you can talk across it; `TALK_R` 2.6), glowing translucent
    **fish tanks** (drifting fish, reuse the spatial water ambient via `fountains`), a **birdcage** w/
    bird (spatial `chirp` ambient via `ambients[]`), hanging + potted plants, rug, welcome mat, exit door,
    a "J & M PET SHOP" sign, warm ceiling `PointLight`s. `Sky.setInterior(on,cfg)` hides the outdoor dome
    + sets a warm **non-white** background + warm light. **Enclosure rules (cardinal — see the QA gate):**
    the floor covers the room footprint and **stops at the walls** (never extends past/behind them); the
    background beyond the walls is the bg colour, NOT more floor; all walls share **one height** so corners
    line up. One fixed `shop` zone camera, QA'd. (⚠️ `THREE.Color('e8cba2')` w/o `#` parses to WHITE — the
    bug that made the bg pitch-white; normalise colours.)
  - **Global collected set + save**: pickups update a game-level `collected` Set (reconciled against
    `S.collectibles` each frame — robust to multi-substep frames; the per-step `S.justGot` flag is for
    SFX only) so progress survives scene swaps; quests read this global set. `save.js` gained an additive
    `scene` field (absent → town; **no `SAVE_VERSION` bump** — old v3 saves still load) + multi-scene
    sanitize (clamp to the saved scene's bounds; collected ids validated across all scenes).
  - **QA harnesses** (fresh-context, no module-cache trap): `studio/qa_petshop.mjs` (camera 0-fails both
    scenes + talk-across-counter + input-path round trip + interior/abyss shots), `studio/qa_save.mjs`
    (cross-scene persistence + old-save compat), `studio/qa_quest.mjs` (full hamster loop with Adrian
    inside). All green; smoke + town `qa_shots` geometry audit still clean; multi-agent visual sweep =
    enclosed/on-aesthetic. New SFX: `door`, `chirp`.
- DONE: **GYM scene (`specs/gym.json`) — third loading zone, north of the stairs.** The town's big
  **Corner Market → GYM**: relabelled facade ("GYM"), `faceDir` gained `+z` so its south face (the
  blank wall facing the road/stairs) is now a storefront (windows + sign + awning + door at x≈8.2,
  right above the stairs). A trigger-only `to_gym` portal (NO `door` geom — the facade door is the
  visual) + `from_gym` town spawn. The gym interior is a decent-sized walled room (`room.x [-10,10]`,
  z `-11..3.5`, one wall height) with new MODELED paper fixtures (no images): **treadmill** (deck +
  dark belt + front cowl + console screen + handlebar), **gymbench** (×2), **squatrack** (uprights +
  top crossbar + barbell/plates + safety arms), **dumbbells** (A-frame rack of paired dumbbells),
  **cooler** (water cooler) — builders in the `IPROP` map, each returns a `footprint:{w,d}` so
  `buildInteriorProps` lays a tight box-collider ring (never one fat circle). Reuses `counter`/
  `register` (front desk), `mat`/`rug`, `plant`/`hangplant`, `sign`. **Chrees MOVED here** (out of
  the town `npcs`, now empty) doing dumbbell curls (his `curl` rep + proximity `lift`), dialogue
  rewritten for the gym. Sound: shares the calm **indoor loop `shop.ogg`** (interiors share one
  indoor track — a dedicated gym loop is an open follow-up) + a new proximity `clink` ambient near
  the free-weights (`audio.js`, `audio.js?v=4`). One fixed `gym` zone camera (axisDeg 0 + `trackWid`
  follow → constant size). QA: deterministic audit 9/9 clean (incl. interior overlap/floor/bg),
  `cameraQA.static`/`framing` 0 fails in the gym, reach all cells, town↔gym round-trip clean, smoke
  green, audio scenario extended (gym block: indoor music + `clink` + Chrees `lift`), gym battery
  captured (`studio/qa/scenarios/gym-shots.mjs`) + two-agent visual sweep (treadmill + squat rack
  beefed after it). No `SAVE_VERSION` bump (additive scene). New SFX: `clink`.
- IN FLIGHT: **Premium look overhaul** (make it less "web-ish"). Working brief + A–Z of style
  directions + concerns + method: **`studio/PREMIUM_LOOK.md`** — READ IT before doing visual work.
  Two pieces already exist: (1) a post-processing finishing lens `studio/js/fx.js` (`EffectComposer`
  presets `off|minimal|diorama|full`, toggle `window.__fx('diorama')`; **diorama accepted as the final
  10% lens**; SSAO parked — billboard halo); (2) the **`papercraft-texture`** skill that fixes the
  blurry/stretched surfaces (256px fixed-`repeat` → crisp seamless tiles + world-space UVs). The brief
  says the real win is in the **bones** (palette, textures, toon, UI skin, character rim), not the lens.
- DONE: **Day/Night world states** — full brief + AS-BUILT notes in **`studio/DAY_NIGHT.md`**
  (READ IT before any day/night work). Gameplay state (DAY/NIGHT, **night = 21:00–07:00**) layered
  on the EXISTING cosmetic cycle in `studio/js/sky.js` (`Sky.clock()` is the time source; ⚠️ its
  `isDay` is 06:00–18:00 and is NOT the gameplay night — a separate `isNight()` is used). At each
  21:00/07:00 crossing a screen-wide `#daynight` curtain (sun-down / moon-up + "Night falls" label,
  `DN_DUR=1.9s`) **conceals** the swap, applied at full cover: day-only doors → **closed**
  (`🔒 … — closed` prompt + `closed 🔒` button + `showClosed` toast + `locked` sfx, NO scene
  change), NPCs gated by `isActive` (mechanism wired; town has no street NPCs yet so it's latent),
  and the overworld music → MusicGen night loop `out/music/night.ogg`. **Closing a shop ON the
  player:** a ~20:45 pre-close heads-up toast (tailored if you're inside one), and if you're INSIDE
  a day-only shop when 21:00 hits the curtain **ejects you to town in front of its door** (the
  curtain holds at full cover during the async swap) + shows its `closedMsg` — never stranded
  inside. Data-driven gating:
  `portal.hours`/`npc.active` = `"day"|"night"|[open,close]`; `spec.nightMusic`. **Chosen variant:**
  continuous sky + concealing overlay (NOT a frozen sky — that would break the clock-HUD coupling &
  degrade the arc; the overlay delivers "the animation is the transition"). New SFX `dusk`/`dawn`/
  `locked`. No `SAVE_VERSION` bump (time ephemeral, additive scene data). Guarded by
  **Clock is now a Pikmin-style day/night BAR** (`#daybar`, top-center; replaces the analog clock):
  one continuous cycle (NOT 12h) — left = day-start 07:00, right = night-end 07:00; a sun marker
  rides across + **morphs to a moon** past a transition **tick** at 21:00 (`updateDayBar`/`initDayBar`,
  `DB_DAYSTART`/`DB_T`; hook `__dayBar()`). **HUD chrome is mobile-only:** the top-right key-hint
  (`#hint`) is removed entirely, and the d-pad / action / journal / fullscreen show only on touch
  (`body.desktop` via `applyInputMode()`/`isTouch()`; force with `__forceInputMode('desktop'|'touch'|'auto')`).
  Guarded by
  `checks/day-night.mjs`, `checks/hud-visibility.mjs` + scenarios `qa/scenarios/day-night.mjs`, `day-night-eject.mjs` (+ `-shots.mjs`, `hud-daybar-shots.mjs`). Audit 16/16,
  smoke green, scenario green, curtain + night look verified in screenshots. Follow-ups: time
  persistence, dusk/dawn sub-states, real night-only actors. See [[shanni-day-night-states]].
- NEXT (ideas): more NPCs/quests (drop-in: add art + a `world.json` npc/quest); conversation state
  (remember choices) — persist into the reserved `npcs:{}` slot already in the save blob; more zones/goals;
  per-mood music loops (6 palettes in `specs/all.json`); idle polish. NOTE: photos in the macOS **Photos library** are unreadable from bash
  (TCC blocks `cp`/`sips`/`qlmanage` on `~/Pictures/Photos Library.photoslibrary/originals/…`)
  — have the user drag the image into chat or export it to `studio/refs/` to use as a gen ref.

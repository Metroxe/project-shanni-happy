export const meta = {
  name: 'env-visual-qa',
  description: 'Fan out vision inspectors over the captured QA screenshots to catalog visual defects',
  phases: [
    { title: 'Inspect', detail: 'zone inspectors + defect-class specialists read the shots' },
    { title: 'Synthesize', detail: 'dedup + prioritize into one defect list' },
  ],
};

const DIR = '/Users/cvp/Documents/projects/project-shanni-happy/.claude/worktrees/unruffled-sanderson-c5835f/studio/out/qa';
const f = n => `${DIR}/${n}.png`;

const TAXONOMY = `Hunt for these defect classes (papercraft city, clean flat pastel Paper-Mario look):
1. ABYSS/VOID — any sightline hitting empty space, the horizon with no city, an edge-of-world drop-off, the flat ground ending into nothing, or a gap in the surrounding buildings. THE most important: the player must NEVER see the void.
2. CLIPPING — geometry intersecting wrong: shop windows/doors/facade sunk INTO the ground or floating above it; props half-buried or floating; the character clipping through a prop; buildings interpenetrating oddly; stair railings clipping into walls.
3. Z-FIGHTING / FLICKER — overlapping coplanar surfaces (road vs plaza vs sidewalk) showing a seam or shimmer.
4. STRAY OUTLINES — cream/white outline lines on rounded or small props (fountain, bushes, benches, awnings, lamps) that look like artifacts rather than intentional die-cut edges.
5. OVERLAP — props overlapping each other (bush growing through bush, prop inside a building/wall).
6. ORIENTATION — a prop facing the wrong way (lamp head, bench, awning, a storefront door/facade not facing the street/sidewalk).
7. SCALE/PLACEMENT — anything mis-sized, oddly placed, floating, or half-buried.
8. AESTHETIC — clashing colors, visual clutter, anything off the calm clean pastel papercraft direction.

NAMED REGRESSIONS — specific defects Christopher has flagged before; check each BY NAME in every shot (append when he reports a new SUBJECTIVE one that can't be a deterministic code check — see CLAUDE.md "QA reflex" step 3). Deterministic versions live in studio/qa/checks/:
  a. PITCH-WHITE / blank background in any room or loading zone — every scene must have an intentional non-white skybox/colour.
  b. FLOOR OVERRUN — a room/zone floor that visibly continues PAST the wall/seam into the void; the floor must stop at the wall.
  c. INTERIOR OVERLAP — a door with wall texture over it, a fish tank inside a shelf, any two interior pieces interpenetrating.
  d. WALLS NOT FLUSH — interior walls that don't line up at corners, sit at inconsistent heights, or leave a gap.
  e. BLURRY / MIS-ALIGNED TEXTURE — stretched low-res maps, building textures that don't line up across faces (prefer modelled structure over big textures in the foreground).
  f. TEXTURE SEAM — a hard, unblended join where two materials/textures meet.
  g. SKY-GAP — pale sky/light seeping through a vertical gap between two adjacent shopfronts/buildings (an abyss leak).
  h. OFF-COLOUR GROUND BAND — a flat ground surface (grass/path/plaza) whose hue clashes with the warm-neutral palette (e.g. a saturated yellow-green strip flipping G>R against warm-gray ground) OR that doesn't cover its intended region, leaving warm base-ground slivers — so it reads as a coplanar band "bleeding through" rather than a deliberate lawn/path. A real surface must HARMONISE (soft, on-palette) and FULLY cover its area, meeting believable boundaries (stairs/hedge/building), not float a stray edge on open ground.

For EACH defect: which shot, which class, severity (high/med/low), and a precise detail of WHAT and WHERE in the frame. If a shot looks clean, do not invent problems. Be specific and visual.`;

const READ = files => `You are a meticulous visual-QA inspector for a 3D papercraft game. Read (open) EACH of these image files and look at them carefully:\n${files.map(f).join('\n')}\n\n${TAXONOMY}\n\nReturn your findings.`;

const SCHEMA = { type:'object', additionalProperties:false, properties:{ findings:{ type:'array', items:{
  type:'object', additionalProperties:false,
  properties:{ shot:{type:'string'}, cls:{type:'string'}, severity:{type:'string', enum:['high','med','low']}, detail:{type:'string'} },
  required:['shot','cls','severity','detail'] } } }, required:['findings'] };

// zone groups
const G = {
  plaza: ['cam_plaza-spawn','cam_plaza-west','cam_plaza-east','cam_plaza-north','cam_plaza-fountain','look_detail-fountain'],
  vroadCorner: ['cam_vroad-top','cam_vroad-mid','cam_vroad-bottom','cam_corner','cam_corner-west','look_detail-corner-bld','look_detail-lamp'],
  hroadStairs: ['cam_hroad-west','cam_hroad-mid','cam_hroad-east','cam_stairs-top','cam_stairs-mid','cam_stairs-bottom','look_detail-stairs','look_detail-storefront'],
  park: ['cam_park-center','cam_park-west','cam_park-east','cam_park-front','cam_park-playground','look_detail-playground'],
  abyss: ['look_birdseye','look_abyss-plaza-N','look_abyss-plaza-W','look_abyss-vroad-W','look_abyss-hroad-E','look_abyss-park-E','look_abyss-park-S','look_abyss-park-W'],
};
const ALL = Object.values(G).flat();

phase('Inspect');
const jobs = [
  ...Object.entries(G).map(([k,files]) => ({label:`zone:${k}`, files, lens:''})),
  // defect-class specialists sweep ALL shots, each with a sharpened lens
  {label:'spec:abyss', files:ALL, lens:'\nFOCUS ESPECIALLY on ABYSS/VOID and gaps in the surrounding city — scrutinize every frame edge and horizon.'},
  {label:'spec:clip', files:ALL, lens:'\nFOCUS ESPECIALLY on CLIPPING + Z-FIGHTING + STRAY OUTLINES — windows/props meeting the ground, rails into walls, coplanar seams, artifact outlines.'},
  {label:'spec:place', files:ALL, lens:'\nFOCUS ESPECIALLY on ORIENTATION + OVERLAP + SCALE/PLACEMENT — props facing wrong, overlapping, mis-sized, floating, or buried.'},
];

const results = await parallel(jobs.map(j => () =>
  agent(READ(j.files) + j.lens, { label: j.label, phase: 'Inspect', schema: SCHEMA, agentType: 'general-purpose' })
    .then(r => ({ job: j.label, findings: (r && r.findings) || [] }))
));

const all = results.filter(Boolean).flatMap(r => r.findings.map(x => ({...x, by: r.job})));
log(`collected ${all.length} raw findings from ${results.filter(Boolean).length} inspectors`);

phase('Synthesize');
const critic = await agent(
  `You are the lead QA synthesizer for a papercraft city game. Below are raw visual-defect findings from many independent inspectors (some overlap). `+
  `Dedup them, drop false positives / non-issues, and produce a CLEAN prioritized list of REAL defects to fix, highest severity first. `+
  `Group near-duplicates into one item and note how many inspectors saw it (confidence). For each: a short title, the affected shots/area, severity, and a concrete fix hint. `+
  `Also add a final "completeness" note: what areas or defect classes look CLEAN (verified good), and anything you suspect wasn't captured and should be re-shot.\n\n`+
  `RAW FINDINGS (JSON):\n${JSON.stringify(all)}`,
  { label: 'synthesize', phase: 'Synthesize' }
);

return { rawCount: all.length, inspectors: results.filter(Boolean).length, report: critic };

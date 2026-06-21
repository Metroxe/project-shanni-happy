// pcss.js — Percentage-Closer Soft Shadows for the sun.
//
// WHY: PCFSoftShadowMap gives a fixed-width DITHERED blur that reads as fuzzy/jagged, and VSM
// light-bleeds small props away. Neither is a real penumbra. PCSS estimates the sun as an AREA
// light: it searches the shadow map for the average BLOCKER depth, then widens the filter with
// the occluder→receiver distance. Result = a shadow that's crisp where an object MEETS the
// ground and bleeds softer the farther it gets — what a real soft shadow does, smoothly.
//
// HOW: we patch THREE.ShaderChunk.shadowmap_pars_fragment (a GLOBAL, shared by every lit
// material) so getShadow() returns PCSS. Must run BEFORE any material compiles. The injected
// helpers only use unpackRGBAToDepth / texture2D / rand / PI2 — all defined earlier in the
// assembled fragment shader — so there's no forward-reference. Defensive: if the r160 markers
// aren't found (a three.js upgrade moved them), we no-op and the renderer keeps its PCF type.
//
// The classic three.js PCSS sample targets a PERSPECTIVE spotlight (NEAR_PLANE / similar
// triangles). Our sun is an ORTHOGRAPHIC directional light, so depth is LINEAR and the penumbra
// is simply proportional to the receiver→blocker depth gap — adapted below.
import * as THREE from 'three';

// --- tunables (baked as #defines; edit + bump game.html's ?v to retune) -----
//   LIGHT_SIZE : blocker-search radius in shadow-UV ~ the sun/sky source size
//   SOFT       : how fast the penumbra grows with occluder distance (contact-hardening)
//   MIN / MAX  : clamp on the filter radius (a hair of softness at contact; cap the far bleed)
//   SAMPLES    : poisson taps for the blocker search AND the filter (×2) — smoothness vs cost
const PCSS_GLSL = `
#define PCSS_SAMPLES 16
#define PCSS_LIGHT_SIZE 0.004
#define PCSS_SOFT 0.13
#define PCSS_MIN 0.0006
#define PCSS_MAX 0.006
vec2 pcssDisk[ PCSS_SAMPLES ];
void pcssInit( const in vec2 seed ) {
	float angStep = PI2 * 11.0 / float( PCSS_SAMPLES );
	float inv = 1.0 / float( PCSS_SAMPLES );
	float ang = rand( seed ) * PI2;
	float r = inv, rStep = inv;
	for ( int i = 0; i < PCSS_SAMPLES; i ++ ) {
		pcssDisk[ i ] = vec2( cos( ang ), sin( ang ) ) * pow( r, 0.75 );
		r += rStep; ang += angStep;
	}
}
float pcssBlocker( sampler2D smap, vec2 uv, float zR ) {
	float sum = 0.0; int n = 0;
	for ( int i = 0; i < PCSS_SAMPLES; i ++ ) {
		float d = unpackRGBAToDepth( texture2D( smap, uv + pcssDisk[ i ] * PCSS_LIGHT_SIZE ) );
		if ( d < zR ) { sum += d; n ++; }
	}
	if ( n == 0 ) return -1.0;
	return sum / float( n );
}
float pcssFilter( sampler2D smap, vec2 uv, float zR, float rad ) {
	float sum = 0.0;
	for ( int i = 0; i < PCSS_SAMPLES; i ++ ) {
		if ( zR <= unpackRGBAToDepth( texture2D( smap, uv + pcssDisk[ i ] * rad ) ) ) sum += 1.0;
		if ( zR <= unpackRGBAToDepth( texture2D( smap, uv - pcssDisk[ i ].yx * rad ) ) ) sum += 1.0;
	}
	return sum / ( 2.0 * float( PCSS_SAMPLES ) );
}
float PCSS( sampler2D smap, vec4 coords ) {
	vec2 uv = coords.xy; float zR = coords.z;
	pcssInit( uv );
	float avg = pcssBlocker( smap, uv, zR );      // average occluder depth
	if ( avg < 0.0 ) return 1.0;                   // nothing occludes → fully lit
	float penumbra = ( zR - avg ) * PCSS_SOFT;     // grows with occluder→receiver gap (ortho = linear)
	float rad = clamp( penumbra, PCSS_MIN, PCSS_MAX );
	return pcssFilter( smap, uv, zR, rad );
}
`;
const PCSS_GET = '\n\t\treturn PCSS( shadowMap, shadowCoord );\n';

let installed = false;
export function installPCSS() {
	if ( installed ) return true;
	try {
		let s = THREE.ShaderChunk.shadowmap_pars_fragment;
		if ( ! s.includes( '#ifdef USE_SHADOWMAP' ) || ! s.includes( '#if defined( SHADOWMAP_TYPE_PCF )' ) )
			return false;                                                  // markers gone → bail, keep PCF
		// inject the helpers inside the USE_SHADOWMAP guard (before getShadow), then make
		// getShadow short-circuit to PCSS for the directional sun.
		s = s.replace( '#ifdef USE_SHADOWMAP', '#ifdef USE_SHADOWMAP' + PCSS_GLSL );
		s = s.replace( '#if defined( SHADOWMAP_TYPE_PCF )', PCSS_GET + '\t\t#if defined( SHADOWMAP_TYPE_PCF )' );
		THREE.ShaderChunk.shadowmap_pars_fragment = s;
		installed = true;
		return true;
	} catch ( e ) {
		console.warn( '[pcss] install failed, plain PCF shadows:', e );
		return false;
	}
}
export const pcssReady = () => installed;

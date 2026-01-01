import * as THREE from "three";
import { SplatMesh, dyno } from "@sparkjsdev/spark";

/**
 * Ghostly avatar made from procedural splats with fBm undulation and shimmer.
 */
export class GhostAvatar {
  constructor({
    radius = 0.2,
    splatCount = 300,
    baseColor = new THREE.Color(0x00d4ff),
    opacity = 0.95,
    pulseSpeed = 1.0,
    wobbleAmp = 0.25,
  } = {}) {
    this.radius = radius;
    this.splatCount = splatCount;
    this.baseColor = baseColor instanceof THREE.Color ? baseColor : new THREE.Color(baseColor);
    this.opacity = opacity;
    this.pulseSpeed = pulseSpeed;
    this.wobbleAmp = wobbleAmp;

    // Animation time uniform
    this.time = dyno.dynoFloat(0);

    this.mesh = new SplatMesh({
      constructSplats: (splats) => this._constructSplats(splats),
      raycastable: false,
    });

    this._setupDyno();
  }

  _constructSplats(splats) {
    const center = new THREE.Vector3();
    const scales = new THREE.Vector3();
    const quat = new THREE.Quaternion();

    // Random points in a sphere for a soft blob
    for (let i = 0; i < this.splatCount; i++) {
      // sample direction
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.cbrt(Math.random()) * this.radius; // bias toward center
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      center.set(x, y, z);
      // slight size jitter
      const s = (this.radius * 0.2) * (0.6 + Math.random() * 0.8);
      scales.setScalar(s);
      splats.pushSplat(center, scales, quat, this.opacity, this.baseColor);
    }
  }

  _setupDyno() {
    // fBm-based breathing / wobble and shimmering color
    this.mesh.objectModifier = dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const blob = new dyno.Dyno({
          inTypes: { gsplat: dyno.Gsplat, t: "float", radius: "float" },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              float hash21(vec2 p){
                p = fract(p*vec2(234.34,435.345));
                p += dot(p,p+34.23);
                return fract(p.x*p.y);
              }
              float noise(vec2 p){
                vec2 i=floor(p);
                vec2 f=fract(p);
                f=f*f*(3.0-2.0*f);
                float a=hash21(i);
                float b=hash21(i+vec2(1,0));
                float c=hash21(i+vec2(0,1));
                float d=hash21(i+vec2(1,1));
                return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
              }
              float fbm(vec2 p){
                float v=0.0; float amp=0.5; float freq=1.0;
                for(int i=0;i<5;i++){
                  v+=amp*noise(p*freq);
                  freq*=2.0;
                  amp*=0.5;
                }
                return v;
              }
            `),
          ],
          statements: ({ inputs, outputs }) => dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};
            vec3 p = ${inputs.gsplat}.center;
            float r = ${inputs.radius};
            float dist = length(p);
            float edgeFalloff = smoothstep(r, 0.0, dist);

            // fBm wobble - multi axis for organic motion
            float n = fbm(p.xy * 4.0 + ${inputs.t} * ${this.pulseSpeed.toFixed(3)});
            float n2 = fbm(p.yz * 4.0 + ${inputs.t} * 0.7);
            float n3 = fbm(p.xz * 4.0 + ${inputs.t} * 0.9);
            float wobble = (n - 0.5) * ${this.wobbleAmp.toFixed(3)};
            vec3 wobbleDir = normalize(p + 0.001);
            wobbleDir += vec3(n2 - 0.5, n - 0.5, n3 - 0.5) * 0.4;
            ${outputs.gsplat}.center = p + wobbleDir * wobble * edgeFalloff * r;

            // Bright color with glow, shimmer, and sparkle
            vec3 base = ${inputs.gsplat}.rgba.rgb;
            
            // Mix toward white for brighter core
            float coreBright = smoothstep(r, 0.0, dist) * 0.6;
            base = mix(base, vec3(1.0), coreBright);
            
            // Pulse glow
            float glow = fbm(p.yz * 6.0 + ${inputs.t} * 1.5);
            float pulse = 0.8 + 0.5 * glow;
            base *= pulse;
            
            // Color shimmer
            vec3 tint = vec3(0.2, 0.3, 0.4) * sin(${inputs.t} * 2.0 + dist * 10.0);
            base += tint * 0.4;
            
            // Edge rim light
            base += 0.3 * edgeFalloff;
            
            // Sparkle effect
            float sparkle = step(0.96, hash21(p.xy * 50.0 + floor(${inputs.t} * 12.0)));
            base += sparkle * 0.5;
            
            ${outputs.gsplat}.rgba.rgb = base;

            // Alpha with soft edges
            ${outputs.gsplat}.rgba.a = ${inputs.gsplat}.rgba.a * (0.6 + 0.4 * edgeFalloff);
          `),
        });

        const result = blob.apply({
          gsplat,
          t: this.time,
          radius: dyno.dynoFloat(this.radius),
        });
        return { gsplat: result.gsplat };
      }
    );

    this.mesh.updateGenerator();
  }

  update(timeMs) {
    this.time.value = timeMs / 1000;
    this.mesh.updateVersion();
  }

  getObject() {
    return this.mesh;
  }
}


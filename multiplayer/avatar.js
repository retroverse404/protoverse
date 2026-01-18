import * as THREE from "three";
import { SplatMesh, dyno, textSplats } from "@sparkjsdev/spark";

/**
 * Create a text label using Spark's text splats
 * @param {string} text - Text to display
 * @param {THREE.Color} color - Text color
 * @returns {SplatMesh}
 */
function createNameLabel(text, color) {
  const textMesh = textSplats({
    text: text,
    font: "Arial",
    fontSize: 48,
    color: color instanceof THREE.Color ? color : new THREE.Color(color),
  });
  
  // Scale to appropriate size for avatar
  textMesh.scale.setScalar(0.15 / 80);
  
  return textMesh;
}

/**
 * Create eyes using procedural splats
 * Eyes are small spherical clusters with darker pupils
 */
class SplatEyes {
  constructor({
    eyeRadius = 0.04,
    pupilRadius = 0.02,
    eyeSpacing = 0.08,
    eyeForward = 0.15,
    eyeHeight = 0.05,
    eyeColor = new THREE.Color(0xffffff),
    pupilColor = new THREE.Color(0x111111),
  } = {}) {
    this.eyeRadius = eyeRadius;
    this.pupilRadius = pupilRadius;
    this.eyeSpacing = eyeSpacing;
    this.eyeForward = eyeForward;
    this.eyeHeight = eyeHeight;
    this.eyeColor = eyeColor;
    this.pupilColor = pupilColor;
    
    // Create group to hold both eyes
    this.group = new THREE.Group();
    
    // Create left eye
    this.leftEye = this._createEye(-this.eyeSpacing);
    this.group.add(this.leftEye);
    
    // Create right eye
    this.rightEye = this._createEye(this.eyeSpacing);
    this.group.add(this.rightEye);
  }
  
  _createEye(xOffset) {
    const mesh = new SplatMesh({
      constructSplats: (splats) => {
        const center = new THREE.Vector3();
        const scales = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        
        // White part of eye - small sphere of splats
        const eyeSplatCount = 50;
        for (let i = 0; i < eyeSplatCount; i++) {
          // Random point in sphere
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const r = Math.cbrt(Math.random()) * this.eyeRadius;
          
          const x = r * Math.sin(phi) * Math.cos(theta);
          const y = r * Math.sin(phi) * Math.sin(theta);
          const z = r * Math.cos(phi);
          
          center.set(x, y, z);
          scales.setScalar(this.eyeRadius * 0.25);
          splats.pushSplat(center, scales, quat, 0.95, this.eyeColor);
        }
        
        // Pupil - smaller dark sphere at front of eye (negative Z is front)
        const pupilSplatCount = 30;
        const pupilOffset = this.eyeRadius * 0.6; // Push pupil toward front
        for (let i = 0; i < pupilSplatCount; i++) {
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const r = Math.cbrt(Math.random()) * this.pupilRadius;
          
          const x = r * Math.sin(phi) * Math.cos(theta);
          const y = r * Math.sin(phi) * Math.sin(theta);
          const z = r * Math.cos(phi) - pupilOffset;
          
          center.set(x, y, z);
          scales.setScalar(this.pupilRadius * 0.3);
          splats.pushSplat(center, scales, quat, 1.0, this.pupilColor);
        }
      },
      raycastable: false,
    });
    
    // Position eye (negative Z is forward/front)
    mesh.position.set(xOffset, this.eyeHeight, -this.eyeForward);
    
    return mesh;
  }
  
  getObject() {
    return this.group;
  }
  
  dispose() {
    if (this.leftEye?.dispose) this.leftEye.dispose();
    if (this.rightEye?.dispose) this.rightEye.dispose();
  }
}

/**
 * Ghostly avatar made from procedural splats with fBm undulation and shimmer.
 * Includes name label and eyes using Spark splats.
 */
export class GhostAvatar {
  constructor({
    radius = 0.2,
    splatCount = 300,
    baseColor = new THREE.Color(0x00d4ff),
    opacity = 0.95,
    pulseSpeed = 1.0,
    wobbleAmp = 0.25,
    name = null,
    showEyes = true,
  } = {}) {
    this.radius = radius;
    this.splatCount = splatCount;
    this.baseColor = baseColor instanceof THREE.Color ? baseColor : new THREE.Color(baseColor);
    this.opacity = opacity;
    this.pulseSpeed = pulseSpeed;
    this.wobbleAmp = wobbleAmp;
    this.name = name;
    this.showEyes = showEyes;

    // Animation time uniform
    this.time = dyno.dynoFloat(0);

    // Create container group for all avatar elements
    this.group = new THREE.Group();

    // Create splat mesh for the ghostly body
    this.mesh = new SplatMesh({
      constructSplats: (splats) => this._constructSplats(splats),
      raycastable: false,
    });
    this.group.add(this.mesh);

    this._setupDyno();

    // Add eyes using procedural splats
    if (this.showEyes) {
      this.eyes = new SplatEyes({
        eyeRadius: 0.04,
        pupilRadius: 0.018,
        eyeSpacing: 0.07,
        eyeForward: this.radius * 0.7,
        eyeHeight: this.radius * 0.2,
      });
      this.group.add(this.eyes.getObject());
    }

    // Add name label using Spark text splats
    if (this.name) {
      this.nameLabel = createNameLabel(this.name, new THREE.Color(0xffffff));
      this.nameLabel.position.set(0, this.radius + 0.25, 0);
      // Rotate 180° around Y so text faces viewers (opposite of avatar's forward direction)
      this.nameLabel.rotation.y = Math.PI;
      this.group.add(this.nameLabel);
    }
  }

  /**
   * Update the name label
   */
  setName(name) {
    this.name = name;
    
    // Remove old label
    if (this.nameLabel) {
      this.group.remove(this.nameLabel);
      if (this.nameLabel.dispose) this.nameLabel.dispose();
      this.nameLabel = null;
    }
    
    // Create new label
    if (name) {
      this.nameLabel = createNameLabel(name, new THREE.Color(0xffffff));
      this.nameLabel.position.set(0, this.radius + 0.25, 0);
      // Rotate 180° around Y so text faces viewers
      this.nameLabel.rotation.y = Math.PI;
      this.group.add(this.nameLabel);
    }
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
    
    // Make name label billboard (face camera) by resetting its world rotation
    // Text splats automatically face the camera in most cases
  }

  getObject() {
    return this.group;
  }
  
  /**
   * Dispose of all resources
   */
  dispose() {
    if (this.nameLabel?.dispose) {
      this.nameLabel.dispose();
    }
    if (this.eyes) {
      this.eyes.dispose();
    }
    if (this.mesh?.dispose) {
      this.mesh.dispose();
    }
  }
}

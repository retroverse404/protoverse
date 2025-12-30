import * as THREE from "three";
import { SplatMesh, dyno } from "@sparkjsdev/spark";

// Shared time uniform for all animated disks
const globalTime = dyno.dynoFloat(0);

/**
 * Update the global animation time for all SparkDisks
 * Call this once per frame in your animation loop
 * @param {number} time - Time in milliseconds
 */
export function updateDiskAnimation(time) {
  globalTime.value = time / 1000;
}

/**
 * Creates an animated filled disk using procedural gaussian splats
 * Used to cover portal openings in VR mode with a cool swirling effect
 */
export class SparkDisk {
  constructor(options = {}) {
    const {
      radius = 1.0,              // Radius of the disk
      radialSegments = 48,       // Number of segments around the disk
      concentricRings = 24,      // Number of concentric rings from center to edge
      color = new THREE.Color(0x4400ff), // Deep purple/blue for portal effect
      opacity = 0.9
    } = options;

    this.radius = radius;
    this.radialSegments = radialSegments;
    this.concentricRings = concentricRings;
    this.color = color;
    this.opacity = opacity;

    // Create the splat mesh with procedural splats
    this.mesh = new SplatMesh({
      constructSplats: (splats) => {
        this._constructDiskSplats(splats);
      },
    });

    // Set up the animation modifier
    this._setupAnimation();
  }

  _constructDiskSplats(splats) {
    const center = new THREE.Vector3();
    const scales = new THREE.Vector3();
    const quaternion = new THREE.Quaternion(); // Identity quaternion

    // Calculate splat size to ensure good coverage
    const ringSpacing = this.radius / this.concentricRings;
    const splatScale = ringSpacing * 0.5;

    // Generate splats in concentric rings (disk is in XY plane, facing +Z)
    for (let ring = 0; ring <= this.concentricRings; ring++) {
      const ringRadius = (ring / this.concentricRings) * this.radius;
      
      // Number of splats in this ring (more splats in outer rings)
      const splatsInRing = ring === 0 ? 1 : Math.max(8, Math.floor(this.radialSegments * (ring / this.concentricRings)));
      
      for (let i = 0; i < splatsInRing; i++) {
        const angle = (i / splatsInRing) * Math.PI * 2;
        
        // Calculate position on the disk surface (XY plane)
        const x = ringRadius * Math.cos(angle);
        const y = ringRadius * Math.sin(angle);
        const z = 0;

        center.set(x, y, z);

        // Scale splats
        const scaleFactor = ring === 0 ? splatScale * 1.2 : splatScale;
        scales.setScalar(scaleFactor);

        // Push the splat with base color
        splats.pushSplat(center, scales, quaternion, this.opacity, this.color);
      }
    }
  }

  _setupAnimation() {
    // Create the dyno animation modifier
    this.mesh.objectModifier = dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const portalEffect = new dyno.Dyno({
          inTypes: { 
            gsplat: dyno.Gsplat, 
            t: "float",
            diskRadius: "float"
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              // Rotation matrix in 2D
              mat2 rot2D(float a) {
                float s = sin(a), c = cos(a);
                return mat2(c, -s, s, c);
              }
              
              // Smooth noise for organic motion
              float hash(float n) {
                return fract(sin(n) * 43758.5453);
              }
              
              // Portal swirl effect
              vec4 portalSwirl(vec3 pos, float t, float radius) {
                // Distance from center (in XY plane)
                float dist = length(pos.xy);
                float normalizedDist = dist / radius;
                
                // Swirling rotation - faster in center, slower at edges
                float swirlSpeed = 2.0;
                float swirlAmount = (1.0 - normalizedDist) * 3.0;
                float angle = swirlAmount * sin(t * swirlSpeed) + t * 0.5;
                
                // Apply rotation
                vec2 rotated = rot2D(angle) * pos.xy;
                
                // Inward pull animation
                float pullStrength = 0.15;
                float pull = sin(t * 3.0 + normalizedDist * 6.28) * pullStrength * (1.0 - normalizedDist);
                rotated *= (1.0 - pull);
                
                // Z-axis wobble for depth
                float zWobble = sin(t * 2.0 + dist * 5.0) * 0.05 * normalizedDist;
                
                return vec4(rotated.x, rotated.y, pos.z + zWobble, normalizedDist);
              }
              
              // Color cycling for portal energy
              vec3 portalColor(float dist, float t) {
                // Base colors: deep purple -> cyan -> white at center
                vec3 outer = vec3(0.2, 0.0, 0.4);  // Deep purple
                vec3 mid = vec3(0.0, 0.5, 1.0);     // Cyan
                vec3 inner = vec3(0.8, 0.9, 1.0);   // Bright white-blue
                
                // Animated color bands
                float wave = sin(dist * 10.0 - t * 4.0) * 0.5 + 0.5;
                
                // Blend based on distance
                vec3 color;
                if (dist < 0.3) {
                  color = mix(inner, mid, dist / 0.3);
                } else if (dist < 0.7) {
                  color = mix(mid, outer, (dist - 0.3) / 0.4);
                } else {
                  color = outer;
                }
                
                // Add energy pulses
                float pulse = sin(t * 5.0 + dist * 8.0) * 0.3 + 0.7;
                color *= pulse;
                
                // Add sparkle at random positions
                float sparkle = step(0.97, hash(dist * 100.0 + floor(t * 10.0))) * 0.5;
                color += sparkle;
                
                return color;
              }
            `)
          ],
          statements: ({ inputs, outputs }) => dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};
            
            vec3 localPos = ${inputs.gsplat}.center;
            vec4 splatColor = ${inputs.gsplat}.rgba;
            
            // Apply portal swirl effect
            vec4 swirl = portalSwirl(localPos, ${inputs.t}, ${inputs.diskRadius});
            ${outputs.gsplat}.center = vec3(swirl.xy, swirl.z);
            
            // Apply animated color
            vec3 newColor = portalColor(swirl.w, ${inputs.t});
            ${outputs.gsplat}.rgba.rgb = newColor;
            
            // Fade alpha at edges
            float edgeFade = smoothstep(1.0, 0.7, swirl.w);
            ${outputs.gsplat}.rgba.a = splatColor.a * edgeFade;
          `),
        });

        gsplat = portalEffect.apply({ 
          gsplat, 
          t: globalTime,
          diskRadius: dyno.dynoFloat(this.radius)
        }).gsplat;
        
        return { gsplat };
      }
    );

    this.mesh.updateGenerator();
  }

  /**
   * Update the animation - call this every frame when visible
   */
  update() {
    if (this.mesh.visible) {
      this.mesh.updateVersion();
    }
  }

  /**
   * Get the THREE.Object3D mesh (SplatMesh instance)
   */
  getMesh() {
    return this.mesh;
  }

  /**
   * Position the disk at the given location
   * @param {THREE.Vector3|number[]} position 
   */
  setPosition(position) {
    if (Array.isArray(position)) {
      this.mesh.position.fromArray(position);
    } else {
      this.mesh.position.copy(position);
    }
  }

  /**
   * Set the rotation of the disk
   * @param {THREE.Quaternion|number[]} rotation - Quaternion or [x, y, z, w] array
   */
  setRotation(rotation) {
    if (Array.isArray(rotation)) {
      this.mesh.quaternion.fromArray(rotation);
    } else {
      this.mesh.quaternion.copy(rotation);
    }
  }

  /**
   * Show or hide the disk
   * @param {boolean} visible 
   */
  setVisible(visible) {
    this.mesh.visible = visible;
  }

  /**
   * Dispose of the disk mesh
   */
  dispose() {
    if (this.mesh && this.mesh.dispose) {
      this.mesh.dispose();
    }
  }
}


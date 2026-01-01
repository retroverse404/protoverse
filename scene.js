import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { worldToUniverse } from "./coordinate-transform.js";
import { setupPortalLighting } from "./port.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// GLTFLoader instance for loading collision meshes
const gltfLoader = new GLTFLoader();

/**
 * ProtoScene - Manages the Three.js scene, camera, renderer, and local frame
 */
export class ProtoScene {
    constructor() {
        // ========== Scene Setup ==========
        this.scene = new THREE.Scene();

        // ========== Camera Setup ==========
        this.camera = new THREE.PerspectiveCamera(
            90,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        // ========== Renderer Setup ==========
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);

        // ========== Local Frame Setup ==========
        // Local frame for camera (used for movement and teleportation)
        this.localFrame = new THREE.Group();
        this.scene.add(this.localFrame);
        this.localFrame.add(this.camera);
        this.localFrame.position.set(0, 2, 0);

        // Setup lighting for portal materials
        setupPortalLighting(this.scene, this.camera);
    }

    /**
     * Get the scene instance
     * @returns {THREE.Scene}
     */
    getScene() {
        return this.scene;
    }

    /**
     * Get the camera instance
     * @returns {THREE.PerspectiveCamera}
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Get the renderer instance
     * @returns {THREE.WebGLRenderer}
     */
    getRenderer() {
        return this.renderer;
    }

    /**
     * Get the local frame instance
     * @returns {THREE.Group}
     */
    getLocalFrame() {
        return this.localFrame;
    }

    /**
     * Handle window resize - update camera and renderer
     */
    handleResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Load a splat mesh and set its position
     * @param {string} url - URL to the splat file
     * @param {Array|THREE.Vector3} position - Position [x, y, z] or Vector3
     * @param {number} world - World number (0 for root world)
     * @returns {Promise<SplatMesh>} The loaded mesh
     */
    async loadSplatandSetPosition(url, position = [0, 0, 0], world = 0) {
        console.log("Loading", url);

        const absoluteURL = new URL(url, window.location.href).href;

        const mesh = new SplatMesh({ url: absoluteURL, paged: true });
        await mesh.initialized;

        if (Array.isArray(position)) {
            mesh.position.fromArray(position);
        } else {
            mesh.position.copy(position);
        }
        mesh.quaternion.fromArray([0, 0, 0, 1]);
        if (world !== 0) {
            const universePos = worldToUniverse(mesh.position, world);
            mesh.position.copy(universePos);
        }

        this.scene.add(mesh);
        console.log("Loaded", url);
        return mesh;
    }

    /**
     * Load a collision mesh (GLB) and set its position
     * @param {string} url - URL to the GLB file
     * @param {number} world - World number (0 for root world)
     * @param {boolean} visible - Initial visibility (default false)
     * @returns {Promise<THREE.Group>} The loaded collision mesh
     */
    async loadCollisionMesh(url, world = 0, visible = false) {
        console.log("Loading collision mesh:", url);

        const absoluteURL = new URL(url, window.location.href).href;

        return new Promise((resolve, reject) => {
            gltfLoader.load(
                absoluteURL,
                (gltf) => {
                    const collisionMesh = gltf.scene;
                    
                    // Apply wireframe material to all meshes for debugging visibility
                    collisionMesh.traverse((child) => {
                        if (child.isMesh) {
                            child.material = new THREE.MeshBasicMaterial({
                                color: 0x00ff00,
                                wireframe: true,
                                transparent: true,
                                opacity: 0.5
                            });
                        }
                    });
                    
                    // Transform to universe coordinates if not root world
                    if (world !== 0) {
                        const universePos = worldToUniverse(collisionMesh.position, world);
                        collisionMesh.position.copy(universePos);
                    }
                    
                    // Set initial visibility
                    collisionMesh.visible = visible;
                    
                    this.scene.add(collisionMesh);
                    
                    // Debug: log mesh info
                    let meshCount = 0;
                    collisionMesh.traverse((child) => {
                        if (child.isMesh) meshCount++;
                    });
                    console.log("Loaded collision mesh:", url);
                    console.log("  Contains", meshCount, "mesh(es)");
                    console.log("  Position:", collisionMesh.position.toArray());
                    console.log("  Visible:", collisionMesh.visible);
                    
                    resolve(collisionMesh);
                },
                (progress) => {
                    if (progress.total) {
                        console.log(`Loading collision mesh: ${(progress.loaded / progress.total * 100).toFixed(0)}%`);
                    }
                },
                (error) => {
                    console.error("Error loading collision mesh:", url, error);
                    reject(error);
                }
            );
        });
    }
}

/**
 * Load world JSON data from a URL
 * @param {string} worldUrl - URL to the world.json file
 * @returns {Promise<Object>} World data object
 */
export async function loadWorldJSON(worldUrl) {
    console.log("loadWorldJSON:", worldUrl);
    // Use cache: 'reload' to force a fresh fetch and bypass browser cache
    // This ensures we always get the latest world.json from the server
    const response = await fetch(worldUrl, {
        cache: 'reload'
    });
    console.log("response:", response);
    const worlddata = await response.json();
    console.log("worlddata:", worlddata);
    return worlddata;
}

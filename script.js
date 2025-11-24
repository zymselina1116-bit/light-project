// ============================================
// LIGHT DETECTION VISUAL PROJECT
// ============================================

class LightVisualizer {
    constructor() {
        this.video = document.getElementById('webcam');
        this.videoCanvas = document.getElementById('video-canvas');
        this.videoCtx = this.videoCanvas.getContext('2d');
        this.analysisCanvas = document.getElementById('analysis-canvas');
        this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
        this.debugInfo = document.getElementById('debug-info');

        // Downsampled resolution for analysis
        this.analysisWidth = 160;
        this.analysisHeight = 120;

        this.analysisCanvas.width = this.analysisWidth;
        this.analysisCanvas.height = this.analysisHeight;

        // Three.js setup
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Effect arrays
        this.effects = [];

        // Video dimensions
        this.videoWidth = 0;
        this.videoHeight = 0;

        // Spawn throttling
        this.spawnCooldown = 0;
        this.spawnInterval = 0.1; // Spawn effects every 0.1 seconds max

        // Stats
        this.frameCount = 0;
        this.lastBrightSpots = [];

        // Debug mode (toggle with 'D' key) - START VISIBLE for testing
        this.debugMode = true;
        this.setupDebugToggle();

        this.init();
    }

    setupDebugToggle() {
        // Toggle debug info with 'D' key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'd' || e.key === 'D') {
                this.debugMode = !this.debugMode;
                const infoDiv = document.getElementById('info');
                infoDiv.style.display = this.debugMode ? 'block' : 'none';
                console.log(`Debug mode: ${this.debugMode ? 'ON' : 'OFF'}`);
            }
        });

        // Show debug info by default for initial testing
        const infoDiv = document.getElementById('info');
        infoDiv.style.display = 'block';
        this.debugInfo.innerHTML = 'Initializing webcam...';
    }

    async init() {
        console.log('Initializing Light Visualizer...');
        this.debugInfo.innerHTML = 'Requesting webcam access...';

        await this.setupWebcam();

        this.debugInfo.innerHTML = 'Setting up 3D renderer...';
        this.setupThreeJS();

        this.debugInfo.innerHTML = 'Ready! Point lights at camera.';
        this.animate();
    }

    async setupWebcam() {
        try {
            console.log('Requesting webcam access...');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });

            this.video.srcObject = stream;

            return new Promise((resolve) => {
                this.video.onloadedmetadata = async () => {
                    this.videoWidth = this.video.videoWidth;
                    this.videoHeight = this.video.videoHeight;

                    // Set video canvas size
                    this.videoCanvas.width = window.innerWidth;
                    this.videoCanvas.height = window.innerHeight;

                    // IMPORTANT: Start playing the video
                    try {
                        await this.video.play();
                        console.log(`✓ Webcam initialized and playing: ${this.videoWidth}x${this.videoHeight}`);
                    } catch (playErr) {
                        console.error('Error playing video:', playErr);
                    }

                    resolve();
                };
            });
        } catch (err) {
            console.error('✗ Error accessing webcam:', err);
            alert('Unable to access webcam. Please grant camera permissions and refresh the page.');
        }
    }

    setupThreeJS() {
        console.log('Setting up Three.js...');

        // Scene
        this.scene = new THREE.Scene();

        // Camera - orthographic for 2D overlay
        this.camera = new THREE.OrthographicCamera(
            -window.innerWidth / 2,
            window.innerWidth / 2,
            window.innerHeight / 2,
            -window.innerHeight / 2,
            0.1,
            1000
        );
        this.camera.position.z = 10;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        document.getElementById('canvas-container').appendChild(this.renderer.domElement);

        console.log('✓ Three.js initialized');

        // Handle window resize
        window.addEventListener('resize', () => {
            const width = window.innerWidth;
            const height = window.innerHeight;

            this.camera.left = -width / 2;
            this.camera.right = width / 2;
            this.camera.top = height / 2;
            this.camera.bottom = -height / 2;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(width, height);
            this.videoCanvas.width = width;
            this.videoCanvas.height = height;
        });
    }

    drawVideoBackground() {
        // Draw video to background canvas (MIRRORED)
        const canvasAspect = this.videoCanvas.width / this.videoCanvas.height;
        const videoAspect = this.videoWidth / this.videoHeight;

        let drawWidth, drawHeight, offsetX, offsetY;

        if (canvasAspect > videoAspect) {
            // Canvas is wider - fit to width
            drawWidth = this.videoCanvas.width;
            drawHeight = drawWidth / videoAspect;
            offsetX = 0;
            offsetY = (this.videoCanvas.height - drawHeight) / 2;
        } else {
            // Canvas is taller - fit to height
            drawHeight = this.videoCanvas.height;
            drawWidth = drawHeight * videoAspect;
            offsetX = (this.videoCanvas.width - drawWidth) / 2;
            offsetY = 0;
        }

        // Mirror horizontally
        this.videoCtx.save();
        this.videoCtx.scale(-1, 1);
        this.videoCtx.drawImage(this.video, -offsetX - drawWidth, offsetY, drawWidth, drawHeight);
        this.videoCtx.restore();
    }

    detectBrightSpots() {
        // Draw video frame to analysis canvas
        this.analysisCtx.drawImage(
            this.video,
            0, 0,
            this.analysisWidth,
            this.analysisHeight
        );

        const imageData = this.analysisCtx.getImageData(
            0, 0,
            this.analysisWidth,
            this.analysisHeight
        );
        const pixels = imageData.data;

        // Create brightness map
        const brightnessMap = [];
        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
            brightnessMap.push(brightness);
        }

        // Find local maxima
        const brightSpots = [];
        const minDistance = 15; // Minimum pixels between bright spots
        const threshold = 100;   // Minimum brightness threshold

        for (let y = 1; y < this.analysisHeight - 1; y++) {
            for (let x = 1; x < this.analysisWidth - 1; x++) {
                const idx = y * this.analysisWidth + x;
                const brightness = brightnessMap[idx];

                if (brightness < threshold) continue;

                // Check if this is a local maximum
                let isLocalMax = true;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const neighborIdx = (y + dy) * this.analysisWidth + (x + dx);
                        if (brightnessMap[neighborIdx] > brightness) {
                            isLocalMax = false;
                            break;
                        }
                    }
                    if (!isLocalMax) break;
                }

                if (isLocalMax) {
                    // Check distance from existing spots
                    let tooClose = false;
                    for (const spot of brightSpots) {
                        const dist = Math.sqrt(
                            Math.pow(spot.x - x, 2) +
                            Math.pow(spot.y - y, 2)
                        );
                        if (dist < minDistance) {
                            tooClose = true;
                            // Keep the brighter one
                            if (brightness > spot.brightness) {
                                spot.x = x;
                                spot.y = y;
                                spot.brightness = brightness;
                            }
                            break;
                        }
                    }

                    if (!tooClose) {
                        brightSpots.push({ x, y, brightness });
                    }
                }
            }
        }

        // Sort by brightness and limit count
        brightSpots.sort((a, b) => b.brightness - a.brightness);
        return brightSpots.slice(0, 20);
    }

    convertToScreenCoords(x, y) {
        // Convert from analysis canvas coords to screen coords
        // Map to full window coordinates first
        const screenXTemp = (x / this.analysisWidth) * window.innerWidth;
        const screenYTemp = (y / this.analysisHeight) * window.innerHeight;

        // Mirror X coordinate (because video is mirrored)
        const mirroredX = window.innerWidth - screenXTemp;

        // Convert to Three.js coordinate system (center origin)
        const screenX = mirroredX - window.innerWidth / 2;
        const screenY = -(screenYTemp - window.innerHeight / 2);

        return { x: screenX, y: screenY };
    }

    spawnEffectsFromBrightSpots(brightSpots) {
        // Only spawn effects if cooldown has expired
        if (this.spawnCooldown > 0) return;

        for (const spot of brightSpots) {
            const coords = this.convertToScreenCoords(spot.x, spot.y);
            const { brightness } = spot;

            // Spawn different effects based on brightness
            if (brightness > 220) {
                // Spawn fireworks
                this.effects.push(new FireworksEffect(
                    this.scene,
                    coords.x,
                    coords.y
                ));
                if (this.debugMode) {
                    console.log(`🎆 Fireworks at (${coords.x.toFixed(0)}, ${coords.y.toFixed(0)}) - brightness: ${brightness.toFixed(0)}`);
                }
            } else if (brightness > 180) {
                // Spawn lightbulb glow
                this.effects.push(new LightbulbEffect(
                    this.scene,
                    coords.x,
                    coords.y
                ));
                if (this.debugMode) {
                    console.log(`💡 Lightbulb at (${coords.x.toFixed(0)}, ${coords.y.toFixed(0)}) - brightness: ${brightness.toFixed(0)}`);
                }
            } else if (brightness > 130) {
                // Spawn candle flame
                this.effects.push(new CandleEffect(
                    this.scene,
                    coords.x,
                    coords.y
                ));
                if (this.debugMode) {
                    console.log(`🕯️  Candle at (${coords.x.toFixed(0)}, ${coords.y.toFixed(0)}) - brightness: ${brightness.toFixed(0)}`);
                }
            } else if (brightness > 100) {
                // Spawn firefly
                this.effects.push(new FireflyEffect(
                    this.scene,
                    coords.x,
                    coords.y
                ));
                if (this.debugMode) {
                    console.log(`✨ Firefly at (${coords.x.toFixed(0)}, ${coords.y.toFixed(0)}) - brightness: ${brightness.toFixed(0)}`);
                }
            }
        }

        // Reset cooldown if we spawned any effects
        if (brightSpots.length > 0) {
            this.spawnCooldown = this.spawnInterval;
        }
    }

    updateEffects(deltaTime) {
        // Update cooldown
        if (this.spawnCooldown > 0) {
            this.spawnCooldown -= deltaTime;
        }

        // Update and remove dead effects
        this.effects = this.effects.filter(effect => {
            effect.update(deltaTime);
            if (effect.isDead()) {
                effect.dispose();
                return false;
            }
            return true;
        });
    }

    updateDebugInfo(brightSpots) {
        // Only update debug info if debug mode is enabled
        if (!this.debugMode) return;

        if (this.frameCount % 30 === 0) { // Update every 30 frames (~0.5 seconds)
            const maxBrightness = brightSpots.length > 0 ? brightSpots[0].brightness.toFixed(0) : 0;
            this.debugInfo.innerHTML = `
                Bright spots: ${brightSpots.length} |
                Max brightness: ${maxBrightness} |
                Active effects: ${this.effects.length}<br>
                <span style="opacity: 0.6; font-size: 10px;">Press 'D' to hide debug info</span>
            `;
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const deltaTime = 0.016; // Approximate 60fps
        this.frameCount++;

        // Draw video background
        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            this.drawVideoBackground();

            // Detect bright spots from webcam
            this.lastBrightSpots = this.detectBrightSpots();
            this.spawnEffectsFromBrightSpots(this.lastBrightSpots);
            this.updateDebugInfo(this.lastBrightSpots);
        } else {
            // Show video status if not ready
            if (this.frameCount % 60 === 0) { // Update once per second
                const states = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
                console.log(`Video readyState: ${states[this.video.readyState] || this.video.readyState}`);
                if (this.debugMode) {
                    this.debugInfo.innerHTML = `Waiting for video... (${states[this.video.readyState] || this.video.readyState})`;
                }
            }
        }

        // Update all effects
        this.updateEffects(deltaTime);

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }
}

// ============================================
// FIREWORKS EFFECT
// ============================================

class FireworksEffect {
    constructor(scene, x, y) {
        this.scene = scene;
        this.particles = [];
        this.lifetime = 0;
        this.maxLifetime = Math.random() * 0.5 + 0.5; // 0.5-1s

        // Create particles
        const particleCount = Math.random() * 30 + 20;
        const colors = [0xff1493, 0x00ffff, 0xffd700, 0xff69b4, 0x00ff00];
        const color = colors[Math.floor(Math.random() * colors.length)];

        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount;
            const speed = Math.random() * 200 + 100;

            const geometry = new THREE.CircleGeometry(3, 8);
            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 1,
                blending: THREE.AdditiveBlending
            });

            const particle = new THREE.Mesh(geometry, material);
            particle.position.set(x, y, 0);

            // Velocity
            particle.velocity = {
                x: Math.cos(angle) * speed,
                y: Math.sin(angle) * speed
            };

            this.scene.add(particle);
            this.particles.push(particle);
        }
    }

    update(deltaTime) {
        this.lifetime += deltaTime;

        const progress = this.lifetime / this.maxLifetime;

        for (const particle of this.particles) {
            // Update position
            particle.position.x += particle.velocity.x * deltaTime;
            particle.position.y += particle.velocity.y * deltaTime;

            // Gravity
            particle.velocity.y -= 300 * deltaTime;

            // Fade out
            particle.material.opacity = 1 - progress;

            // Shrink
            const scale = 1 - progress * 0.5;
            particle.scale.set(scale, scale, 1);
        }
    }

    isDead() {
        return this.lifetime >= this.maxLifetime;
    }

    dispose() {
        for (const particle of this.particles) {
            this.scene.remove(particle);
            particle.geometry.dispose();
            particle.material.dispose();
        }
    }
}

// ============================================
// LIGHTBULB EFFECT
// ============================================

class LightbulbEffect {
    constructor(scene, x, y) {
        this.scene = scene;
        this.lifetime = 0;
        this.maxLifetime = 1.5;

        // Create glowing orb
        const geometry = new THREE.CircleGeometry(30, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffff99,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });

        this.orb = new THREE.Mesh(geometry, material);
        this.orb.position.set(x, y, 0);
        this.scene.add(this.orb);

        // Create halo
        const haloGeometry = new THREE.CircleGeometry(50, 32);
        const haloMaterial = new THREE.MeshBasicMaterial({
            color: 0xffff66,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });

        this.halo = new THREE.Mesh(haloGeometry, haloMaterial);
        this.halo.position.set(x, y, -1);
        this.scene.add(this.halo);

        this.baseScale = 1;
    }

    update(deltaTime) {
        this.lifetime += deltaTime;

        // Pulsing effect
        const pulse = Math.sin(this.lifetime * 8) * 0.1 + 0.9;
        const scale = this.baseScale * pulse;
        this.orb.scale.set(scale, scale, 1);

        // Halo pulse (slightly different phase)
        const haloPulse = Math.sin(this.lifetime * 6) * 0.15 + 0.85;
        this.halo.scale.set(haloPulse, haloPulse, 1);

        // Fade out near end
        const progress = this.lifetime / this.maxLifetime;
        if (progress > 0.7) {
            const fadeProgress = (progress - 0.7) / 0.3;
            this.orb.material.opacity = 0.8 * (1 - fadeProgress);
            this.halo.material.opacity = 0.3 * (1 - fadeProgress);
        }
    }

    isDead() {
        return this.lifetime >= this.maxLifetime;
    }

    dispose() {
        this.scene.remove(this.orb);
        this.scene.remove(this.halo);
        this.orb.geometry.dispose();
        this.orb.material.dispose();
        this.halo.geometry.dispose();
        this.halo.material.dispose();
    }
}

// ============================================
// CANDLE EFFECT
// ============================================

class CandleEffect {
    constructor(scene, x, y) {
        this.scene = scene;
        this.lifetime = 0;
        this.maxLifetime = 2.0;
        this.baseX = x;
        this.baseY = y;

        // Create flame
        const geometry = new THREE.CircleGeometry(15, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending
        });

        this.flame = new THREE.Mesh(geometry, material);
        this.flame.position.set(x, y, 0);
        this.scene.add(this.flame);

        // Create inner flame
        const innerGeometry = new THREE.CircleGeometry(8, 16);
        const innerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending
        });

        this.innerFlame = new THREE.Mesh(innerGeometry, innerMaterial);
        this.innerFlame.position.set(x, y, 1);
        this.scene.add(this.innerFlame);

        this.flickerOffset = Math.random() * 100;
    }

    update(deltaTime) {
        this.lifetime += deltaTime;

        // Flicker effect
        const flicker = Math.sin(this.lifetime * 20 + this.flickerOffset) * 0.2 + 0.8;
        this.flame.material.opacity = 0.9 * flicker;

        // Wobble
        const wobbleX = Math.sin(this.lifetime * 4) * 5;
        const wobbleY = Math.sin(this.lifetime * 6) * 8 + 10; // Drift upward

        this.flame.position.x = this.baseX + wobbleX;
        this.flame.position.y = this.baseY + wobbleY;
        this.innerFlame.position.x = this.baseX + wobbleX * 0.5;
        this.innerFlame.position.y = this.baseY + wobbleY;

        // Scale variation
        const scaleVar = Math.sin(this.lifetime * 15) * 0.15 + 1;
        this.flame.scale.set(scaleVar, scaleVar * 1.2, 1);
        this.innerFlame.scale.set(1, 1.1, 1);

        // Fade out
        const progress = this.lifetime / this.maxLifetime;
        if (progress > 0.7) {
            const fadeProgress = (progress - 0.7) / 0.3;
            this.flame.material.opacity *= (1 - fadeProgress);
            this.innerFlame.material.opacity = 1 - fadeProgress;
        }
    }

    isDead() {
        return this.lifetime >= this.maxLifetime;
    }

    dispose() {
        this.scene.remove(this.flame);
        this.scene.remove(this.innerFlame);
        this.flame.geometry.dispose();
        this.flame.material.dispose();
        this.innerFlame.geometry.dispose();
        this.innerFlame.material.dispose();
    }
}

// ============================================
// FIREFLY EFFECT
// ============================================

class FireflyEffect {
    constructor(scene, x, y) {
        this.scene = scene;
        this.lifetime = 0;
        this.maxLifetime = 2.5;
        this.baseX = x;
        this.baseY = y;

        // Create firefly
        const geometry = new THREE.CircleGeometry(4, 8);
        const material = new THREE.MeshBasicMaterial({
            color: 0x9acd32,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });

        this.firefly = new THREE.Mesh(geometry, material);
        this.firefly.position.set(x, y, 0);
        this.scene.add(this.firefly);

        // Random drift direction
        this.driftAngle = Math.random() * Math.PI * 2;
        this.driftSpeed = Math.random() * 30 + 20;
    }

    update(deltaTime) {
        this.lifetime += deltaTime;

        // Drift movement
        this.firefly.position.x += Math.cos(this.driftAngle) * this.driftSpeed * deltaTime;
        this.firefly.position.y += Math.sin(this.driftAngle) * this.driftSpeed * deltaTime;

        // Change direction occasionally
        this.driftAngle += (Math.random() - 0.5) * 0.1;

        // Blink effect
        const blink = Math.sin(this.lifetime * 10) * 0.5 + 0.5;
        this.firefly.material.opacity = 0.8 * blink;

        // Fade out
        const progress = this.lifetime / this.maxLifetime;
        if (progress > 0.6) {
            const fadeProgress = (progress - 0.6) / 0.4;
            this.firefly.material.opacity *= (1 - fadeProgress);
        }
    }

    isDead() {
        return this.lifetime >= this.maxLifetime;
    }

    dispose() {
        this.scene.remove(this.firefly);
        this.firefly.geometry.dispose();
        this.firefly.material.dispose();
    }
}

// ============================================
// INITIALIZE APPLICATION
// ============================================

window.addEventListener('DOMContentLoaded', () => {
    console.log('=== LIGHT DETECTION VISUAL PROJECT ===');
    console.log('Starting initialization...');
    console.log('');
    console.log('💡 INSTRUCTIONS:');
    console.log('   - Point a light source at your camera');
    console.log('   - Brighter lights = more dramatic effects');
    console.log('   - Press "D" key to toggle debug info');
    console.log('   - Webcam feed is mirrored for natural interaction');
    console.log('');
    new LightVisualizer();
});

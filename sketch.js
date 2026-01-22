let img;
let particles = [];
let points = [];
let mouseRadiusSlider, imgScaleSlider, densitySlider, returnSlider, sepSlider, sensSlider;
let radiusValLabel, scaleValLabel, densityValLabel, returnValLabel, sepValLabel, sensValLabel;
let grid = {};
let cellSize = 25;
let currentColor;
let uiVisible = false;
let colorSlider2D, colorPicker;

// MediaPipe / Camera
let handLandmarker;
let video;
let detections = [];
let handPoints = []; // Stores pre-mapped interaction points
let lastVideoTime = -1;
let useCamera = false;
let cameraToggle;

function preload() {
    img = loadImage('mask.png');
}

function setup() {
    let cnv = createCanvas(windowWidth, windowHeight);

    // Drag and Drop listeners
    cnv.dragOver(() => cnv.style('background-color', 'rgba(0,255,204,0.05)'));
    cnv.dragLeave(() => cnv.style('background-color', 'transparent'));
    cnv.drop(handleFile, () => cnv.style('background-color', 'transparent'));

    // UI elements
    mouseRadiusSlider = select('#mouseRadius');
    imgScaleSlider = select('#imgScale');
    densitySlider = select('#pDensity');
    returnSlider = select('#returnForce');
    sepSlider = select('#pSeparation');
    sensSlider = select('#pSensitivity');

    radiusValLabel = select('#radiusVal');
    scaleValLabel = select('#scaleVal');
    densityValLabel = select('#densityVal');
    returnValLabel = select('#returnVal');
    sepValLabel = select('#sepVal');
    sensValLabel = select('#sensVal');

    // Reset button
    select('#resetBtn').mousePressed(resetControls);

    // Color Slider
    colorSlider2D = select('#colorSlider2D');
    colorPicker = select('#colorPicker');
    currentColor = color(0, 255, 204); // Initial Cyan

    colorSlider2D.mousePressed(updateColorFromUI);
    colorSlider2D.mouseMoved(() => {
        if (mouseIsPressed) updateColorFromUI();
    });

    loadSavedColor();
    loadSavedParams();

    // Load image pixels once for faster sampling
    img.loadPixels();
    generateTargets();

    for (let pt of points) {
        particles.push(new Particle(pt.x, pt.y));
    }

    // Update targets on slider input
    imgScaleSlider.input(() => { updateParticleTargets(); saveParams(); });
    densitySlider.input(() => { updateParticleTargets(); saveParams(); });

    // Save other sliders on input
    mouseRadiusSlider.input(saveParams);
    returnSlider.input(saveParams);
    sepSlider.input(saveParams);
    sensSlider.input(saveParams);

    cameraToggle = select('#cameraToggle');
    cameraToggle.changed(toggleCamera);

    // Ensure UI is hidden initially
    if (!uiVisible) {
        select('#ui-container').addClass('hidden');
    }
}

function toggleCamera() {
    useCamera = cameraToggle.checked();
    if (useCamera) {
        if (!video) {
            video = createCapture(VIDEO);
            video.size(640, 480);
            video.hide();
        }
        if (!handLandmarker) {
            initHandLandmarker();
        }
    } else {
        // Clear detections if camera is turned off
        detections = [];
    }
}

async function initHandLandmarker() {
    try {
        console.log("Loading MediaPipe...");
        const visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0");
        const { HandLandmarker, FilesetResolver } = visionModule;

        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2
        });
        console.log("Hand Landmarker Initialized");
    } catch (e) {
        console.error("Error initializing Hand Landmarker:", e);
    }
}

function draw() {
    background(5, 5, 10, 80);

    let mouseRadius = float(mouseRadiusSlider.value());
    let imgScale = float(imgScaleSlider.value());
    let density = int(densitySlider.value());
    let returnForceValue = float(returnSlider.value());
    let separationSpace = float(sepSlider.value());
    let sensitivity = float(sensSlider.value());

    radiusValLabel.html(mouseRadius);
    scaleValLabel.html(imgScale);
    densityValLabel.html(density);
    returnValLabel.html(returnForceValue.toFixed(1));
    sepValLabel.html(separationSpace);
    sensValLabel.html(sensitivity);

    // Spatial Partitioning: Build Grid
    grid = {};
    for (let p of particles) {
        let gx = floor(p.pos.x / cellSize);
        let gy = floor(p.pos.y / cellSize);
        let key = `${gx},${gy}`;
        if (!grid[key]) grid[key] = [];
        grid[key].push(p);
    }

    // Detect hands (only if enabled)
    if (useCamera && handLandmarker && video && video.elt.currentTime !== lastVideoTime) {
        let startTimeMs = performance.now();
        detections = handLandmarker.detectForVideo(video.elt, startTimeMs);
        lastVideoTime = video.elt.currentTime;

        // PRE-OPTIMIZATION: Map and filter points once per frame
        handPoints = [];
        if (detections && detections.landmarks) {
            for (let hand of detections.landmarks) {
                // Only use essential points: Wrist (0), and Fingertips (4, 8, 12, 16, 20)
                const essentialIndices = [0, 4, 8, 12, 16, 20];
                for (let idx of essentialIndices) {
                    let landmark = hand[idx];
                    handPoints.push(createVector(
                        map(landmark.x, 1, 0, 0, width),
                        map(landmark.y, 0, 1, 0, height)
                    ));
                }
            }
        }
    }

    for (let p of particles) {
        p.maxforce = 0.5 * returnForceValue;

        // Apply constant behaviors (arrive + hover) ONCE
        p.applyBasicBehaviors();

        // Apply mouse interaction
        p.interact(createVector(mouseX, mouseY), mouseRadius);

        // Apply hand interaction (using pre-mapped points)
        if (useCamera) {
            for (let hp of handPoints) {
                p.interact(hp, mouseRadius);
            }
        }

        let separation = p.repelGrid(grid, cellSize, separationSpace, sensitivity);
        p.applyForce(separation.mult(0.6));

        p.update();
        p.show();
    }

    // Draw hand skeleton (White)
    drawHandSkeleton();
}

function drawHandSkeleton() {
    if (detections && detections.landmarks) {
        stroke(255);
        strokeWeight(2);
        noFill();
        for (let hand of detections.landmarks) {
            // Draw connections
            drawHandConnections(hand);
            // Draw points
            for (let landmark of hand) {
                let hx = map(landmark.x, 1, 0, 0, width);
                let hy = map(landmark.y, 0, 1, 0, height);
                ellipse(hx, hy, 8, 8);
            }
        }
    }
}

function drawHandConnections(hand) {
    // MediaPipe Hand Connections (simplified index mapping for common lines)
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [5, 9], [9, 10], [10, 11], [11, 12], // Middle
        [9, 13], [13, 14], [14, 15], [15, 16], // Ring
        [13, 17], [17, 18], [18, 19], [19, 20], [0, 17] // Pinky & Palm
    ];

    for (let [i, j] of connections) {
        let x1 = map(hand[i].x, 1, 0, 0, width);
        let y1 = map(hand[i].y, 0, 1, 0, height);
        let x2 = map(hand[j].x, 1, 0, 0, width);
        let y2 = map(hand[j].y, 0, 1, 0, height);
        line(x1, y1, x2, y2);
    }
}

function handleFile(file) {
    if (file.type === 'image') {
        img = loadImage(file.data, () => {
            img.loadPixels();
            updateParticleTargets();
            console.log("New mask loaded via drag and drop");
        });
    } else {
        console.log("Not an image file!");
    }
}

function generateTargets() {
    points = [];
    let scaleFactor = float(imgScaleSlider.value());
    let spacing = int(densitySlider.value());

    // Sample directly from pre-loaded image pixels
    for (let x = 0; x < img.width; x += spacing) {
        for (let y = 0; y < img.height; y += spacing) {
            let index = (x + y * img.width) * 4;
            let r = img.pixels[index];
            let g = img.pixels[index + 1];
            let b = img.pixels[index + 2];

            if (r < 128 && g < 128 && b < 128) {
                points.push({
                    x: (x - img.width / 2) * scaleFactor + width / 2,
                    y: (y - img.height / 2) * scaleFactor + height / 2
                });
            }
        }
    }
}

// Update targets when scale changes
function mouseReleased() {
    if (mouseX < 250 && mouseY < 250) { // If slider was likely adjusted
        updateParticleTargets();
    }
}

function updateParticleTargets() {
    generateTargets();
    // Re-assign targets to existing particles (or adjust particle count)
    if (points.length > particles.length) {
        // Add more particles if points increased
        for (let i = particles.length; i < points.length; i++) {
            let p = new Particle(random(width), random(height));
            p.target = createVector(points[i].x, points[i].y);
            particles.push(p);
        }
    } else if (points.length < particles.length) {
        // Remove particles if points decreased
        particles.splice(points.length);
    }

    // Sync points to particles
    for (let i = 0; i < points.length; i++) {
        particles[i].target.set(points[i].x, points[i].y);
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    updateParticleTargets();
}

function keyPressed() {
    if (key === 'u' || key === 'U') {
        uiVisible = !uiVisible;
        if (uiVisible) {
            select('#ui-container').removeClass('hidden');
        } else {
            select('#ui-container').addClass('hidden');
        }
    }
}

function updateColorFromUI() {
    // Basic mapping: X -> Hue (0 to 360)
    let rect = colorSlider2D.elt.getBoundingClientRect();
    let x = constrain(mouseX - rect.left, 0, rect.width);
    let y = constrain(mouseY - rect.top, 0, rect.height);

    colorPicker.style('left', x + 'px');
    colorPicker.style('top', y + 'px');

    colorMode(HSB, 360, 100, 100);
    let h = map(x, 0, rect.width, 0, 360);
    let s, b;

    if (y < rect.height / 2) {
        // Top to middle: White to Full Color
        s = map(y, 0, rect.height / 2, 0, 100);
        b = 100;
    } else {
        // Middle to bottom: Full Color to Black
        s = 100;
        b = map(y, rect.height / 2, rect.height, 100, 0);
    }

    currentColor = color(h, s, b);
    colorMode(RGB, 255);

    // Save state to localStorage
    localStorage.setItem('particleColorX', (x / rect.width).toFixed(4));
    localStorage.setItem('particleColorY', (y / rect.height).toFixed(4));

    // Broadcast color update to all particles
    for (let p of particles) {
        p.color = currentColor;
    }
}

function loadSavedColor() {
    let savedX = localStorage.getItem('particleColorX');
    let savedY = localStorage.getItem('particleColorY');

    if (savedX !== null && savedY !== null) {
        let rect = colorSlider2D.elt.getBoundingClientRect();
        // Fallback to a fixed width if rect isn't available/ready (though it should be in setup)
        let w = rect.width || 180;
        let h_rect = rect.height || 180;

        let x = float(savedX) * w;
        let y = float(savedY) * h_rect;

        colorPicker.style('left', x + 'px');
        colorPicker.style('top', y + 'px');

        colorMode(HSB, 360, 100, 100);
        let h = map(x, 0, w, 0, 360);
        let s, b;

        if (y < h_rect / 2) {
            s = map(y, 0, h_rect / 2, 0, 100);
            b = 100;
        } else {
            s = 100;
            b = map(y, h_rect / 2, h_rect, 100, 0);
        }

        currentColor = color(h, s, b);
        colorMode(RGB, 255);
    }
}

function saveParams() {
    localStorage.setItem('mouseRadius', mouseRadiusSlider.value());
    localStorage.setItem('imgScale', imgScaleSlider.value());
    localStorage.setItem('pDensity', densitySlider.value());
    localStorage.setItem('returnForce', returnSlider.value());
    localStorage.setItem('pSeparation', sepSlider.value());
    localStorage.setItem('pSensitivity', sensSlider.value());
}

function loadSavedParams() {
    if (localStorage.getItem('mouseRadius') !== null) mouseRadiusSlider.value(localStorage.getItem('mouseRadius'));
    if (localStorage.getItem('imgScale') !== null) imgScaleSlider.value(localStorage.getItem('imgScale'));
    if (localStorage.getItem('pDensity') !== null) densitySlider.value(localStorage.getItem('pDensity'));
    if (localStorage.getItem('returnForce') !== null) returnSlider.value(localStorage.getItem('returnForce'));
    if (localStorage.getItem('pSeparation') !== null) sepSlider.value(localStorage.getItem('pSeparation'));
    if (localStorage.getItem('pSensitivity') !== null) sensSlider.value(localStorage.getItem('pSensitivity'));
}

function resetControls() {
    mouseRadiusSlider.value(150);
    imgScaleSlider.value(0.8);
    densitySlider.value(10);
    returnSlider.value(1.0);
    sepSlider.value(12);
    sensSlider.value(5);

    // Refresh targets and particles
    updateParticleTargets();
    saveParams();
}

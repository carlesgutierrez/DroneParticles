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
let handPoints = [];
let lastVideoTime = -1;
let useCamera = false;
let cameraToggle;
let trackingFPS = 0;
let lastTrackingTime = 0;
let trackingFrameCount = 0;
let fpsTimer = 0;
let activeDelegate = "NONE";

// Optimized Grid Variables
let gridCols, gridRows;
let gridBuckets = [];
let gridCount = [];
let maxParticlesPerCell = 10; // Optimization: limit search density

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

    initGrid();
}

function initGrid() {
    cellSize = 25;
    gridCols = ceil(width / cellSize);
    gridRows = ceil(height / cellSize);
    let totalCells = gridCols * gridRows;
    
    gridBuckets = new Int32Array(totalCells * maxParticlesPerCell);
    gridCount = new Int32Array(totalCells);
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
        } else {
            predictWebcam();
        }
    } else {
        detections = [];
        handPoints = [];
    }
}

async function initHandLandmarker() {
    try {
        console.log("Loading MediaPipe 0.10.32...");
        const visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32");
        const { HandLandmarker, FilesetResolver } = visionModule;

        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2
        });
        activeDelegate = "GPU"; // Set after successful initialization
        console.log("Hand Landmarker Initialized");
        predictWebcam();
    } catch (e) {
        activeDelegate = "ERROR";
        console.error("Error initializing Hand Landmarker:", e);
    }
}

async function predictWebcam() {
    if (!useCamera || !handLandmarker || !video) return;

    if (video.elt.readyState >= 2 && video.elt.currentTime !== lastVideoTime) {
        lastVideoTime = video.elt.currentTime;
        let startTimeMs = performance.now();
        detections = handLandmarker.detectForVideo(video.elt, startTimeMs);
        
        // Calculate Tracking FPS
        trackingFrameCount++;
        let now = performance.now();
        if (now - fpsTimer > 1000) {
            trackingFPS = trackingFrameCount;
            trackingFrameCount = 0;
            fpsTimer = now;
        }

        // Update interaction points immediately after detection
        updateHandPoints();
    }
    
    // Call this function again to keep predicting
    window.requestAnimationFrame(predictWebcam);
}

function updateHandPoints() {
    handPoints = [];
    if (detections && detections.landmarks) {
        for (let hand of detections.landmarks) {
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

    // Optimized Grid: Fill buckets
    gridCount.fill(0);
    for (let i = 0; i < particles.length; i++) {
        let p = particles[i];
        let gx = floor(p.pos.x / cellSize);
        let gy = floor(p.pos.y / cellSize);
        
        if (gx >= 0 && gx < gridCols && gy >= 0 && gy < gridRows) {
            let cellIdx = gx + gy * gridCols;
            let count = gridCount[cellIdx];
            if (count < maxParticlesPerCell) {
                gridBuckets[cellIdx * maxParticlesPerCell + count] = i;
                gridCount[cellIdx]++;
            }
        }
    }

    for (let p of particles) {
        p.maxforce = 0.5 * returnForceValue;

        // Apply constant behaviors (arrive + hover) ONCE
        p.applyBasicBehaviors();

        // Apply mouse interaction
        p.interact(createVector(mouseX, mouseY), mouseRadius);

        // Apply hand interaction
        if (useCamera) {
            for (let hp of handPoints) {
                p.interact(hp, mouseRadius);
            }
        }

        let separation = p.repelGrid(particles, gridBuckets, gridCount, gridCols, gridRows, cellSize, separationSpace, sensitivity, maxParticlesPerCell);
        p.applyForce(separation.mult(0.6));

        p.update();
        p.show();
    }

    // Draw hand skeleton (White)
    drawHandSkeleton();

    // Display FPS Info when UI is active
    if (uiVisible) {
        drawFPSInfo();
        drawStatusInfo();
    }
}

function drawStatusInfo() {
    push();
    textAlign(RIGHT, TOP);
    textSize(12);
    textFont('monospace');
    noStroke();

    // Background plate
    fill(0, 150);
    rect(width - 160, 10, 150, 25, 5);

    // Delegate Text
    fill(255);
    text(`Delegate: `, width - 60, 27);
    
    if (activeDelegate === "GPU") {
        fill(0, 255, 127); // Bright green for GPU
        text("GPU", width - 20, 27);
    } else if (activeDelegate === "ERROR") {
        fill(255, 69, 0); // Red for error
        text("ERR", width - 20, 27);
    } else {
        fill(200);
        text(activeDelegate, width - 20, 27);
    }
    pop();
}

function drawFPSInfo() {
    push();
    textAlign(RIGHT, BOTTOM);
    textSize(14);
    textFont('monospace');
    noStroke();
    
    // Background plate for readability
    fill(0, 150);
    rect(width - 160, height - 50, 150, 40, 5);
    
    // Render text
    fill(255);
    text(`App FPS: ${floor(frameRate())}`, width - 20, height - 30);
    
    if (useCamera) {
        fill(0, 255, 204);
        text(`Track FPS: ${trackingFPS}`, width - 20, height - 15);
    } else {
        fill(150);
        text(`Track FPS: OFF`, width - 20, height - 15);
    }
    pop();
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

function mouseReleased() {
    if (mouseX < 250 && mouseY < 250) {
        updateParticleTargets();
    }
}

function updateParticleTargets() {
    generateTargets();
    if (points.length > particles.length) {
        for (let i = particles.length; i < points.length; i++) {
            let p = new Particle(random(width), random(height));
            p.target = createVector(points[i].x, points[i].y);
            particles.push(p);
        }
    } else if (points.length < particles.length) {
        particles.splice(points.length);
    }

    for (let i = 0; i < points.length; i++) {
        particles[i].target.set(points[i].x, points[i].y);
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    updateParticleTargets();
    initGrid();
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
    let rect = colorSlider2D.elt.getBoundingClientRect();
    let x = constrain(mouseX - rect.left, 0, rect.width);
    let y = constrain(mouseY - rect.top, 0, rect.height);

    colorPicker.style('left', x + 'px');
    colorPicker.style('top', y + 'px');

    colorMode(HSB, 360, 100, 100);
    let h = map(x, 0, rect.width, 0, 360);
    let s, b;

    if (y < rect.height / 2) {
        s = map(y, 0, rect.height / 2, 0, 100);
        b = 100;
    } else {
        s = 100;
        b = map(y, rect.height / 2, rect.height, 100, 0);
    }

    currentColor = color(h, s, b);
    colorMode(RGB, 255);

    localStorage.setItem('particleColorX', (x / rect.width).toFixed(4));
    localStorage.setItem('particleColorY', (y / rect.height).toFixed(4));

    for (let p of particles) {
        p.color = currentColor;
    }
}

function loadSavedColor() {
    let savedX = localStorage.getItem('particleColorX');
    let savedY = localStorage.getItem('particleColorY');

    if (savedX !== null && savedY !== null) {
        let rect = colorSlider2D.elt.getBoundingClientRect();
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

    updateParticleTargets();
    saveParams();
}

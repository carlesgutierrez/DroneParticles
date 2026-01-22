class Particle {
    constructor(x, y) {
        this.pos = createVector(random(width), random(height));
        this.target = createVector(x, y);
        this.vel = p5.Vector.random2D();
        this.acc = createVector();
        this.r = 3;
        this.maxspeed = 6;
        this.maxforce = 0.5;
        this.color = currentColor || color(0, 255, 204, 200);
        this.noiseOffset = createVector(random(1000), random(1000));
    }

    // Basic movement (always applied once per frame)
    applyBasicBehaviors() {
        let arrive = this.arrive(this.target);
        let hover = this.hover();

        arrive.mult(1);
        hover.mult(0.8);

        this.applyForce(arrive);
        this.applyForce(hover);
    }

    // Interaction (can be applied multiple times for mouse and hand points)
    interact(pos, radius) {
        let flee = this.flee(pos, radius);
        flee.mult(5);
        this.applyForce(flee);
    }

    hover() {
        let nX = noise(this.noiseOffset.x, frameCount * 0.01);
        let nY = noise(this.noiseOffset.y, frameCount * 0.01);
        let hoverForce = createVector(map(nX, 0, 1, -1, 1), map(nY, 0, 1, -1, 1));
        hoverForce.mult(0.2); // Subtle floating
        return hoverForce;
    }

    applyForce(f) {
        this.acc.add(f);
    }

    update() {
        this.pos.add(this.vel);
        this.vel.add(this.acc);
        this.acc.mult(0);
        this.vel.mult(0.92); // Slightly more drag for better hovering
    }

    show() {
        noStroke();
        fill(255, 255, 255);
        ellipse(this.pos.x, this.pos.y, this.r);
        fill(this.color);
        ellipse(this.pos.x, this.pos.y, this.r * 2.5);
    }

    arrive(target) {
        let desired = p5.Vector.sub(target, this.pos);
        let d = desired.mag();
        let speed = this.maxspeed;
        if (d < 100) {
            speed = map(d, 0, 100, 0, this.maxspeed);
        }
        desired.setMag(speed);
        let steer = p5.Vector.sub(desired, this.vel);
        steer.limit(this.maxforce);
        return steer;
    }

    flee(target, radius) {
        let desired = p5.Vector.sub(target, this.pos);
        let d = desired.mag();
        if (d < radius) {
            desired.setMag(this.maxspeed);
            desired.mult(-1);
            let steer = p5.Vector.sub(desired, this.vel);
            steer.limit(this.maxforce * 2);
            let weight = map(d, 0, radius, 1, 0);
            steer.mult(weight);
            return steer;
        } else {
            return createVector(0, 0);
        }
    }

    // Optimized repulsion with threshold (sensitivity) and dynamic separation
    repelGrid(grid, cellSize, desiredSeparation, sensitivity) {
        let count = 0;
        let steer = createVector();

        let gx = floor(this.pos.x / cellSize);
        let gy = floor(this.pos.y / cellSize);

        for (let x = gx - 1; x <= gx + 1; x++) {
            for (let y = gy - 1; y <= gy + 1; y++) {
                let key = `${x},${y}`;
                if (grid[key]) {
                    for (let other of grid[key]) {
                        if (other === this) continue;

                        let d = p5.Vector.dist(this.pos, other.pos);

                        // Condition: Only repel if the distance is less than separation
                        // AND only if the neighbor has moved significantly (sensitivity / threshold)
                        // Or if we are too close (urgent repulsion)
                        let neighborMovement = p5.Vector.dist(other.pos, other.target);

                        if (d < desiredSeparation) {
                            // If neighbor moved more than sensitivity, or we are very close
                            if (neighborMovement > sensitivity || d < desiredSeparation * 0.5) {
                                let diff = p5.Vector.sub(this.pos, other.pos);
                                diff.normalize();
                                diff.div(d);
                                steer.add(diff);
                                count++;
                            }
                        }
                    }
                }
            }
        }

        if (count > 0) {
            steer.div(count);
            steer.setMag(this.maxspeed);
            steer.sub(this.vel);
            steer.limit(this.maxforce);
        }
        return steer;
    }
}

const canvasSketch = require('canvas-sketch');
const random = require('canvas-sketch-util/random');
const awaitify = require('apr-awaitify');
const getPixels = awaitify(require('get-pixels'));

/**
 * Input
 */

const options = require('./example_options/olivia-knapp.json');

const settings = {
  dimensions: [ 2048, 2048 ]
};

const seed = random.getRandomSeed();
// eslint-disable-next-line no-console
console.log('seed:', seed);


/**
 * Process
 */

const outOfBounds = circle => {
  const offLeftEdge = circle.x - circle.r < 0;
  const offRightEdge = circle.x + circle.r > settings.dimensions[0];
  const offTopEdge = circle.y - circle.r < 0;
  const offBottomEdge = circle.y + circle.r > settings.dimensions[0];
  return offLeftEdge || offRightEdge || offTopEdge || offBottomEdge;
};

const computeDistance = (circle1, circle2) => {
  const aSq = Math.pow(circle1.x - circle2.x, 2);
  const bSq = Math.pow(circle1.y - circle2.y, 2);
  const c = Math.sqrt(aSq + bSq);
  const distance = c - circle1.r - circle2.r;
  return distance;
}

function* makeCircleIterator(sizeMapPixels) {
  const circles = [];

  // Assume that the image is grayscale, in which case all the color channels
  // should be the same. This will help cut down on CPU usage when sorting by
  // value.
  const redChannel = 0;
  const sizeMapValues = sizeMapPixels.pick(null, null, redChannel);

  // Invert so that blacks get big circles and whites get small ones
  sizeMapValues.data = sizeMapValues.data.map(value => 255 - value);

  const findCollisions = newCircle => {
    return circles.filter(oldCircle => {
      if (oldCircle === newCircle) return false;
      return computeDistance(oldCircle, newCircle) < 0;
    });
  };

  const collisionHandlers = {
    newCircleWins: (newCircle, oldCircles) => {
      oldCircles.forEach(oldCircle => {
        const oldCircleIndex = circles.indexOf(oldCircle);
        circles.splice(oldCircleIndex, 1);
      });
    },
    newCircleLoses: (newCircle, oldCircles) => {
      if (!oldCircles.length) return;
      const newCircleIndex = circles.indexOf(newCircle);
      circles.splice(newCircleIndex, 1);
    },
    shrinkOld: (newCircle, oldCircles) => {
      if (!oldCircles.length) return;
      oldCircles.forEach(oldCircle => {
        const distance = computeDistance(oldCircle, newCircle);
        // Collision may have been resolved with another oldCircle
        if (distance >= 0) return;
        const newR = oldCircle.r + distance;
        if (newR >= options.smallestCircleRadius) {
          oldCircle.r = newR;
        }
        else {
          const oldCircleIndex = circles.indexOf(oldCircle);
          circles.splice(oldCircleIndex, 1);
        }
      });
    },
    shrinkAll: (newCircle, oldCircles) => {
      if (!oldCircles.length) return;
      const collisionDistances = oldCircles.map(oldCircle => {
        return computeDistance(oldCircle, newCircle);
      });
      const r = Math.min(...collisionDistances) / -2;
      if (r < options.smallestCircleRadius) {
        const newCircleIndex = circles.indexOf(newCircle);
        circles.splice(newCircleIndex, 1);
        return;
      }
      newCircle.r = r;
      oldCircles.forEach(oldCircle => {
        const distance = computeDistance(oldCircle, newCircle);
        // Collision may have already been resolved
        if (distance >= 0) return;
        const r = oldCircle.r + Math.floor(distance);
        if (r >= options.smallestCircleRadius) {
          oldCircle.r = r;
        }
        else {
          const oldCircleIndex = circles.indexOf(oldCircle);
          circles.splice(oldCircleIndex, 1);
        }
      });
    },
    noop: () => {}
  };

  const handleCollision = collisionHandlers[options.collisionHandlerName];

  for (let iteration = 1; iteration <= options.iterationCount; iteration += 1) {
    const candidatePixels = Array.from({ length: options.weightedRandomSampleSize }, () => {
      const x = Math.round(random.range(0, settings.dimensions[0] - 1));
      const y = Math.round(random.range(0, settings.dimensions[1] - 1));
      return { x, y, value: sizeMapValues.get(x, y) };
    });
    const largestValue = Math.max(...candidatePixels.map(({ value }) => value));
    const { x, y } = candidatePixels.find(({ value }) => value === largestValue);
    const r = (largestValue / 255) * options.largestCircleRadius;
    const circle = { x, y, r };
    if (r >= options.smallestCircleRadius && !outOfBounds(circle)) {
      circles.push(circle);
      handleCollision(circle, findCollisions(circle));
    }
    yield circles;
  }

  return options.sampleCount;
}

/**
 * Output
 */

(async () => {
  const sizeMapPixels = await getPixels(options.mapPath);

  const sketch = () => {
    return ({ context }) => {
      const circleIterations = makeCircleIterator(sizeMapPixels);
      let lastCircles = [];
      const intervalId = window.setInterval(() => {
        const iteration = circleIterations.next();
        if (iteration.done) {
          window.clearInterval(intervalId);
          // eslint-disable-next-line no-console
          console.log('Done.');
          // eslint-disable-next-line no-console
          console.log(lastCircles);
          return;
        }
        const circles = lastCircles = iteration.value;
        context.clearRect(0, 0, settings.dimensions[0], settings.dimensions[1]);
        context.fillStyle = options.fillStyle;
        circles.forEach(({ x, y, r }) => {
          context.beginPath();
          context.arc(x, y, r, 0, 2 * Math.PI);
          context.fill();
        });
      }, options.frameInterval);
    };
  };
  
  canvasSketch(sketch, settings);
})();
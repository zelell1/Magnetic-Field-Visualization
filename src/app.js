import {
  axisFiniteSolenoidField,
  farDipoleAxisField,
  longSolenoidField,
  makeSolenoidModel,
} from "./physics.js";

const state = {
  diameter: 0.2,
  length: 0.8,
  turns: 120,
  current: 2,
  extent: 1.4,
  resolution: 120,
  maxSamples: 90,
  view: "mag",
};

const fieldCanvas = document.querySelector("#fieldCanvas");
const fieldContext = fieldCanvas.getContext("2d", { alpha: false });
const axisCanvas = document.querySelector("#axisCanvas");
const axisContext = axisCanvas.getContext("2d");
const legendCanvas = document.querySelector("#legendCanvas");
const legendContext = legendCanvas.getContext("2d");
const cursorReadout = document.querySelector("#cursorReadout");

const outputs = {
  sampleStatus: document.querySelector("#sampleStatus"),
  centerField: document.querySelector("#centerField"),
  finiteAxisField: document.querySelector("#finiteAxisField"),
  longField: document.querySelector("#longField"),
  axisError: document.querySelector("#axisError"),
  legendMin: document.querySelector("#legendMin"),
  legendMax: document.querySelector("#legendMax"),
};

let latestModel = null;
let latestBounds = null;
let renderQueued = false;

const sequentialStops = [
  [0.0, [20, 31, 38]],
  [0.18, [34, 72, 88]],
  [0.38, [30, 126, 125]],
  [0.58, [71, 157, 91]],
  [0.78, [230, 184, 78]],
  [1.0, [205, 92, 53]],
];

const divergingStops = [
  [0.0, [42, 85, 155]],
  [0.48, [239, 237, 226]],
  [0.52, [239, 237, 226]],
  [1.0, [190, 66, 52]],
];

bindNumberPair("diameter", "diameterRange", "diameter", false);
bindNumberPair("length", "lengthRange", "length", false);
bindNumberPair("turns", "turnsRange", "turns", true);
bindNumberPair("current", "currentRange", "current", false);
bindNumberPair("extent", "extentRange", "extent", false);
bindNumberPair("resolution", "resolutionRange", "resolution", true);
bindNumberPair("samples", "samplesRange", "maxSamples", true);

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    document
      .querySelectorAll("[data-view]")
      .forEach((item) => item.classList.toggle("active", item === button));
    scheduleRender();
  });
});

new ResizeObserver(scheduleRender).observe(document.querySelector(".canvas-panel"));
new ResizeObserver(scheduleRender).observe(document.querySelector(".axis-panel"));

fieldCanvas.addEventListener("mousemove", (event) => {
  if (!latestModel || !latestBounds) {
    return;
  }
  const rect = fieldCanvas.getBoundingClientRect();
  const xCanvas = event.clientX - rect.left;
  const yCanvas = event.clientY - rect.top;
  const point = canvasToWorld(xCanvas, yCanvas, rect.width, rect.height, latestBounds);
  const field = latestModel.fieldAt(point.x, point.y);
  cursorReadout.textContent = `x = ${formatMeters(point.x)}, y = ${formatMeters(
    point.y,
  )}, Bx = ${formatField(field.bx)}, By = ${formatField(
    field.by,
  )}, |B| = ${formatField(field.magnitude)}`;
});

fieldCanvas.addEventListener("mouseleave", () => {
  cursorReadout.textContent = "x = 0, y = 0";
});

scheduleRender();

function bindNumberPair(numberId, rangeId, stateKey, integer) {
  const numberInput = document.querySelector(`#${numberId}`);
  const rangeInput = document.querySelector(`#${rangeId}`);
  const applyValue = (rawValue, source) => {
    const value = clampToInput(rawValue, source);
    const cleanValue = integer ? Math.round(value) : value;
    state[stateKey] = cleanValue;
    numberInput.value = String(cleanValue);
    rangeInput.value = String(cleanValue);
    scheduleRender();
  };

  numberInput.addEventListener("input", () => applyValue(numberInput.value, numberInput));
  rangeInput.addEventListener("input", () => applyValue(rangeInput.value, rangeInput));
}

function clampToInput(rawValue, input) {
  const value = Number(rawValue);
  const min = Number(input.min);
  const max = Number(input.max);
  if (!Number.isFinite(value)) {
    return Number(input.value);
  }
  return Math.min(max, Math.max(min, value));
}

function scheduleRender() {
  if (renderQueued) {
    return;
  }
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const canvasRect = fieldCanvas.getBoundingClientRect();
  const axisRect = axisCanvas.getBoundingClientRect();
  if (canvasRect.width === 0 || canvasRect.height === 0) {
    return;
  }

  resizeCanvas(fieldCanvas, fieldContext, canvasRect);
  resizeCanvas(axisCanvas, axisContext, axisRect);
  latestModel = makeSolenoidModel({
    diameter: state.diameter,
    length: state.length,
    turns: state.turns,
    current: state.current,
    maxSamples: state.maxSamples,
    wireRadius: state.diameter * 0.002,
  });
  latestBounds = getWorldBounds(canvasRect.width, canvasRect.height);

  const grid = computeFieldGrid(latestModel, latestBounds, canvasRect.width, canvasRect.height);
  drawFieldMap(grid, latestBounds);
  drawSolenoid(latestModel, latestBounds);
  drawVectorField(latestModel, latestBounds);
  drawLegend(grid.scale);
  drawAxisPlot(latestModel);
  updateMetrics(latestModel);
}

function resizeCanvas(canvas, context, rect) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function getWorldBounds(width, height) {
  const diameter = state.diameter;
  let xHalf = state.length / 2 + state.extent * diameter;
  let yHalf = state.extent * diameter;
  xHalf = Math.max(xHalf, diameter * 1.2);
  yHalf = Math.max(yHalf, diameter * 0.85);

  const canvasAspect = width / height;
  const worldAspect = xHalf / yHalf;
  if (worldAspect < canvasAspect) {
    xHalf = yHalf * canvasAspect;
  } else {
    yHalf = xHalf / canvasAspect;
  }

  return {
    xMin: -xHalf,
    xMax: xHalf,
    yMin: -yHalf,
    yMax: yHalf,
  };
}

function computeFieldGrid(model, bounds, width, height) {
  const columns = state.resolution;
  const rows = Math.max(56, Math.round(columns * (height / width)));
  const values = new Float64Array(columns * rows);
  const bx = new Float64Array(columns * rows);
  const by = new Float64Array(columns * rows);
  const magnitudes = new Float64Array(columns * rows);

  for (let row = 0; row < rows; row += 1) {
    const y = bounds.yMax - ((row + 0.5) / rows) * (bounds.yMax - bounds.yMin);
    for (let column = 0; column < columns; column += 1) {
      const x = bounds.xMin + ((column + 0.5) / columns) * (bounds.xMax - bounds.xMin);
      const field = model.fieldAt(x, y);
      const index = row * columns + column;
      bx[index] = field.bx;
      by[index] = field.by;
      magnitudes[index] = field.magnitude;
      values[index] = selectViewValue(field);
    }
  }

  return {
    columns,
    rows,
    values,
    bx,
    by,
    magnitudes,
    scale: makeScale(values, magnitudes),
  };
}

function selectViewValue(field) {
  if (state.view === "bx") {
    return field.bx;
  }
  if (state.view === "by") {
    return field.by;
  }
  return field.magnitude;
}

function makeScale(values, magnitudes) {
  if (state.view === "mag") {
    const logs = Array.from(magnitudes, (value) => Math.log10(Math.max(value, 1e-15)));
    logs.sort((a, b) => a - b);
    return {
      type: "sequential",
      min: percentileSorted(logs, 0.04),
      max: percentileSorted(logs, 0.985),
    };
  }

  const absoluteValues = Array.from(values, Math.abs).sort((a, b) => a - b);
  const maxAbs = Math.max(percentileSorted(absoluteValues, 0.985), 1e-15);
  return {
    type: "diverging",
    min: -maxAbs,
    max: maxAbs,
  };
}

function percentileSorted(sortedValues, fraction) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round(fraction * (sortedValues.length - 1))),
  );
  return sortedValues[index];
}

function drawFieldMap(grid, bounds) {
  const rect = fieldCanvas.getBoundingClientRect();
  const image = fieldContext.createImageData(grid.columns, grid.rows);

  for (let index = 0; index < grid.values.length; index += 1) {
    const color =
      state.view === "mag"
        ? colorForSequentialValue(grid.magnitudes[index], grid.scale)
        : colorForDivergingValue(grid.values[index], grid.scale);
    const offset = index * 4;
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = 255;
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = grid.columns;
  offscreen.height = grid.rows;
  offscreen.getContext("2d").putImageData(image, 0, 0);

  fieldContext.clearRect(0, 0, rect.width, rect.height);
  fieldContext.imageSmoothingEnabled = true;
  fieldContext.drawImage(offscreen, 0, 0, rect.width, rect.height);

  fieldContext.save();
  fieldContext.strokeStyle = "rgba(255, 253, 248, 0.58)";
  fieldContext.lineWidth = 1;
  drawGridLines(bounds, rect.width, rect.height);
  fieldContext.restore();
}

function drawGridLines(bounds, width, height) {
  const xStep = niceStep((bounds.xMax - bounds.xMin) / 7);
  const yStep = niceStep((bounds.yMax - bounds.yMin) / 5);

  for (let x = Math.ceil(bounds.xMin / xStep) * xStep; x <= bounds.xMax; x += xStep) {
    const point = worldToCanvas(x, 0, width, height, bounds);
    fieldContext.beginPath();
    fieldContext.moveTo(point.x, 0);
    fieldContext.lineTo(point.x, height);
    fieldContext.stroke();
  }

  for (let y = Math.ceil(bounds.yMin / yStep) * yStep; y <= bounds.yMax; y += yStep) {
    const point = worldToCanvas(0, y, width, height, bounds);
    fieldContext.beginPath();
    fieldContext.moveTo(0, point.y);
    fieldContext.lineTo(width, point.y);
    fieldContext.stroke();
  }
}

function niceStep(rawStep) {
  const exponent = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / exponent;
  if (fraction < 1.5) {
    return exponent;
  }
  if (fraction < 3.5) {
    return 2 * exponent;
  }
  if (fraction < 7.5) {
    return 5 * exponent;
  }
  return 10 * exponent;
}

function drawSolenoid(model, bounds) {
  const rect = fieldCanvas.getBoundingClientRect();
  const topLeft = worldToCanvas(-model.length / 2, model.radius, rect.width, rect.height, bounds);
  const bottomRight = worldToCanvas(model.length / 2, -model.radius, rect.width, rect.height, bounds);
  const axisStart = worldToCanvas(bounds.xMin, 0, rect.width, rect.height, bounds);
  const axisEnd = worldToCanvas(bounds.xMax, 0, rect.width, rect.height, bounds);

  fieldContext.save();
  fieldContext.lineCap = "round";
  fieldContext.strokeStyle = "rgba(31, 36, 40, 0.72)";
  fieldContext.lineWidth = 1.5;
  fieldContext.setLineDash([6, 7]);
  fieldContext.beginPath();
  fieldContext.moveTo(axisStart.x, axisStart.y);
  fieldContext.lineTo(axisEnd.x, axisEnd.y);
  fieldContext.stroke();

  fieldContext.setLineDash([]);
  fieldContext.lineWidth = 2.2;
  fieldContext.strokeStyle = "rgba(31, 36, 40, 0.88)";
  fieldContext.strokeRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );

  const drawCount = Math.min(96, Math.max(1, Math.round(model.turns)));
  const displaySamples = displayLoopPositions(model.length, drawCount);
  const wireRadiusPx = Math.min(
    5,
    Math.max(2.5, Math.abs(bottomRight.y - topLeft.y) / 38),
  );

  for (const x of displaySamples) {
    const top = worldToCanvas(x, model.radius, rect.width, rect.height, bounds);
    const bottom = worldToCanvas(x, -model.radius, rect.width, rect.height, bounds);
    drawWireDot(top.x, top.y, wireRadiusPx, model.current >= 0);
    drawWireDot(bottom.x, bottom.y, wireRadiusPx, model.current < 0);
  }

  fieldContext.restore();
}

function displayLoopPositions(length, count) {
  if (count === 1) {
    return [0];
  }
  return Array.from({ length: count }, (_, index) => -length / 2 + (index * length) / (count - 1));
}

function drawWireDot(x, y, radius, dotInside) {
  fieldContext.beginPath();
  fieldContext.fillStyle = "#fffdf8";
  fieldContext.strokeStyle = "rgba(31, 36, 40, 0.85)";
  fieldContext.lineWidth = 1.4;
  fieldContext.arc(x, y, radius, 0, Math.PI * 2);
  fieldContext.fill();
  fieldContext.stroke();

  if (dotInside) {
    fieldContext.beginPath();
    fieldContext.fillStyle = "#1f2428";
    fieldContext.arc(x, y, radius * 0.32, 0, Math.PI * 2);
    fieldContext.fill();
  } else {
    fieldContext.strokeStyle = "#1f2428";
    fieldContext.lineWidth = 1.2;
    fieldContext.beginPath();
    fieldContext.moveTo(x - radius * 0.42, y - radius * 0.42);
    fieldContext.lineTo(x + radius * 0.42, y + radius * 0.42);
    fieldContext.moveTo(x + radius * 0.42, y - radius * 0.42);
    fieldContext.lineTo(x - radius * 0.42, y + radius * 0.42);
    fieldContext.stroke();
  }
}

function drawVectorField(model, bounds) {
  const rect = fieldCanvas.getBoundingClientRect();
  const columns = 23;
  const rows = Math.max(11, Math.round(columns * rect.height / rect.width));
  const arrowLimit = Math.min(rect.width / columns, rect.height / rows) * 0.42;

  fieldContext.save();
  fieldContext.strokeStyle = "rgba(255, 253, 248, 0.76)";
  fieldContext.fillStyle = "rgba(255, 253, 248, 0.80)";
  fieldContext.lineWidth = 1.3;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const xCanvas = ((column + 0.5) / columns) * rect.width;
      const yCanvas = ((row + 0.5) / rows) * rect.height;
      const point = canvasToWorld(xCanvas, yCanvas, rect.width, rect.height, bounds);
      const field = model.fieldAt(point.x, point.y);
      const magnitude = Math.hypot(field.bx, field.by);
      if (magnitude <= 1e-14) {
        continue;
      }

      const directionX = field.bx / magnitude;
      const directionY = -field.by / magnitude;
      const length = arrowLimit * (0.35 + 0.65 * Math.tanh(magnitude / averageFieldScale(model)));
      drawArrow(xCanvas, yCanvas, directionX, directionY, length);
    }
  }

  fieldContext.restore();
}

function averageFieldScale(model) {
  return Math.max(Math.abs(axisFiniteSolenoidField(0, model)), 1e-10);
}

function drawArrow(x, y, directionX, directionY, length) {
  const half = length / 2;
  const startX = x - directionX * half;
  const startY = y - directionY * half;
  const endX = x + directionX * half;
  const endY = y + directionY * half;
  const head = Math.max(4, length * 0.22);
  const angle = Math.atan2(directionY, directionX);

  fieldContext.beginPath();
  fieldContext.moveTo(startX, startY);
  fieldContext.lineTo(endX, endY);
  fieldContext.stroke();

  fieldContext.beginPath();
  fieldContext.moveTo(endX, endY);
  fieldContext.lineTo(
    endX - head * Math.cos(angle - Math.PI / 6),
    endY - head * Math.sin(angle - Math.PI / 6),
  );
  fieldContext.lineTo(
    endX - head * Math.cos(angle + Math.PI / 6),
    endY - head * Math.sin(angle + Math.PI / 6),
  );
  fieldContext.closePath();
  fieldContext.fill();
}

function drawAxisPlot(model) {
  const rect = axisCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const padding = { left: 54, right: 16, top: 16, bottom: 30 };
  const bounds = getWorldBounds(width, Math.max(height, 1));
  const samples = 260;
  const numeric = [];
  const analytic = [];

  for (let index = 0; index < samples; index += 1) {
    const x = bounds.xMin + (index / (samples - 1)) * (bounds.xMax - bounds.xMin);
    numeric.push([x, model.fieldAt(x, 0).bx]);
    analytic.push([x, model.axisFieldAt(x)]);
  }

  const values = numeric.concat(analytic).map((point) => point[1]);
  const maxAbs = Math.max(...values.map(Math.abs), 1e-15);
  const yMin = -maxAbs * 1.08;
  const yMax = maxAbs * 1.08;

  axisContext.clearRect(0, 0, width, height);
  axisContext.fillStyle = "#fffdf8";
  axisContext.fillRect(0, 0, width, height);
  axisContext.strokeStyle = "#d8d2c5";
  axisContext.lineWidth = 1;

  drawPlotGrid(axisContext, width, height, padding);

  axisContext.strokeStyle = "#9a9489";
  axisContext.beginPath();
  const zero = plotPoint(0, 0, bounds, yMin, yMax, width, height, padding);
  axisContext.moveTo(padding.left, zero.y);
  axisContext.lineTo(width - padding.right, zero.y);
  axisContext.stroke();

  drawPlotLine(axisContext, numeric, bounds, yMin, yMax, width, height, padding, "#157a6e", []);
  drawPlotLine(axisContext, analytic, bounds, yMin, yMax, width, height, padding, "#c95f35", [7, 6]);

  axisContext.fillStyle = "#6f766f";
  axisContext.font = "12px Inter, system-ui, sans-serif";
  axisContext.textAlign = "left";
  axisContext.fillText(formatField(yMax), 10, padding.top + 4);
  axisContext.fillText(formatField(yMin), 10, height - padding.bottom + 4);
  axisContext.textAlign = "center";
  axisContext.fillText("x, м", width / 2, height - 8);
}

function drawPlotGrid(context, width, height, padding) {
  context.save();
  context.strokeStyle = "#ece6db";
  context.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const y = padding.top + (i / 5) * (height - padding.top - padding.bottom);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }
  for (let i = 0; i <= 6; i += 1) {
    const x = padding.left + (i / 6) * (width - padding.left - padding.right);
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, height - padding.bottom);
    context.stroke();
  }
  context.restore();
}

function drawPlotLine(context, points, bounds, yMin, yMax, width, height, padding, color, dash) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 2.2;
  context.setLineDash(dash);
  context.beginPath();
  points.forEach(([x, y], index) => {
    const point = plotPoint(x, y, bounds, yMin, yMax, width, height, padding);
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.stroke();
  context.restore();
}

function plotPoint(x, y, bounds, yMin, yMax, width, height, padding) {
  return {
    x:
      padding.left +
      ((x - bounds.xMin) / (bounds.xMax - bounds.xMin)) *
        (width - padding.left - padding.right),
    y:
      padding.top +
      (1 - (y - yMin) / (yMax - yMin)) *
        (height - padding.top - padding.bottom),
  };
}

function drawLegend(scale) {
  const width = legendCanvas.width;
  const height = legendCanvas.height;
  const image = legendContext.createImageData(width, height);
  for (let x = 0; x < width; x += 1) {
    const t = x / (width - 1);
    const color =
      scale.type === "sequential"
        ? interpolateStops(sequentialStops, t)
        : interpolateStops(divergingStops, t);
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }
  legendContext.putImageData(image, 0, 0);

  if (scale.type === "sequential") {
    outputs.legendMin.textContent = formatField(10 ** scale.min);
    outputs.legendMax.textContent = formatField(10 ** scale.max);
  } else {
    outputs.legendMin.textContent = formatField(scale.min);
    outputs.legendMax.textContent = formatField(scale.max);
  }
}

function colorForSequentialValue(value, scale) {
  const logValue = Math.log10(Math.max(value, 1e-15));
  const t = normalize(logValue, scale.min, scale.max);
  return interpolateStops(sequentialStops, t);
}

function colorForDivergingValue(value, scale) {
  const t = normalize(value, scale.min, scale.max);
  return interpolateStops(divergingStops, t);
}

function normalize(value, min, max) {
  if (max <= min) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function interpolateStops(stops, t) {
  for (let index = 1; index < stops.length; index += 1) {
    const [stopT, color] = stops[index];
    const [previousT, previousColor] = stops[index - 1];
    if (t <= stopT) {
      const localT = (t - previousT) / (stopT - previousT || 1);
      return previousColor.map((channel, channelIndex) =>
        Math.round(channel + (color[channelIndex] - channel) * localT),
      );
    }
  }
  return stops.at(-1)[1];
}

function updateMetrics(model) {
  const center = model.fieldAt(0, 0).bx;
  const finite = axisFiniteSolenoidField(0, model);
  const long = longSolenoidField(model);
  const relative = finite === 0 ? 0 : ((center - finite) / finite) * 100;
  const dipole = farDipoleAxisField(Math.max(5 * model.length, 20 * model.radius), model);

  outputs.centerField.textContent = formatField(center);
  outputs.finiteAxisField.textContent = formatField(finite);
  outputs.longField.textContent = formatField(long);
  outputs.axisError.textContent = `${relative.toFixed(2)}%`;
  outputs.sampleStatus.textContent = `${model.samples.length} расчетных витков, диполь ${formatField(
    dipole,
  )}`;
}

function worldToCanvas(x, y, width, height, bounds) {
  return {
    x: ((x - bounds.xMin) / (bounds.xMax - bounds.xMin)) * width,
    y: (1 - (y - bounds.yMin) / (bounds.yMax - bounds.yMin)) * height,
  };
}

function canvasToWorld(x, y, width, height, bounds) {
  return {
    x: bounds.xMin + (x / width) * (bounds.xMax - bounds.xMin),
    y: bounds.yMin + (1 - y / height) * (bounds.yMax - bounds.yMin),
  };
}

function formatMeters(value) {
  if (Math.abs(value) >= 1) {
    return `${value.toFixed(2)} м`;
  }
  return `${(value * 100).toFixed(1)} см`;
}

function formatField(value) {
  const abs = Math.abs(value);
  if (abs >= 1e-3) {
    return `${(value * 1e3).toFixed(3)} мТл`;
  }
  if (abs >= 1e-6) {
    return `${(value * 1e6).toFixed(2)} мкТл`;
  }
  if (abs >= 1e-9) {
    return `${(value * 1e9).toFixed(2)} нТл`;
  }
  return `${value.toExponential(2)} Тл`;
}

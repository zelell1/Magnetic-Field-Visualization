export const MU0 = 4 * Math.PI * 1e-7;

const ELLIPTIC_QUADRATURE = buildEllipticQuadrature(28);
const ELLIPTIC_SCRATCH = { K: 0, E: 0 };

function buildEllipticQuadrature(order) {
  const nodes = new Array(order);
  const weights = new Array(order);
  const half = Math.floor((order + 1) / 2);
  const tolerance = 1e-15;

  for (let i = 0; i < half; i += 1) {
    let z = Math.cos(Math.PI * (i + 0.75) / (order + 0.5));
    let previous;
    let derivative = 0;

    do {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= order; j += 1) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      derivative = (order * (z * p1 - p2)) / (z * z - 1);
      previous = z;
      z = previous - p1 / derivative;
    } while (Math.abs(z - previous) > tolerance);

    const weight = 2 / ((1 - z * z) * derivative * derivative);
    nodes[i] = -z;
    nodes[order - 1 - i] = z;
    weights[i] = weight;
    weights[order - 1 - i] = weight;
  }

  return nodes.map((node, index) => {
    const theta = (Math.PI / 4) * (node + 1);
    return {
      sin2: Math.sin(theta) ** 2,
      weight: (Math.PI / 4) * weights[index],
    };
  });
}

function fillCompleteEllipticIntegrals(parameterM, out = ELLIPTIC_SCRATCH) {
  const m = Math.min(Math.max(parameterM, 0), 1 - 1e-12);
  let K = 0;
  let E = 0;

  for (const point of ELLIPTIC_QUADRATURE) {
    const root = Math.sqrt(Math.max(1 - m * point.sin2, 1e-15));
    K += point.weight / root;
    E += point.weight * root;
  }

  out.K = K;
  out.E = E;
  return out;
}

export function completeEllipticIntegrals(parameterM) {
  return fillCompleteEllipticIntegrals(parameterM, { K: 0, E: 0 });
}

export function loopFieldAt(x, y, options) {
  const radius = positive(options.radius, "radius");
  const current = finite(options.current, "current");
  const centerX = finite(options.centerX ?? 0, "centerX");
  const turns = finite(options.turns ?? 1, "turns");
  const wireRadius = Math.max(0, Number(options.wireRadius ?? 0));
  const result = addLoopField({ bx: 0, by: 0 }, x, y, {
    radius,
    current,
    centerX,
    turns,
    wireRadius,
  });

  return {
    bx: result.bx,
    by: result.by,
    magnitude: Math.hypot(result.bx, result.by),
  };
}

function addLoopField(out, x, y, loop) {
  const axial = x - loop.centerX;
  const rho = Math.abs(y);
  const effectiveCurrent = loop.current * loop.turns;
  const radius2 = loop.radius * loop.radius;

  if (rho < 1e-10) {
    const denominator = (radius2 + axial * axial) ** 1.5;
    out.bx += (MU0 * effectiveCurrent * radius2) / (2 * denominator);
    return out;
  }

  const sumRadius = loop.radius + rho;
  const diffRadius = loop.radius - rho;
  const alpha2 = sumRadius * sumRadius + axial * axial;
  const alpha = Math.sqrt(alpha2);
  const minBeta2 = loop.wireRadius > 0 ? loop.wireRadius * loop.wireRadius : 1e-24;
  const beta2 = Math.max(diffRadius * diffRadius + axial * axial, minBeta2);
  const m = Math.min((4 * loop.radius * rho) / alpha2, 1 - 1e-12);
  const { K, E } = fillCompleteEllipticIntegrals(m);
  const common = (MU0 * effectiveCurrent) / (2 * Math.PI * alpha);

  const bx =
    common *
    (K + ((radius2 - rho * rho - axial * axial) / beta2) * E);
  const br =
    common *
    (axial / rho) *
    (-K + ((radius2 + rho * rho + axial * axial) / beta2) * E);

  out.bx += bx;
  out.by += y >= 0 ? br : -br;
  return out;
}

export function createLoopSamples(length, turns, maxSamples = turns) {
  const cleanLength = positive(length, "length");
  const cleanTurns = positive(turns, "turns");
  const cleanMaxSamples = Math.max(1, Math.floor(positive(maxSamples, "maxSamples")));
  const roundedTurns = Math.max(1, Math.round(cleanTurns));

  if (roundedTurns <= cleanMaxSamples) {
    if (roundedTurns === 1) {
      return [{ centerX: 0, turns: cleanTurns }];
    }

    return Array.from({ length: roundedTurns }, (_, index) => ({
      centerX: -cleanLength / 2 + (index * cleanLength) / (roundedTurns - 1),
      turns: cleanTurns / roundedTurns,
    }));
  }

  return Array.from({ length: cleanMaxSamples }, (_, index) => ({
    centerX: -cleanLength / 2 + ((index + 0.5) * cleanLength) / cleanMaxSamples,
    turns: cleanTurns / cleanMaxSamples,
  }));
}

export function makeSolenoidModel(options) {
  const diameter = positive(options.diameter, "diameter");
  const length = positive(options.length, "length");
  const turns = positive(options.turns, "turns");
  const current = finite(options.current, "current");
  const maxSamples = options.maxSamples ?? turns;
  const radius = diameter / 2;
  const wireRadius = Math.max(0, Number(options.wireRadius ?? 0));
  const samples = createLoopSamples(length, turns, maxSamples);
  const loops = samples.map((sample) => ({
    radius,
    current,
    centerX: sample.centerX,
    turns: sample.turns,
    wireRadius,
  }));

  return {
    diameter,
    radius,
    length,
    turns,
    current,
    maxSamples,
    samples,
    loops,
    fieldAt(x, y) {
      const out = { bx: 0, by: 0 };
      for (const loop of loops) {
        addLoopField(out, x, y, loop);
      }
      return {
        bx: out.bx,
        by: out.by,
        magnitude: Math.hypot(out.bx, out.by),
      };
    },
    axisFieldAt(x) {
      return axisFiniteSolenoidField(x, { diameter, length, turns, current });
    },
  };
}

export function solenoidFieldAt(x, y, options) {
  return makeSolenoidModel(options).fieldAt(x, y);
}

export function singleLoopAxisField(x, options) {
  const radius = positive(options.radius, "radius");
  const current = finite(options.current, "current");
  const turns = finite(options.turns ?? 1, "turns");
  const centerX = finite(options.centerX ?? 0, "centerX");
  const axial = x - centerX;

  return (
    (MU0 * current * turns * radius * radius) /
    (2 * (radius * radius + axial * axial) ** 1.5)
  );
}

export function axisFiniteSolenoidField(x, options) {
  const diameter = positive(options.diameter, "diameter");
  const length = positive(options.length, "length");
  const turns = positive(options.turns, "turns");
  const current = finite(options.current, "current");
  const radius = diameter / 2;
  const left = x + length / 2;
  const right = x - length / 2;
  const density = turns / length;

  return (
    (MU0 * density * current * 0.5) *
    (left / Math.sqrt(radius * radius + left * left) -
      right / Math.sqrt(radius * radius + right * right))
  );
}

export function longSolenoidField(options) {
  const length = positive(options.length, "length");
  const turns = positive(options.turns, "turns");
  const current = finite(options.current, "current");
  return (MU0 * turns * current) / length;
}

export function farDipoleAxisField(x, options) {
  const diameter = positive(options.diameter, "diameter");
  const turns = positive(options.turns, "turns");
  const current = finite(options.current, "current");
  const radius = diameter / 2;
  return (MU0 * turns * current * radius * radius) / (2 * Math.abs(x) ** 3);
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`${label} must be finite`);
  }
  return number;
}

function positive(value, label) {
  const number = finite(value, label);
  if (number <= 0) {
    throw new RangeError(`${label} must be positive`);
  }
  return number;
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  MU0,
  axisFiniteSolenoidField,
  completeEllipticIntegrals,
  farDipoleAxisField,
  longSolenoidField,
  loopFieldAt,
  makeSolenoidModel,
  singleLoopAxisField,
} from "../src/physics.js";

const relativeError = (actual, expected) =>
  Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-30);

test("complete elliptic integrals have the correct m = 0 limit", () => {
  const { K, E } = completeEllipticIntegrals(0);
  assert.ok(Math.abs(K - Math.PI / 2) < 1e-13);
  assert.ok(Math.abs(E - Math.PI / 2) < 1e-13);
});

test("complete elliptic integrals match reference values inside 0 < m < 1", () => {
  const half = completeEllipticIntegrals(0.5);
  assert.ok(relativeError(half.K, 1.8540746773013719) < 1e-12);
  assert.ok(relativeError(half.E, 1.350643881047675) < 1e-12);

  const nearWire = completeEllipticIntegrals(0.9);
  assert.ok(relativeError(nearWire.K, 2.5780921133481733) < 1e-12);
  assert.ok(relativeError(nearWire.E, 1.1047747327040733) < 1e-12);
});

test("single circular loop matches the analytic on-axis expression", () => {
  const radius = 0.13;
  const current = 2.4;
  for (const x of [-0.4, -0.05, 0, 0.27, 0.8]) {
    const numeric = loopFieldAt(x, 0, { radius, current }).bx;
    const analytic = singleLoopAxisField(x, { radius, current });
    assert.ok(relativeError(numeric, analytic) < 1e-13);
  }
});

test("field symmetry in the axial plane is preserved", () => {
  const model = makeSolenoidModel({
    diameter: 0.22,
    length: 0.75,
    turns: 80,
    current: 1.7,
    maxSamples: 80,
  });
  const upper = model.fieldAt(0.11, 0.08);
  const lower = model.fieldAt(0.11, -0.08);

  assert.ok(relativeError(upper.bx, lower.bx) < 1e-12);
  assert.ok(relativeError(upper.by, -lower.by) < 1e-12);
});

test("long finite solenoid tends to B = mu0 N I / L at the center", () => {
  const options = { diameter: 0.08, length: 2.0, turns: 1000, current: 1.5 };
  const finite = axisFiniteSolenoidField(0, options);
  const long = longSolenoidField(options);
  assert.ok(relativeError(finite, long) < 0.001);
  assert.equal(Math.sign(finite), Math.sign(options.current));
});

test("sampled superposition agrees with the continuous on-axis finite-solenoid formula", () => {
  const options = {
    diameter: 0.2,
    length: 1.1,
    turns: 600,
    current: 2.0,
    maxSamples: 220,
  };
  const model = makeSolenoidModel(options);

  for (const x of [-0.45, -0.1, 0, 0.25, 0.5]) {
    const numeric = model.fieldAt(x, 0).bx;
    const analytic = axisFiniteSolenoidField(x, options);
    assert.ok(relativeError(numeric, analytic) < 0.006);
  }
});

test("grouped loop samples converge below one percent for the default demo case", () => {
  const options = {
    diameter: 0.2,
    length: 0.8,
    turns: 120,
    current: 2.0,
  };
  const analyticCenter = axisFiniteSolenoidField(0, options);

  const coarse = makeSolenoidModel({ ...options, maxSamples: 8 }).fieldAt(0, 0).bx;
  assert.ok(relativeError(coarse, analyticCenter) > 0.01);

  for (const maxSamples of [12, 20, 60, 90]) {
    const model = makeSolenoidModel({ ...options, maxSamples });
    const numericCenter = model.fieldAt(0, 0).bx;
    assert.ok(relativeError(numericCenter, analyticCenter) < 0.01);
  }
});

test("far axial field approaches the magnetic dipole asymptotic", () => {
  const options = {
    diameter: 0.3,
    length: 0.55,
    turns: 240,
    current: 1.0,
    maxSamples: 240,
  };
  const model = makeSolenoidModel(options);
  const x = 12;
  const numeric = model.fieldAt(x, 0).bx;
  const asymptotic = farDipoleAxisField(x, options);

  assert.ok(relativeError(numeric, asymptotic) < 0.015);
});

test("center field keeps the expected current sign", () => {
  const model = makeSolenoidModel({
    diameter: 0.15,
    length: 0.6,
    turns: 90,
    current: -3,
    maxSamples: 90,
  });

  assert.ok(model.fieldAt(0, 0).bx < 0);
  assert.ok(Math.abs(model.fieldAt(0, 0).bx) > MU0);
});

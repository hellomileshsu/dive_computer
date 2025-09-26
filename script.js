const SURFACE_PRESSURE = 1;
const WATER_DENSITY_DIVISOR = 10; // 10 m of salt water ~ 1 bar
const BASE_TICK_MS = 1000;
const DIVE_START_THRESHOLD = 5; // m
const SAFETY_STOP_DEPTH = 5;
const SAFETY_STOP_DURATION = 180; // seconds
const DECO_STOP_STEP = 3; // meters between deco stops
const WATER_VAPOR_PRESSURE = 0; // simplified model
const SPEED_LAYER_THRESHOLDS = [0.05, 0.15, 0.25];
const SPEED_CAUTION_THRESHOLD = 0.2;
const SPEED_DANGER_THRESHOLD = 0.3;

const compartments = [
  { halfTime: 5, a: 1.1696, b: 0.5578, pressure: 0 },
  { halfTime: 8, a: 1.0, b: 0.6514, pressure: 0 },
  { halfTime: 12.5, a: 0.8618, b: 0.7222, pressure: 0 },
  { halfTime: 18.5, a: 0.7562, b: 0.7825, pressure: 0 },
  { halfTime: 27, a: 0.6667, b: 0.8125, pressure: 0 },
  { halfTime: 38.3, a: 0.6164, b: 0.8434, pressure: 0 },
  { halfTime: 54.3, a: 0.5545, b: 0.8693, pressure: 0 },
  { halfTime: 77, a: 0.4980, b: 0.8910, pressure: 0 },
  { halfTime: 109, a: 0.4410, b: 0.9092, pressure: 0 },
  { halfTime: 146, a: 0.4187, b: 0.9222, pressure: 0 },
  { halfTime: 187, a: 0.3798, b: 0.9319, pressure: 0 },
  { halfTime: 239, a: 0.3497, b: 0.9403, pressure: 0 },
  { halfTime: 305, a: 0.3223, b: 0.9477, pressure: 0 },
  { halfTime: 390, a: 0.2971, b: 0.9544, pressure: 0 },
  { halfTime: 498, a: 0.2737, b: 0.9602, pressure: 0 },
  { halfTime: 635, a: 0.2523, b: 0.9653, pressure: 0 }
];

const depthChartCanvas = document.getElementById('depth-chart');

const ui = {
  currentDepth: document.getElementById('current-depth'),
  diveTime: document.getElementById('dive-time'),
  ndl: document.getElementById('ndl'),
  ndlContainer: document.getElementById('ndl-display'),
  ndlLabel: document.getElementById('ndl-label'),
  ndlUnit: document.getElementById('ndl-unit'),
  tts: document.getElementById('tts'),
  avgDepth: document.getElementById('avg-depth'),
  maxDepth: document.getElementById('max-depth'),
  po2: document.getElementById('po2'),
  tankPressure: document.getElementById('tank-pressure'),
  gasRemaining: document.getElementById('gas-remaining'),
  tankBarFill: document.getElementById('tank-bar-fill'),
  statusText: document.getElementById('status-text'),
  targetDepthValue: document.getElementById('target-depth-value'),
  workloadValue: document.getElementById('workload-value'),
  verticalSpeed: document.getElementById('vertical-speed'),
  speedIndicator: document.getElementById('speed-indicator'),
  waterTemp: document.getElementById('water-temp-display'),
  depthChartCanvas,
  depthChartCtx: depthChartCanvas ? depthChartCanvas.getContext('2d') : null
};

const controls = {
  targetDepth: document.getElementById('target-depth'),
  rate: document.getElementById('rate'),
  waterTemp: document.getElementById('water-temp'),
  cylinderSize: document.getElementById('cylinder-size'),
  fillPressure: document.getElementById('fill-pressure'),
  o2: document.getElementById('o2'),
  sac: document.getElementById('sac'),
  workload: document.getElementById('workload'),
  gfLow: document.getElementById('gf-low'),
  gfHigh: document.getElementById('gf-high'),
  reset: document.getElementById('reset'),
  timeScale: document.getElementById('time-scale'),
  gasSettings: document.getElementById('gas-settings')
};

const state = {
  depth: 0,
  targetDepth: Number(controls.targetDepth.value),
  elapsedTime: 0,
  diveTime: 0,
  avgDepth: 0,
  maxDepth: 0,
  diveActive: false,
  safetyStopTimer: 0,
  safetyStopRequired: false,
  safetyStopActive: false,
  safetyStopCompleted: false,
  initialGasVolume: 0,
  remainingGasVolume: 0,
  tankPressure: 0,
  lockGasSettings: false,
  lastDepth: 0,
  verticalSpeed: 0,
  depthHistory: []
};

function initializeCompartments() {
  const fn2 = getFN2();
  const initialPressure = fn2 * SURFACE_PRESSURE;
  compartments.forEach((comp) => {
    comp.pressure = initialPressure;
  });
}

function getFO2() {
  return Math.max(0.21, Math.min(0.4, Number(controls.o2.value) / 100));
}

function getFN2() {
  return 1 - getFO2();
}

function calculateTankVolumes() {
  const size = Number(controls.cylinderSize.value);
  const fillPressure = Number(controls.fillPressure.value);
  state.initialGasVolume = size * fillPressure;
  if (!state.diveActive) {
    state.remainingGasVolume = state.initialGasVolume;
    state.tankPressure = fillPressure;
  }
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateUI() {
  ui.currentDepth.textContent = state.depth.toFixed(1);
  ui.diveTime.textContent = formatTime(state.diveTime);
  ui.avgDepth.textContent = state.avgDepth.toFixed(1);
  ui.maxDepth.textContent = state.maxDepth.toFixed(1);
  if (ui.waterTemp) {
    ui.waterTemp.textContent = controls.waterTemp.value;
  }
  updateSpeedIndicator();

  const ndl = calculateNDL();
  const decoPlan = ndl <= 0 ? calculateDecoStop() : null;
  const ndlUnit = ui.ndlUnit;
  const ndlLabel = ui.ndlLabel;
  const ndlContainer = ui.ndlContainer;

  if (ndlContainer) {
    ndlContainer.classList.remove('ndl--safety-pause', 'ndl--safety-active', 'ndl--deco');
  }
  if (ndlLabel) {
    ndlLabel.textContent = '無減壓極限';
  }
  if (ndlUnit) {
    ndlUnit.textContent = ' 分鐘';
  }

  if (state.safetyStopRequired && !state.safetyStopCompleted) {
    const remainingSeconds = Math.max(0, Math.ceil(state.safetyStopTimer));
    ui.ndl.textContent = formatTime(remainingSeconds);
    if (ndlUnit) {
      ndlUnit.textContent = '';
    }
    if (ndlLabel) {
      ndlLabel.textContent = state.safetyStopActive ? 'Safety Stop' : 'Safety Pause';
    }
    if (ndlContainer) {
      ndlContainer.classList.add(state.safetyStopActive ? 'ndl--safety-active' : 'ndl--safety-pause');
    }
  } else if (decoPlan) {
    if (ndlLabel) {
      ndlLabel.textContent = '減壓停留';
    }
    const stopMinutes = decoPlan.duration / 60;
    ui.ndl.textContent = `${decoPlan.depth.toFixed(0)} 公尺`;
    if (ndlUnit) {
      ndlUnit.textContent = ` · ${stopMinutes.toFixed(1)} 分鐘`;
    }
    if (ndlContainer) {
      ndlContainer.classList.add('ndl--deco');
    }
  } else {
    const ndlValue = Number.isFinite(ndl) ? ndl.toFixed(0) : '∞';
    ui.ndl.textContent = ndlValue;
    if (ndlUnit) {
      ndlUnit.textContent = Number.isFinite(ndl) ? ' 分鐘' : '';
    }
  }
  ui.tts.textContent = calculateTTS().toFixed(1);

  const po2 = getFO2() * getAmbientPressure(state.depth);
  ui.po2.textContent = po2.toFixed(2);

  ui.tankPressure.textContent = state.tankPressure.toFixed(0);
  ui.gasRemaining.textContent = Math.max(state.remainingGasVolume, 0).toFixed(0);

  const tankFill = state.initialGasVolume > 0 ? Math.max(state.remainingGasVolume / state.initialGasVolume, 0) : 0;
  ui.tankBarFill.style.height = `${(tankFill * 100).toFixed(1)}%`;

  const status = deriveStatus(po2, ndl, tankFill);
  ui.statusText.textContent = status.text;
  ui.statusText.className = `status-${status.level}`;

  renderDepthChart();
}

function deriveStatus(po2, ndl, tankFill) {
  if (!state.diveActive) {
    return { text: '待命', level: 'normal' };
  }

  if (state.safetyStopRequired && !state.safetyStopCompleted) {
    return { text: 'Safety Stop', level: 'warning' };
  }

  if (state.safetyStopCompleted) {
    return { text: 'Safety Done', level: 'normal' };
  }

  const modWorking = calculateMOD(1.4);
  const modAbsolute = calculateMOD(1.6);

  if (state.depth > modAbsolute) {
    return { text: 'MOD ALERT', level: 'mod-alert' };
  }

  if (Math.abs(state.verticalSpeed) >= SPEED_DANGER_THRESHOLD) {
    return { text: 'SLOW DOWN', level: 'alert' };
  }
  if (state.depth > modWorking) {
    return { text: 'PO₂ HIGH / 接近 MOD', level: 'warning' };
  }
  if (po2 >= 1.6) {
    return { text: 'PO₂ DANGER', level: 'danger' };
  }
  if (po2 >= 1.4) {
    return { text: 'PO₂ ELEVATED', level: 'warning' };
  }
  if (tankFill <= 0.1) {
    return { text: '氣體剩餘極低', level: 'danger' };
  }
  if (tankFill <= 0.25) {
    return { text: '氣體不足', level: 'warning' };
  }
  if (ndl <= 0) {
    return { text: 'DECO NEEDED / 需進入減壓', level: 'deco-needed' };
  }
  if (ndl <= 3) {
    return { text: 'LOW NDL / 無減壓極限不足', level: 'low-ndl' };
  }
  if (ndl <= 10) {
    return { text: 'NDL NEAR LIMIT / 接近無減壓極限', level: 'warning' };
  }
  return { text: '下潛中', level: 'normal' };
}

function renderDepthChart() {
  const canvas = ui.depthChartCanvas;
  const ctx = ui.depthChartCtx;
  if (!canvas || !ctx) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const displayWidth = Math.round(width * dpr);
  const displayHeight = Math.round(height * dpr);
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const styles = getComputedStyle(document.documentElement);
  const readVar = (name, fallback) => {
    const value = styles.getPropertyValue(name);
    return value ? value.trim() || fallback : fallback;
  };

  const gradientStart = readVar('--chart-gradient-start', '#1a2b3a');
  const gradientEnd = readVar('--chart-gradient-end', '#0c141d');
  const gridColor = readVar('--chart-grid', 'rgba(255, 255, 255, 0.06)');
  const lineColor = readVar('--chart-line', '#26c6da');
  const fillColor = readVar('--chart-fill', 'rgba(38, 198, 218, 0.22)');
  const markerColor = readVar('--chart-marker', '#ffcc66');
  const placeholderColor = readVar('--chart-placeholder', '#6f8399');

  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, gradientStart);
  gradient.addColorStop(1, gradientEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const padding = 12;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  if (chartWidth <= 0 || chartHeight <= 0) {
    return;
  }

  const history = state.depthHistory;
  if (!history.length) {
    ctx.fillStyle = placeholderColor;
    ctx.font = '600 14px "Segoe UI", Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('等待深度資料', width / 2, height / 2);
    return;
  }

  let minTime = history[0].time;
  let maxTime = history[history.length - 1].time;
  if (minTime === maxTime) {
    minTime = Math.max(0, minTime - 60);
  }

  let maxDepthValue = 0;
  let minDepthValue = Infinity;
  history.forEach((point) => {
    maxDepthValue = Math.max(maxDepthValue, point.depth);
    minDepthValue = Math.min(minDepthValue, point.depth);
  });
  if (!Number.isFinite(minDepthValue)) {
    minDepthValue = 0;
  }

  const depthPadding = Math.max(1, maxDepthValue * 0.1);
  const maxDepth = Math.max(5, maxDepthValue + depthPadding);
  const minDepth = Math.max(0, Math.min(minDepthValue, 0));
  const depthRange = Math.max(1, maxDepth - minDepth);
  const timeRange = Math.max(1, maxTime - minTime);

  const getX = (time) => padding + ((time - minTime) / timeRange) * chartWidth;
  const getY = (depth) => padding + ((depth - minDepth) / depthRange) * chartHeight;
  const surfaceY = getY(minDepth);

  ctx.save();
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i += 1) {
    const y = padding + (chartHeight / gridSteps) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + chartWidth, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(padding, surfaceY);
  history.forEach((point, index) => {
    const x = getX(point.time);
    if (index === 0) {
      ctx.lineTo(x, surfaceY);
    }
    ctx.lineTo(x, getY(point.depth));
  });
  ctx.lineTo(getX(history[history.length - 1].time), surfaceY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  history.forEach((point, index) => {
    const x = getX(point.time);
    const y = getY(point.depth);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.restore();

  const currentPoint = history[history.length - 1];
  const currentX = getX(currentPoint.time);
  const currentY = getY(currentPoint.depth);

  ctx.save();
  ctx.strokeStyle = markerColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(padding, currentY);
  ctx.lineTo(padding + chartWidth, currentY);
  ctx.stroke();
  ctx.restore();

  const deepestPoint = history.reduce((maxPoint, point) => (point.depth > maxPoint.depth ? point : maxPoint), history[0]);
  const deepestX = getX(deepestPoint.time);
  const deepestY = getY(deepestPoint.depth);

  ctx.save();
  ctx.fillStyle = markerColor;
  ctx.beginPath();
  ctx.arc(currentX, currentY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0b1118';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (deepestPoint.depth > currentPoint.depth + 0.5) {
    ctx.beginPath();
    ctx.arc(deepestX, deepestY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function getAmbientPressure(depth) {
  return SURFACE_PRESSURE + depth / WATER_DENSITY_DIVISOR;
}

function calculateMOD(limit) {
  const fo2 = getFO2();
  if (fo2 <= 0) {
    return Infinity;
  }
  const ambientLimit = limit / fo2;
  return Math.max(0, (ambientLimit - SURFACE_PRESSURE) * WATER_DENSITY_DIVISOR);
}

function updateCompartments(dtSeconds) {
  const fn2 = getFN2();
  const ambientPressure = getAmbientPressure(state.depth);
  const inspiredPressure = Math.max(0, (ambientPressure - WATER_VAPOR_PRESSURE) * fn2);
  compartments.forEach((comp) => {
    const rateConstant = Math.log(2) / comp.halfTime;
    const delta = inspiredPressure - comp.pressure;
    comp.pressure += delta * (1 - Math.exp(-rateConstant * (dtSeconds / 60)));
  });
}

function getGradientFactorForDepth(depth) {
  const gfLow = Math.max(0.1, Math.min(0.99, Number(controls.gfLow.value) / 100));
  const gfHigh = Math.max(gfLow, Math.min(0.99, Number(controls.gfHigh.value) / 100));
  const blendDepth = Math.min(depth, 30);
  const t = Math.max(0, Math.min(1, 1 - blendDepth / 30));
  const gf = gfLow + (gfHigh - gfLow) * t;
  return Math.max(0.1, Math.min(0.99, gf));
}

function getGradientFactor() {
  return getGradientFactorForDepth(state.depth);
}

function calculateNDL() {
  const gf = getGradientFactor();
  const fn2 = getFN2();
  const ambientPressure = getAmbientPressure(state.depth);
  const inspiredPressure = Math.max(0, (ambientPressure - WATER_VAPOR_PRESSURE) * fn2);

  if (inspiredPressure <= 0) {
    return Infinity;
  }

  let ndlMinutes = Infinity;

  compartments.forEach((comp) => {
    const a = comp.a;
    const b = comp.b;
    const m0 = a + (SURFACE_PRESSURE / b);
    const allowed = SURFACE_PRESSURE + (m0 - SURFACE_PRESSURE) * gf;

    if (allowed <= comp.pressure) {
      ndlMinutes = Math.min(ndlMinutes, 0);
      return;
    }

    if (inspiredPressure <= comp.pressure) {
      return;
    }

    const numerator = allowed - comp.pressure;
    const denominator = inspiredPressure - comp.pressure;
    if (numerator <= 0 || denominator <= 0) {
      ndlMinutes = Math.min(ndlMinutes, 0);
      return;
    }

    const rateConstant = Math.log(2) / comp.halfTime;
    const time = -Math.log(1 - numerator / denominator) / rateConstant;
    ndlMinutes = Math.min(ndlMinutes, time);
  });

  return ndlMinutes;
}

function getAllowedTissuePressure(compartment, depth, gf) {
  const ambient = getAmbientPressure(depth);
  const mValue = ambient / compartment.b + compartment.a;
  return ambient + (mValue - ambient) * gf;
}

function calculateDecoStop() {
  if (!state.diveActive) return null;

  const fn2 = getFN2();
  const maxDepth = Math.max(DECO_STOP_STEP, Math.ceil(state.depth / DECO_STOP_STEP) * DECO_STOP_STEP);

  let stopDepth = null;

  for (let depth = 0; depth <= maxDepth; depth += DECO_STOP_STEP) {
    const gf = getGradientFactorForDepth(depth);
    const safe = compartments.every((comp) => comp.pressure <= getAllowedTissuePressure(comp, depth, gf) + 1e-6);
    if (safe) {
      stopDepth = depth;
      break;
    }
  }

  if (stopDepth === null || stopDepth <= 0) {
    return null;
  }

  const nextTargetDepth = Math.max(0, stopDepth - DECO_STOP_STEP);
  const ambientStop = getAmbientPressure(stopDepth);
  const inspiredStop = Math.max(0, (ambientStop - WATER_VAPOR_PRESSURE) * fn2);
  const gfNext = getGradientFactorForDepth(nextTargetDepth);

  let requiredSeconds = 0;

  compartments.forEach((comp) => {
    const allowedNext = getAllowedTissuePressure(comp, nextTargetDepth, gfNext);
    if (comp.pressure <= allowedNext) {
      return;
    }

    const rateConstant = Math.log(2) / comp.halfTime; // per minute
    const denominator = comp.pressure - inspiredStop;
    const numerator = allowedNext - inspiredStop;

    if (denominator <= 0 || numerator <= 0 || numerator >= denominator) {
      return;
    }

    const timeMinutes = -Math.log(numerator / denominator) / rateConstant;
    if (Number.isFinite(timeMinutes) && timeMinutes > 0) {
      requiredSeconds = Math.max(requiredSeconds, timeMinutes * 60);
    }
  });

  return {
    depth: stopDepth,
    duration: Math.max(0, Math.ceil(requiredSeconds))
  };
}

function calculateTTS() {
  if (!state.diveActive) return 0;
  const rate = Math.max(1, Number(controls.rate.value));
  const ascentTime = state.depth / rate; // minutes
  let stop = 0;
  if (state.depth >= SAFETY_STOP_DEPTH + 1 && state.diveTime > 600) {
    stop = SAFETY_STOP_DURATION / 60;
  }
  return ascentTime + stop;
}

function updateGas(dtSeconds) {
  if (!state.diveActive) {
    return;
  }
  const surfaceSac = Number(controls.sac.value);
  const workload = Number(controls.workload.value);
  const ambientPressure = getAmbientPressure(state.depth);
  const sac = surfaceSac * ambientPressure * workload; // L/min
  const consumed = (sac / 60) * dtSeconds;
  state.remainingGasVolume = Math.max(0, state.remainingGasVolume - consumed);
  const size = Number(controls.cylinderSize.value);
  state.tankPressure = size > 0 ? (state.remainingGasVolume / size) : 0;
}

function updateAverages(dtSeconds) {
  state.elapsedTime += dtSeconds;
  if (state.depth >= DIVE_START_THRESHOLD) {
    state.diveActive = true;
    state.diveTime += dtSeconds;
    state.avgDepth = ((state.avgDepth * (state.diveTime - dtSeconds)) + state.depth * dtSeconds) / state.diveTime;
    state.maxDepth = Math.max(state.maxDepth, state.depth);
  }
}

function recordDepthHistory() {
  const history = state.depthHistory;
  if (!history) {
    return;
  }

  const time = state.elapsedTime;
  history.push({ time, depth: state.depth });
}

function updateDepth(dtSeconds) {
  const previousDepth = state.lastDepth;
  const target = state.targetDepth;
  const ratePerSecond = Math.max(0.1, Number(controls.rate.value) / 60);
  const difference = target - state.depth;

  if (Math.abs(difference) < ratePerSecond * dtSeconds) {
    state.depth = target;
  } else {
    state.depth += Math.sign(difference) * ratePerSecond * dtSeconds;
  }

  if (state.depth < 0.01) {
    state.depth = 0;
  }

  const delta = state.depth - previousDepth;
  state.verticalSpeed = Number.isFinite(delta / dtSeconds) ? delta / dtSeconds : 0;
  state.lastDepth = state.depth;
}

function updateSafetyStop(dtSeconds) {
  if (!state.diveActive) {
    state.safetyStopRequired = false;
    state.safetyStopActive = false;
    state.safetyStopCompleted = false;
    state.safetyStopTimer = 0;
    return;
  }

  const hasSufficientDiveTime = state.diveTime >= 600;
  state.safetyStopRequired = hasSufficientDiveTime || state.safetyStopCompleted;

  if (!hasSufficientDiveTime) {
    state.safetyStopActive = false;
    state.safetyStopCompleted = false;
    state.safetyStopTimer = 0;
    return;
  }

  if (!state.safetyStopCompleted && state.safetyStopTimer <= 0) {
    state.safetyStopTimer = SAFETY_STOP_DURATION;
  }

  if (state.safetyStopCompleted) {
    state.safetyStopActive = false;
    state.safetyStopTimer = 0;
    return;
  }

  const withinStopZone = state.depth >= 3 && state.depth <= SAFETY_STOP_DEPTH + 1;

  if (withinStopZone) {
    state.safetyStopActive = true;
    state.safetyStopTimer = Math.max(0, state.safetyStopTimer - dtSeconds);
    if (state.safetyStopTimer <= 0) {
      state.safetyStopCompleted = true;
      state.safetyStopActive = false;
      state.safetyStopTimer = 0;
    }
  } else {
    state.safetyStopActive = false;
  }
}

function tick() {
  const timeScale = Number(controls.timeScale.value);
  const dtSeconds = timeScale;

  updateDepth(dtSeconds);
  updateAverages(dtSeconds);
  recordDepthHistory();
  updateCompartments(dtSeconds);
  updateGas(dtSeconds);
  updateSafetyStop(dtSeconds);
  updateUI();

  handleGasLock();
}

function handleGasLock() {
  if (state.diveActive && !state.lockGasSettings) {
    state.lockGasSettings = true;
    controls.cylinderSize.disabled = true;
    controls.fillPressure.disabled = true;
    controls.o2.disabled = true;
  }
}

function resetGasLock() {
  state.lockGasSettings = false;
  controls.cylinderSize.disabled = false;
  controls.fillPressure.disabled = false;
  controls.o2.disabled = false;
}

function reset() {
  state.depth = 0;
  controls.targetDepth.value = 0;
  updateTargetDepthLabel();
  state.targetDepth = 0;
  state.elapsedTime = 0;
  state.diveTime = 0;
  state.avgDepth = 0;
  state.maxDepth = 0;
  state.diveActive = false;
  state.safetyStopTimer = 0;
  state.safetyStopRequired = false;
  state.safetyStopActive = false;
  state.safetyStopCompleted = false;
  state.lastDepth = 0;
  state.verticalSpeed = 0;
  state.depthHistory.length = 0;
  resetGasLock();
  clampGradientFactors();
  calculateTankVolumes();
  initializeCompartments();
  updateUI();
}

function updateSpeedIndicator() {
  if (!ui.speedIndicator || !ui.verticalSpeed) return;
  const speed = state.verticalSpeed;
  const magnitude = Math.abs(speed);
  ui.verticalSpeed.textContent = speed.toFixed(2);

  const classesToRemove = ['speed-indicator--up', 'speed-indicator--down', 'speed-indicator--calm'];
  ui.speedIndicator.classList.remove(...classesToRemove);

  if (magnitude < SPEED_LAYER_THRESHOLDS[0]) {
    ui.speedIndicator.classList.add('speed-indicator--calm');
  } else if (speed < 0) {
    ui.speedIndicator.classList.add('speed-indicator--up');
  } else {
    ui.speedIndicator.classList.add('speed-indicator--down');
  }

  let color = '#4db6ac';
  if (magnitude >= SPEED_DANGER_THRESHOLD) {
    color = '#ef5350';
  } else if (magnitude >= SPEED_CAUTION_THRESHOLD) {
    color = '#ffb74d';
  }
  ui.speedIndicator.style.setProperty('--speed-color', color);

  const layers = ui.speedIndicator.querySelectorAll('.speed-indicator__layer');
  layers.forEach((layer, index) => {
    if (magnitude >= SPEED_LAYER_THRESHOLDS[index]) {
      layer.classList.add('is-active');
    } else {
      layer.classList.remove('is-active');
    }
  });
}

function updateTargetDepthLabel() {
  state.targetDepth = Number(controls.targetDepth.value);
  ui.targetDepthValue.textContent = `${state.targetDepth.toFixed(1)} 公尺`;
}

function updateWorkloadLabel() {
  ui.workloadValue.textContent = `${Number(controls.workload.value).toFixed(1)}×`;
}

function clampGradientFactors() {
  let low = Number(controls.gfLow.value);
  let high = Number(controls.gfHigh.value);
  low = Math.max(10, Math.min(99, Math.round(low)));
  high = Math.max(10, Math.min(99, Math.round(high)));
  if (low >= high) {
    high = Math.min(99, low + 1);
    if (high <= low) {
      low = Math.max(10, high - 1);
    }
  }
  controls.gfLow.value = low;
  controls.gfHigh.value = high;
}

controls.targetDepth.addEventListener('input', () => {
  updateTargetDepthLabel();
});

controls.workload.addEventListener('input', () => {
  updateWorkloadLabel();
});

controls.rate.addEventListener('change', () => {
  controls.rate.value = Math.max(1, Math.min(30, Number(controls.rate.value)));
});

controls.gfLow.addEventListener('change', () => {
  clampGradientFactors();
});

controls.gfHigh.addEventListener('change', () => {
  clampGradientFactors();
});

controls.cylinderSize.addEventListener('change', calculateTankVolumes);
controls.fillPressure.addEventListener('change', calculateTankVolumes);
controls.o2.addEventListener('change', () => {
  if (state.diveActive) return;
  calculateTankVolumes();
  initializeCompartments();
});

controls.sac.addEventListener('change', () => {
  controls.sac.value = Math.max(5, Math.min(35, Number(controls.sac.value)));
});

controls.reset.addEventListener('click', reset);

if (typeof window !== 'undefined') {
  window.addEventListener('resize', renderDepthChart);
}

calculateTankVolumes();
initializeCompartments();
updateTargetDepthLabel();
updateWorkloadLabel();
clampGradientFactors();
updateUI();
setInterval(tick, BASE_TICK_MS);

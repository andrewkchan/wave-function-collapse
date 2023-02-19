(() => {
  // model.ts
  var IterationResult = /* @__PURE__ */ ((IterationResult2) => {
    IterationResult2[IterationResult2["END_SUCCESS"] = 0] = "END_SUCCESS";
    IterationResult2[IterationResult2["END_FAILURE"] = 1] = "END_FAILURE";
    IterationResult2[IterationResult2["ONGOING"] = 2] = "ONGOING";
    return IterationResult2;
  })(IterationResult || {});
  var DirVectors = {
    [0 /* RIGHT */]: [1, 0],
    [1 /* DOWN */]: [0, 1],
    [2 /* LEFT */]: [-1, 0],
    [3 /* UP */]: [0, -1]
  };
  var Opposite = {
    [0 /* RIGHT */]: 2 /* LEFT */,
    [1 /* DOWN */]: 3 /* UP */,
    [2 /* LEFT */]: 0 /* RIGHT */,
    [3 /* UP */]: 1 /* DOWN */
  };
  var SimplePixelModel = class {
    // imageData - Pixels to use as source image
    // width - Width of the generation
    // height - Height of the generation
    // isPeriodic - Whether the source image is considered a periodic pattern
    constructor(imageData, width, height, isPeriodic) {
      this._generationComplete = false;
      this._FMX = width;
      this._FMY = height;
      this._FMXxFMY = width * height;
      this._isPeriodic = isPeriodic;
      const hexMap = /* @__PURE__ */ new Map();
      const hexCount = /* @__PURE__ */ new Map();
      for (let i = 0; i < imageData.height; i++) {
        for (let j = 0; j < imageData.width; j++) {
          const r = imageData.data[i * 4 * imageData.width + j * 4 + 0];
          const g = imageData.data[i * 4 * imageData.width + j * 4 + 1];
          const b = imageData.data[i * 4 * imageData.width + j * 4 + 2];
          const a = imageData.data[i * 4 * imageData.width + j * 4 + 3];
          const hex = r | g << 8 | b << 16 | a << 24;
          if (!hexCount.has(hex)) {
            hexCount.set(hex, 0);
          }
          hexCount.set(hex, hexCount.get(hex) + 1);
          if (!hexMap.has(hex)) {
            hexMap.set(hex, {
              [0 /* RIGHT */]: /* @__PURE__ */ new Set(),
              [1 /* DOWN */]: /* @__PURE__ */ new Set(),
              [2 /* LEFT */]: /* @__PURE__ */ new Set(),
              [3 /* UP */]: /* @__PURE__ */ new Set()
            });
          }
          const dirMap = hexMap.get(hex);
          for (let d = 0 /* RIGHT */; d <= 3 /* UP */; d++) {
            let ii = i + DirVectors[d][1];
            let jj = j + DirVectors[d][0];
            if (ii < 0 || ii >= imageData.height) {
              if (this._isPeriodic) {
                ii = (imageData.height + ii) % imageData.height;
              } else {
                continue;
              }
            }
            if (jj < 0 || jj >= imageData.width) {
              if (this._isPeriodic) {
                jj = (imageData.width + jj) % imageData.width;
              } else {
                continue;
              }
            }
            const nR = imageData.data[ii * 4 * imageData.width + jj * 4 + 0];
            const nG = imageData.data[ii * 4 * imageData.width + jj * 4 + 1];
            const nB = imageData.data[ii * 4 * imageData.width + jj * 4 + 2];
            const nA = imageData.data[ii * 4 * imageData.width + jj * 4 + 3];
            const nHex = nR | nG << 8 | nB << 16 | nA << 24;
            dirMap[d].add(nHex);
          }
        }
      }
      this._colorRGBA = /* @__PURE__ */ new Map();
      const hexToID = /* @__PURE__ */ new Map();
      let colorID = 0;
      hexMap.forEach((_, hex) => {
        const r = hex >> 0 & 255;
        const g = hex >> 8 & 255;
        const b = hex >> 16 & 255;
        const a = hex >> 24 & 255;
        this._colorRGBA.set(colorID, { r, g, b, a });
        hexToID.set(hex, colorID);
        colorID++;
      });
      this._propagator = /* @__PURE__ */ new Map();
      hexMap.forEach((dirMapHex, hex) => {
        const dirMapIDs = {
          [0 /* RIGHT */]: Array.from(dirMapHex[0 /* RIGHT */].values()).map((nHex) => hexToID.get(nHex)),
          [1 /* DOWN */]: Array.from(dirMapHex[1 /* DOWN */].values()).map((nHex) => hexToID.get(nHex)),
          [2 /* LEFT */]: Array.from(dirMapHex[2 /* LEFT */].values()).map((nHex) => hexToID.get(nHex)),
          [3 /* UP */]: Array.from(dirMapHex[3 /* UP */].values()).map((nHex) => hexToID.get(nHex))
        };
        this._propagator.set(hexToID.get(hex), dirMapIDs);
      });
      this._numColors = this._propagator.size;
      this._weights = [];
      for (let t = 0; t < this._numColors; t++) {
        const rgba = this._colorRGBA.get(t);
        const hex = rgba.r | rgba.g << 8 | rgba.b << 16 | rgba.a << 24;
        const count = hexCount.get(hex);
        this._weights.push(count / this._FMXxFMY);
      }
    }
    initialize() {
      debugLog(`initializing wave`);
      this._wave = new Array(this._FMXxFMY);
      this._compatible = new Array(this._FMXxFMY);
      for (let i = 0; i < this._FMXxFMY; i++) {
        this._wave[i] = new Array(this._numColors);
        this._compatible[i] = /* @__PURE__ */ new Map();
        for (let t = 0; t < this._numColors; t++) {
          this._compatible[i].set(t, {
            [0 /* RIGHT */]: 0,
            [1 /* DOWN */]: 0,
            [2 /* LEFT */]: 0,
            [3 /* UP */]: 0
          });
        }
      }
      this._startingEntropy = 0;
      this._weightLogWeights = new Array(this._numColors);
      for (let t = 0; t < this._numColors; t++) {
        this._weightLogWeights[t] = this._weights[t] * Math.log(this._weights[t]);
        this._startingEntropy -= this._weightLogWeights[t];
      }
      this._entropies = new Array(this._FMXxFMY);
      this._stack = [];
      debugLog(`init done`, JSON.stringify(this));
    }
    putGeneratedData(array) {
      if (!this._generationComplete) {
        console.error("Cannot putGeneratedData when generation incomplete");
        return;
      }
      for (let i = 0; i < this._FMXxFMY; i++) {
        const colorID = this._observed[i];
        const rgba = this._colorRGBA.get(colorID);
        array[4 * i + 0] = rgba.r;
        array[4 * i + 1] = rgba.g;
        array[4 * i + 2] = rgba.b;
        array[4 * i + 3] = rgba.a;
      }
    }
    // Execute a full new generation
    // rng - Random number generator function
    // Returns true iff generation succeeded.
    generate(rng) {
      if (!this._wave) {
        this.initialize();
      }
      rng = rng || Math.random;
      debugLog(`[generate] clearing`);
      this.clear();
      let i = 0;
      while (true) {
        debugLog(`[generate] iterate ${i}...`);
        const result = this.iterate(rng);
        if (result !== 2 /* ONGOING */) {
          debugLog(`[generate] iterations completed with result ${IterationResult[result]}`);
          return result === 0 /* END_SUCCESS */;
        }
        i++;
      }
    }
    iterate(rng) {
      if (!this._wave) {
        this.initialize();
      }
      debugLog(`[iterate] observe`);
      const result = this._observe(rng);
      if (result !== 2 /* ONGOING */) {
        this._generationComplete = result === 0 /* END_SUCCESS */;
        return result;
      }
      debugLog(`[iterate] propagate`);
      this._propagate();
      return 2 /* ONGOING */;
    }
    isGenerationComplete() {
      return this._generationComplete;
    }
    clear() {
      for (let i = 0; i < this._FMXxFMY; i++) {
        for (let t = 0; t < this._numColors; t++) {
          this._wave[i][t] = true;
          for (let d = 0 /* RIGHT */; d <= 3 /* UP */; d++) {
            for (let t2 = 0; t2 < this._numColors; t2++) {
              this._propagator.get(t2)[Opposite[d]].forEach((color) => {
                if (color === t) {
                  this._compatible[i].get(t)[d]++;
                }
              });
            }
          }
        }
        this._entropies[i] = this._startingEntropy;
      }
      this._generationComplete = false;
      debugLog(`clear done`, JSON.stringify(this));
    }
    // Find cell with minimum non-zero entropy and collapse its wavefunction by setting it
    // to a single color. If no such cell exists, return IterationResult.END_SUCCESS.
    // If we find a contradiction (a cell with no possible colors), return IterationResult.END_FAILURE.
    // Else return IterationResult.ONGOING.
    _observe(rng) {
      let min = Infinity;
      let argmin = -1;
      for (let i = 0; i < this._FMXxFMY; i++) {
        if (this._onBoundary(i % this._FMX, i / this._FMX | 0)) {
          continue;
        }
        let numChoices = 0;
        this._wave[i].forEach((isPossible) => {
          if (isPossible) {
            numChoices++;
          }
        });
        if (numChoices === 0) {
          debugLog("[observe] found cell with 0 choices");
          return 1 /* END_FAILURE */;
        }
        const entropy = this._entropies[i];
        if (numChoices > 1 && entropy <= min) {
          const noise = 1e-6 * rng();
          if (entropy + noise < min) {
            min = entropy + noise;
            argmin = i;
          }
        }
      }
      if (argmin === -1) {
        this._observed = new Array(this._FMXxFMY);
        for (let i = 0; i < this._FMXxFMY; i++) {
          for (let t = 0; t < this._numColors; t++) {
            if (this._wave[i][t]) {
              this._observed[i] = t;
              break;
            }
          }
        }
        return 0 /* END_SUCCESS */;
      }
      const distribution = new Array(this._numColors);
      for (let t = 0; t < this._numColors; t++) {
        distribution[t] = this._wave[argmin][t] ? this._weights[t] : 0;
      }
      const colorIndex = sampleDiscrete(distribution, rng());
      const w = this._wave[argmin];
      for (let t = 0; t < this._numColors; t++) {
        if (w[t] !== (t === colorIndex)) {
          this._ban(argmin, t);
        }
      }
      return 2 /* ONGOING */;
    }
    // Propagate constraints affected by the observed cell through the wave.
    _propagate() {
      while (this._stack.length > 0) {
        const e1 = this._stack.pop();
        const i1 = e1.cellIndex;
        const x1 = i1 % this._FMX;
        const y1 = i1 / this._FMX | 0;
        for (let d = 0 /* RIGHT */; d <= 3 /* UP */; d++) {
          const dx = DirVectors[d][0];
          const dy = DirVectors[d][1];
          let x2 = x1 + dx;
          let y2 = y1 + dy;
          if (this._onBoundary(x2, y2)) {
            continue;
          }
          if (x2 < 0) {
            x2 += this._FMX;
          } else if (x2 >= this._FMX) {
            x2 -= this._FMX;
          }
          if (y2 < 0) {
            y2 += this._FMY;
          } else if (y2 >= this._FMY) {
            y2 -= this._FMY;
          }
          const i2 = x2 + y2 * this._FMX;
          const compatibleColors = this._compatible[i2];
          const targetColorsForDir = this._propagator.get(e1.color)[d];
          targetColorsForDir.forEach((t2) => {
            const compatibleNeighborEdges = compatibleColors.get(t2);
            compatibleNeighborEdges[d]--;
            if (compatibleNeighborEdges[d] <= 0) {
              this._ban(i2, t2);
            }
          });
        }
      }
    }
    // Returns whether given x and y coordinates are on the boundary of generation.
    _onBoundary(x, y) {
      return !this._isPeriodic && (x < 0 || y < 0 || x >= this._FMX || y >= this._FMY);
    }
    // Removes color with index `t` from the possible colors for generation cell `i`.
    _ban(i, t) {
      if (this._wave[i][t] === false) {
        return;
      }
      this._wave[i][t] = false;
      this._stack.push({ cellIndex: i, color: t });
      let entropy = 0;
      for (let c = 0; c < this._numColors; c++) {
        if (this._wave[i][c]) {
          entropy -= this._weightLogWeights[i];
        }
      }
      this._entropies[i] = entropy;
    }
    // for debugging only
    countPossibilities() {
      let n = 0;
      if (!this._wave) {
        return n;
      }
      this._wave.forEach((choices) => {
        choices.forEach((choice) => {
          if (choice) {
            n++;
          }
        });
      });
      return n;
    }
  };
  function sampleDiscrete(weights, r) {
    let sum = 0;
    let x = 0;
    for (let i2 = 0; i2 < weights.length; i2++) {
      sum += weights[i2];
    }
    let i = 0;
    r *= sum;
    while (r && i < weights.length) {
      x += weights[i];
      if (r <= x) {
        return i;
      }
      i++;
    }
    return 0;
  }
  var DEBUG_LOG = false;
  function debugLog(...args) {
    if (DEBUG_LOG) {
      console.log(arguments);
    }
  }

  // index.ts
  var inputCanvas = document.getElementById("input-canvas");
  function generate() {
    const outputCanvas = document.getElementById("output-canvas");
    const inputCtx = inputCanvas.getContext("2d");
    const imageData = inputCtx.getImageData(0, 0, inputCanvas.width, inputCanvas.height);
    const model = new SimplePixelModel(imageData, outputCanvas.width, outputCanvas.height, true);
    let success = model.generate();
    const MAX_RETRIES = 10;
    if (!success) {
      for (let i = 0; i < MAX_RETRIES && !success; i++) {
        console.log(`Generation failed, retrying ${i + 1} of ${MAX_RETRIES} times...`);
        success = model.generate();
      }
    }
    if (success) {
      const outputCtx = outputCanvas.getContext("2d");
      const outputData = outputCtx.createImageData(outputCanvas.width, outputCanvas.height);
      model.putGeneratedData(outputData.data);
      outputCtx.putImageData(outputData, 0, 0);
    } else {
      console.warn(`Generation failed with ${MAX_RETRIES} attempts. Click 'generate' again to retry.`);
    }
  }
  var generateButton = document.getElementById("generate");
  generateButton == null ? void 0 : generateButton.addEventListener("click", (e) => {
    generate();
  });
  var inputFile = document.getElementById("input-file");
  inputFile == null ? void 0 : inputFile.addEventListener("change", (e) => {
    if (inputFile.files && inputFile.files.length > 0) {
      const file = inputFile.files[0];
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        inputCanvas.width = img.naturalWidth;
        inputCanvas.height = img.naturalHeight;
        const aspect = img.naturalWidth / img.naturalHeight;
        inputCanvas.style.width = `${aspect * 128}px`;
        inputCanvas.style.height = `128px`;
        const ctx = inputCanvas.getContext("2d");
        ctx == null ? void 0 : ctx.drawImage(img, 0, 0);
      };
    }
  });
  var inputSelect = document.getElementById("input-select");
  inputSelect == null ? void 0 : inputSelect.addEventListener("change", (e) => {
    var _a;
    const value = (_a = e == null ? void 0 : e.target) == null ? void 0 : _a.value;
    if (value) {
      const img = new Image();
      img.src = value;
      img.onload = () => {
        inputCanvas.width = img.naturalWidth;
        inputCanvas.height = img.naturalHeight;
        const aspect = img.naturalWidth / img.naturalHeight;
        inputCanvas.style.width = `${aspect * 128}px`;
        inputCanvas.style.height = `128px`;
        const ctx = inputCanvas.getContext("2d");
        ctx == null ? void 0 : ctx.drawImage(img, 0, 0);
      };
    }
  });
})();
//# sourceMappingURL=index.js.map

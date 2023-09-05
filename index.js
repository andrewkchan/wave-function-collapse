(() => {
  // model.ts
  var IterationResult = /* @__PURE__ */ ((IterationResult2) => {
    IterationResult2[IterationResult2["END_SUCCESS"] = 0] = "END_SUCCESS";
    IterationResult2[IterationResult2["END_FAILURE"] = 1] = "END_FAILURE";
    IterationResult2[IterationResult2["ONGOING"] = 2] = "ONGOING";
    return IterationResult2;
  })(IterationResult || {});
  var CardinalBasis = {
    numDirections: 4,
    vector: (i) => {
      switch (i) {
        case 0: {
          return [1, 0];
        }
        case 1: {
          return [0, 1];
        }
        case 2: {
          return [-1, 0];
        }
        case 3: {
          return [0, -1];
        }
      }
      throw new Error(`Unhandled direction ${i} for cardinal basis`);
    },
    opposite: (i) => {
      switch (i) {
        case 0: {
          return 2;
        }
        case 1: {
          return 3;
        }
        case 2: {
          return 0;
        }
        case 3: {
          return 1;
        }
      }
      throw new Error(`Unhandled direction ${i} for cardinal basis`);
    }
  };
  var CardinalBasisWithDiagonals = {
    numDirections: 8,
    vector: (i) => {
      switch (i) {
        case 0: {
          return [1, 0];
        }
        case 1: {
          return [0, 1];
        }
        case 2: {
          return [-1, 0];
        }
        case 3: {
          return [0, -1];
        }
        case 4: {
          return [1, 1];
        }
        case 5: {
          return [1, -1];
        }
        case 6: {
          return [-1, -1];
        }
        case 7: {
          return [-1, 1];
        }
      }
      throw new Error(`Unhandled direction ${i} for cardinal basis`);
    },
    opposite: (i) => {
      switch (i) {
        case 0: {
          return 2;
        }
        case 1: {
          return 3;
        }
        case 2: {
          return 0;
        }
        case 3: {
          return 1;
        }
        case 4: {
          return 6;
        }
        case 5: {
          return 7;
        }
        case 6: {
          return 4;
        }
        case 7: {
          return 5;
        }
      }
      throw new Error(`Unhandled direction ${i} for cardinal basis with diagonals`);
    }
  };
  var SimplePixelModel = class {
    // imageData - Pixels to use as source image
    // width - Width of the generation
    // height - Height of the generation
    // isPeriodic - Whether the source image is considered a periodic pattern
    // basis - A Basis object providing the constraining edges for each cell.
    constructor(imageData, width, height, isPeriodic, basis) {
      this._generationComplete = false;
      this._FMX = width;
      this._FMY = height;
      this._FMXxFMY = width * height;
      this._isPeriodic = isPeriodic;
      this._basis = basis;
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
            hexMap.set(hex, /* @__PURE__ */ new Map());
          }
          const dirMap = hexMap.get(hex);
          for (let d = 0; d < this._basis.numDirections; d++) {
            let ii = i + this._basis.vector(d)[1];
            let jj = j + this._basis.vector(d)[0];
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
            if (!dirMap.has(d)) {
              dirMap.set(d, /* @__PURE__ */ new Set());
            }
            dirMap.get(d).add(nHex);
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
        const dirMapIDs = /* @__PURE__ */ new Map();
        for (let d = 0; d < this._basis.numDirections; d++) {
          dirMapIDs.set(d, Array.from(dirMapHex.get(d).values()).map((nHex) => hexToID.get(nHex)));
        }
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
          const dirCount = /* @__PURE__ */ new Map();
          for (let d = 0; d < this._basis.numDirections; d++) {
            dirCount.set(d, 0);
          }
          this._compatible[i].set(t, dirCount);
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
      var _a;
      for (let i = 0; i < this._FMXxFMY; i++) {
        for (let t = 0; t < this._numColors; t++) {
          this._wave[i][t] = true;
          const compatDirMap = this._compatible[i].get(t);
          for (let d = 0; d < this._basis.numDirections; d++) {
            for (let t2 = 0; t2 < this._numColors; t2++) {
              const t2DirMap = this._propagator.get(t2);
              (_a = t2DirMap.get(this._basis.opposite(d))) == null ? void 0 : _a.forEach((color) => {
                if (color === t) {
                  const compatCount = compatDirMap.get(d);
                  compatDirMap.set(d, compatCount + 1);
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
        for (let d = 0; d < this._basis.numDirections; d++) {
          const dx = this._basis.vector(d)[0];
          const dy = this._basis.vector(d)[1];
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
          const targetColorsForDir = this._propagator.get(e1.color).get(d);
          targetColorsForDir == null ? void 0 : targetColorsForDir.forEach((t2) => {
            const compatibleNeighborEdges = compatibleColors.get(t2);
            const compatCount = compatibleNeighborEdges.get(d);
            compatibleNeighborEdges.set(d, compatCount - 1);
            if (compatibleNeighborEdges.get(d) <= 0) {
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
  var NonOverlappingTileModel = class {
    // imageData - Pixels to use as source image
    // width - Width (in tiles) of the generation
    // height - Height (in tiles) of the generation
    // tileSize - Length N of each NxN square forming the basic unit of the generation
    // isPeriodic - Whether the source image is considered a periodic pattern
    // basis - A Basis object providing the constraining edges for each cell.
    constructor(imageData, width, height, tileSize, isPeriodic, basis) {
      this._generationComplete = false;
      this._FMX = width;
      this._FMY = height;
      this._FMXxFMY = width * height;
      this._tileSize = tileSize;
      this._isPeriodic = isPeriodic;
      this._basis = basis;
      let nextColorID = 0;
      const hexToID = /* @__PURE__ */ new Map();
      for (let i = 0; i < imageData.height; i++) {
        for (let j = 0; j < imageData.width; j++) {
          const r = imageData.data[i * 4 * imageData.width + j * 4 + 0];
          const g = imageData.data[i * 4 * imageData.width + j * 4 + 1];
          const b = imageData.data[i * 4 * imageData.width + j * 4 + 2];
          const a = imageData.data[i * 4 * imageData.width + j * 4 + 3];
          const hex = r | g << 8 | b << 16 | a << 24;
          if (!hexToID.has(hex)) {
            hexToID.set(hex, nextColorID++);
          }
        }
      }
      const numColors = hexToID.size;
      const hexArrayToHash = (colorArr) => {
        let result = 0;
        for (let i = 0; i < colorArr.length; i++) {
          const hex = colorArr[colorArr.length - 1 - i];
          result += hexToID.get(hex) * Math.pow(numColors, i);
        }
        return result;
      };
      const tileHexDataAtPixelOffset = (i, j) => {
        const data = new Array(this._tileSize * this._tileSize);
        let index = 0;
        for (let di = 0; di < this._tileSize; di++) {
          for (let dj = 0; dj < this._tileSize; dj++) {
            const ii = (i + di) % imageData.height;
            const jj = (j + dj) % imageData.width;
            const r = imageData.data[ii * 4 * imageData.width + jj * 4 + 0];
            const g = imageData.data[ii * 4 * imageData.width + jj * 4 + 1];
            const b = imageData.data[ii * 4 * imageData.width + jj * 4 + 2];
            const a = imageData.data[ii * 4 * imageData.width + jj * 4 + 3];
            const hex = r | g << 8 | b << 16 | a << 24;
            data[index] = hex;
            index++;
          }
        }
        return data;
      };
      const tileHexDataToTileData = (hexData) => {
        return {
          data: hexData.map((hex) => {
            return {
              r: hex & 255,
              g: hex >> 8 & 255,
              b: hex >> 16 & 255,
              a: hex >> 24 & 255
            };
          })
        };
      };
      let nextTileID = 0;
      const tileHashToID = /* @__PURE__ */ new Map();
      const tileIDToCount = /* @__PURE__ */ new Map();
      this._tileSet = /* @__PURE__ */ new Map();
      this._propagator = /* @__PURE__ */ new Map();
      const getTileIDForHexData = (tileHexData) => {
        const hash = hexArrayToHash(tileHexData);
        if (!tileHashToID.has(hash)) {
          const tileID2 = nextTileID++;
          tileHashToID.set(hash, tileID2);
          tileIDToCount.set(tileID2, 0);
          const tileData = tileHexDataToTileData(tileHexData);
          this._tileSet.set(tileID2, tileData);
          this._propagator.set(tileID2, /* @__PURE__ */ new Map());
        }
        const tileID = tileHashToID.get(hash);
        return tileID;
      };
      for (let i = 0; i < imageData.height; i += this._tileSize) {
        for (let j = 0; j < imageData.width; j += this._tileSize) {
          const tileHexData = tileHexDataAtPixelOffset(i, j);
          const tileID = getTileIDForHexData(tileHexData);
          tileIDToCount.set(tileID, tileIDToCount.get(tileID) + 1);
          const dirMap = this._propagator.get(tileID);
          for (let d = 0; d < this._basis.numDirections; d++) {
            let ii = i + this._basis.vector(d)[1] * this._tileSize;
            let jj = j + this._basis.vector(d)[0] * this._tileSize;
            if (ii < 0 || ii + this._tileSize > imageData.height) {
              if (this._isPeriodic) {
                ii = (imageData.height + ii) % imageData.height;
              } else {
                continue;
              }
            }
            if (jj < 0 || jj + this._tileSize > imageData.width) {
              if (this._isPeriodic) {
                jj = (imageData.width + jj) % imageData.width;
              } else {
                continue;
              }
            }
            const nTileID = getTileIDForHexData(tileHexDataAtPixelOffset(ii, jj));
            if (!dirMap.has(d)) {
              dirMap.set(d, []);
            }
            const neighborTileIDs = dirMap.get(d);
            if (neighborTileIDs.indexOf(nTileID) === -1) {
              neighborTileIDs.push(nTileID);
            }
          }
        }
      }
      this._numTiles = this._tileSet.size;
      this._weights = [];
      for (let t = 0; t < this._numTiles; t++) {
        const count = tileIDToCount.get(t);
        this._weights.push(count / this._FMXxFMY);
      }
    }
    initialize() {
      debugLog(`initializing wave`);
      this._wave = new Array(this._FMXxFMY);
      this._compatible = new Array(this._FMXxFMY);
      for (let i = 0; i < this._FMXxFMY; i++) {
        this._wave[i] = new Array(this._numTiles);
        this._compatible[i] = /* @__PURE__ */ new Map();
        for (let t = 0; t < this._numTiles; t++) {
          const dirCount = /* @__PURE__ */ new Map();
          for (let d = 0; d < this._basis.numDirections; d++) {
            dirCount.set(d, 0);
          }
          this._compatible[i].set(t, dirCount);
        }
      }
      this._startingEntropy = 0;
      this._weightLogWeights = new Array(this._numTiles);
      for (let t = 0; t < this._numTiles; t++) {
        this._weightLogWeights[t] = this._weights[t] * Math.log(this._weights[t]);
        if (isNaN(this._weightLogWeights[t])) {
          throw new Error("Unexpected NaN");
        }
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
      const N = this._tileSize;
      for (let index = 0; index < this._FMXxFMY; index++) {
        const tileID = this._observed[index];
        const data = this._tileSet.get(tileID).data;
        const i = index / this._FMX | 0;
        const j = index % this._FMX;
        for (let ii = 0; ii < N; ii++) {
          for (let jj = 0; jj < N; jj++) {
            const rgba = data[ii * N + jj];
            array[4 * (i * this._FMX * N * N + j * N + ii * this._FMX * N + jj) + 0] = rgba.r;
            array[4 * (i * this._FMX * N * N + j * N + ii * this._FMX * N + jj) + 1] = rgba.g;
            array[4 * (i * this._FMX * N * N + j * N + ii * this._FMX * N + jj) + 2] = rgba.b;
            array[4 * (i * this._FMX * N * N + j * N + ii * this._FMX * N + jj) + 3] = rgba.a;
          }
        }
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
      var _a;
      for (let i = 0; i < this._FMXxFMY; i++) {
        for (let t = 0; t < this._numTiles; t++) {
          this._wave[i][t] = true;
          const compatDirMap = this._compatible[i].get(t);
          for (let d = 0; d < this._basis.numDirections; d++) {
            for (let t2 = 0; t2 < this._numTiles; t2++) {
              const t2DirMap = this._propagator.get(t2);
              (_a = t2DirMap.get(this._basis.opposite(d))) == null ? void 0 : _a.forEach((tile) => {
                if (tile === t) {
                  const compatCount = compatDirMap.get(d);
                  compatDirMap.set(d, compatCount + 1);
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
    // to a single tile. If no such cell exists, return IterationResult.END_SUCCESS.
    // If we find a contradiction (a cell with no possible tiles), return IterationResult.END_FAILURE.
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
          for (let t = 0; t < this._numTiles; t++) {
            if (this._wave[i][t]) {
              this._observed[i] = t;
              break;
            }
          }
        }
        return 0 /* END_SUCCESS */;
      }
      const distribution = new Array(this._numTiles);
      for (let t = 0; t < this._numTiles; t++) {
        distribution[t] = this._wave[argmin][t] ? this._weights[t] : 0;
      }
      const tileIndex = sampleDiscrete(distribution, rng());
      const w = this._wave[argmin];
      for (let t = 0; t < this._numTiles; t++) {
        if (w[t] !== (t === tileIndex)) {
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
        for (let d = 0; d < this._basis.numDirections; d++) {
          const dx = this._basis.vector(d)[0];
          const dy = this._basis.vector(d)[1];
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
          const compatibleTiles = this._compatible[i2];
          const targetTilesForDir = this._propagator.get(e1.tile).get(d);
          targetTilesForDir == null ? void 0 : targetTilesForDir.forEach((t2) => {
            const compatibleNeighborEdges = compatibleTiles.get(t2);
            const compatCount = compatibleNeighborEdges.get(d);
            compatibleNeighborEdges.set(d, compatCount - 1);
            if (compatibleNeighborEdges.get(d) <= 0) {
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
    // Removes tile with index `t` from the possible tiles for generation cell `i`.
    _ban(i, t) {
      if (this._wave[i][t] === false) {
        return;
      }
      this._wave[i][t] = false;
      this._stack.push({ cellIndex: i, tile: t });
      let entropy = 0;
      for (let t2 = 0; t2 < this._numTiles; t2++) {
        if (this._wave[i][t2]) {
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
  var OverlappingTileModel = class {
    // imageData - Pixels to use as source image
    // width - Width (in tiles) of the generation
    // height - Height (in tiles) of the generation
    // tileSize - Length N of each NxN square forming the basic unit of the generation
    // isPeriodic - Whether the source image is considered a periodic pattern
    // basis - A Basis object providing the constraining edges for each cell.
    constructor(imageData, width, height, tileSize, isPeriodic, basis) {
      this._generationComplete = false;
      this._FMX = width;
      this._FMY = height;
      this._FMXxFMY = width * height;
      this._tileSize = tileSize;
      this._isPeriodic = isPeriodic;
      this._basis = basis;
      let nextColorID = 0;
      const hexToID = /* @__PURE__ */ new Map();
      for (let i = 0; i < imageData.height; i++) {
        for (let j = 0; j < imageData.width; j++) {
          const r = imageData.data[i * 4 * imageData.width + j * 4 + 0];
          const g = imageData.data[i * 4 * imageData.width + j * 4 + 1];
          const b = imageData.data[i * 4 * imageData.width + j * 4 + 2];
          const a = imageData.data[i * 4 * imageData.width + j * 4 + 3];
          const hex = r | g << 8 | b << 16 | a << 24;
          if (!hexToID.has(hex)) {
            hexToID.set(hex, nextColorID++);
          }
        }
      }
      const numColors = hexToID.size;
      const hexArrayToHash = (colorArr) => {
        let result = 0;
        for (let i = 0; i < colorArr.length; i++) {
          const hex = colorArr[colorArr.length - 1 - i];
          result += hexToID.get(hex) * Math.pow(numColors, i);
        }
        return result;
      };
      const tileHexDataAtPixelOffset = (i, j) => {
        const data = new Array(this._tileSize * this._tileSize);
        let index = 0;
        for (let di = 0; di < this._tileSize; di++) {
          for (let dj = 0; dj < this._tileSize; dj++) {
            const ii = (i + di) % imageData.height;
            const jj = (j + dj) % imageData.width;
            const r = imageData.data[ii * 4 * imageData.width + jj * 4 + 0];
            const g = imageData.data[ii * 4 * imageData.width + jj * 4 + 1];
            const b = imageData.data[ii * 4 * imageData.width + jj * 4 + 2];
            const a = imageData.data[ii * 4 * imageData.width + jj * 4 + 3];
            const hex = r | g << 8 | b << 16 | a << 24;
            data[index] = hex;
            index++;
          }
        }
        return data;
      };
      const tileHexDataToTileData = (hexData) => {
        return {
          data: hexData.map((hex) => {
            return {
              r: hex & 255,
              g: hex >> 8 & 255,
              b: hex >> 16 & 255,
              a: hex >> 24 & 255
            };
          })
        };
      };
      let nextTileID = 0;
      const tileHashToID = /* @__PURE__ */ new Map();
      const tileIDToCount = /* @__PURE__ */ new Map();
      this._tileSet = /* @__PURE__ */ new Map();
      this._propagator = /* @__PURE__ */ new Map();
      const getTileIDForHexData = (tileHexData) => {
        const hash = hexArrayToHash(tileHexData);
        if (!tileHashToID.has(hash)) {
          const tileID2 = nextTileID++;
          tileHashToID.set(hash, tileID2);
          tileIDToCount.set(tileID2, 0);
          const tileData = tileHexDataToTileData(tileHexData);
          this._tileSet.set(tileID2, tileData);
          this._propagator.set(tileID2, /* @__PURE__ */ new Map());
        }
        const tileID = tileHashToID.get(hash);
        return tileID;
      };
      for (let i = 0; i < imageData.height; i += 1) {
        for (let j = 0; j < imageData.width; j += 1) {
          const tileHexData = tileHexDataAtPixelOffset(i, j);
          const tileID = getTileIDForHexData(tileHexData);
          tileIDToCount.set(tileID, tileIDToCount.get(tileID) + 1);
          const dirMap = this._propagator.get(tileID);
          for (let d = 0; d < this._basis.numDirections; d++) {
            let ii = i + this._basis.vector(d)[1] * this._tileSize;
            let jj = j + this._basis.vector(d)[0] * this._tileSize;
            if (ii < 0 || ii + this._tileSize > imageData.height) {
              if (this._isPeriodic) {
                ii = (imageData.height + ii) % imageData.height;
              } else {
                continue;
              }
            }
            if (jj < 0 || jj + this._tileSize > imageData.width) {
              if (this._isPeriodic) {
                jj = (imageData.width + jj) % imageData.width;
              } else {
                continue;
              }
            }
            const nTileID = getTileIDForHexData(tileHexDataAtPixelOffset(ii, jj));
            if (!dirMap.has(d)) {
              dirMap.set(d, []);
            }
            const neighborTileIDs = dirMap.get(d);
            if (neighborTileIDs.indexOf(nTileID) === -1) {
              neighborTileIDs.push(nTileID);
            }
          }
        }
      }
      this._numTiles = this._tileSet.size;
      this._weights = [];
      for (let t = 0; t < this._numTiles; t++) {
        const count = tileIDToCount.get(t);
        this._weights.push(count / (imageData.width * imageData.height));
      }
    }
    initialize() {
      debugLog(`initializing wave`);
      this._wave = new Array(this._FMXxFMY);
      this._compatible = new Array(this._FMXxFMY);
      for (let i = 0; i < this._FMXxFMY; i++) {
        this._wave[i] = new Array(this._numTiles);
        this._compatible[i] = /* @__PURE__ */ new Map();
        for (let t = 0; t < this._numTiles; t++) {
          const dirCount = /* @__PURE__ */ new Map();
          for (let d = 0; d < this._basis.numDirections; d++) {
            dirCount.set(d, 0);
          }
          this._compatible[i].set(t, dirCount);
        }
      }
      this._startingEntropy = 0;
      this._weightLogWeights = new Array(this._numTiles);
      for (let t = 0; t < this._numTiles; t++) {
        this._weightLogWeights[t] = this._weights[t] * Math.log(this._weights[t]);
        if (isNaN(this._weightLogWeights[t])) {
          throw new Error("Unexpected NaN");
        }
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
      const N = this._tileSize;
      for (let index = 0; index < this._FMXxFMY; index++) {
        const tileID = this._observed[index];
        const data = this._tileSet.get(tileID).data;
        const i = index / this._FMX | 0;
        const j = index % this._FMX;
        for (let ii = 0; ii < N; ii++) {
          for (let jj = 0; jj < N; jj++) {
            const rgba = data[ii * N + jj];
            array[4 * (i * this._FMX * N * N + j * N + ii * this._FMX * N + jj) + 0] = rgba.r;
            array[4 * (i * this._FMX * N * N + j * N + ii * this._FMX * N + jj) + 1] = rgba.g;
            array[4 * (i * this._FMX * N * N + j * N + ii * this._FMX * N + jj) + 2] = rgba.b;
            array[4 * (i * this._FMX * N * N + j * N + ii * this._FMX * N + jj) + 3] = rgba.a;
          }
        }
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
      var _a;
      for (let i = 0; i < this._FMXxFMY; i++) {
        for (let t = 0; t < this._numTiles; t++) {
          this._wave[i][t] = true;
          const compatDirMap = this._compatible[i].get(t);
          for (let d = 0; d < this._basis.numDirections; d++) {
            for (let t2 = 0; t2 < this._numTiles; t2++) {
              const t2DirMap = this._propagator.get(t2);
              (_a = t2DirMap.get(this._basis.opposite(d))) == null ? void 0 : _a.forEach((tile) => {
                if (tile === t) {
                  const compatCount = compatDirMap.get(d);
                  compatDirMap.set(d, compatCount + 1);
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
    // to a single tile. If no such cell exists, return IterationResult.END_SUCCESS.
    // If we find a contradiction (a cell with no possible tiles), return IterationResult.END_FAILURE.
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
          for (let t = 0; t < this._numTiles; t++) {
            if (this._wave[i][t]) {
              this._observed[i] = t;
              break;
            }
          }
        }
        return 0 /* END_SUCCESS */;
      }
      const distribution = new Array(this._numTiles);
      for (let t = 0; t < this._numTiles; t++) {
        distribution[t] = this._wave[argmin][t] ? this._weights[t] : 0;
      }
      const tileIndex = sampleDiscrete(distribution, rng());
      const w = this._wave[argmin];
      for (let t = 0; t < this._numTiles; t++) {
        if (w[t] !== (t === tileIndex)) {
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
        for (let d = 0; d < this._basis.numDirections; d++) {
          const dx = this._basis.vector(d)[0];
          const dy = this._basis.vector(d)[1];
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
          const compatibleTiles = this._compatible[i2];
          const targetTilesForDir = this._propagator.get(e1.tile).get(d);
          targetTilesForDir == null ? void 0 : targetTilesForDir.forEach((t2) => {
            const compatibleNeighborEdges = compatibleTiles.get(t2);
            const compatCount = compatibleNeighborEdges.get(d);
            compatibleNeighborEdges.set(d, compatCount - 1);
            if (compatibleNeighborEdges.get(d) <= 0) {
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
    // Removes tile with index `t` from the possible tiles for generation cell `i`.
    _ban(i, t) {
      if (this._wave[i][t] === false) {
        return;
      }
      this._wave[i][t] = false;
      this._stack.push({ cellIndex: i, tile: t });
      let entropy = 0;
      for (let t2 = 0; t2 < this._numTiles; t2++) {
        if (this._wave[i][t2]) {
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
  var DEBUG_LOG = true;
  function debugLog(...args) {
    if (DEBUG_LOG) {
      console.log.apply(this, args);
    }
  }

  // index.ts
  var inputCanvas = document.getElementById("input-canvas");
  var outputPeriodic = document.getElementById("output-control-periodic");
  var outputBasis = document.getElementById("output-control-basis");
  var outputModel = document.getElementById("output-control-model");
  var outputTileSize = document.getElementById("output-control-tile-size");
  function generate() {
    const outputCanvas = document.getElementById("output-canvas");
    const inputCtx = inputCanvas.getContext("2d");
    const imageData = inputCtx.getImageData(0, 0, inputCanvas.width, inputCanvas.height);
    const outputBasisName = outputBasis.value;
    const outputModelName = outputModel.value;
    const outputIsPeriodic = outputPeriodic.checked;
    const modelBasis = outputBasisName === "cardinal" ? CardinalBasis : CardinalBasisWithDiagonals;
    let tileSize = Number.parseInt(outputTileSize.value);
    let model = null;
    if (outputModelName === "simple-pixel-model") {
      model = new SimplePixelModel(imageData, outputCanvas.width, outputCanvas.height, outputIsPeriodic, modelBasis);
    } else if (outputModelName === "overlapping-tile-model") {
      model = new OverlappingTileModel(imageData, Math.ceil(outputCanvas.width / tileSize), Math.ceil(outputCanvas.height / tileSize), tileSize, outputIsPeriodic, modelBasis);
    } else {
      while (inputCanvas.width % tileSize !== 0 || inputCanvas.height % tileSize !== 0) {
        tileSize--;
      }
      model = new NonOverlappingTileModel(imageData, Math.ceil(outputCanvas.width / tileSize), Math.ceil(outputCanvas.height / tileSize), tileSize, outputIsPeriodic, modelBasis);
    }
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
  outputModel == null ? void 0 : outputModel.addEventListener("change", (e) => {
    var _a;
    const value = (_a = e == null ? void 0 : e.target) == null ? void 0 : _a.value;
    if (value === "overlapping-tile-model" || value === "non-overlapping-tile-model") {
      outputTileSize.disabled = false;
    } else {
      outputTileSize.disabled = true;
    }
  });
})();
//# sourceMappingURL=index.js.map

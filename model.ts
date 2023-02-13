enum IterationResult {
  END_SUCCESS,
  END_FAILURE,
  ONGOING
}

enum Dir {
  RIGHT,
  DOWN,
  LEFT,
  UP
}

const DirVectors: Record<Dir, number[]> = {
  [Dir.RIGHT]: [1, 0],
  [Dir.DOWN]: [0, 1],
  [Dir.LEFT]: [-1, 0],
  [Dir.UP]: [0, -1],
}
const Opposite: Record<Dir, Dir> = {
  [Dir.RIGHT]: Dir.LEFT,
  [Dir.DOWN]: Dir.UP,
  [Dir.LEFT]: Dir.RIGHT,
  [Dir.UP]: Dir.DOWN,
}

type Color = number
type ColorMap = Map<Color, Record<Dir, Color[]>>

type PixelState = boolean[]

export class SimplePixelModel {
  private _generationComplete: boolean = false

  private _FMX: number
  private _FMY: number
  private _FMXxFMY: number

  private _isPeriodic: boolean

  // Array with dimensions of the output, each element represents the state
  // of a pixel in the output. Each state is a superposition of colors of the
  // input with boolean coefficients. `false` means the color is forbidden,
  // `true` means the color is not yet forbidden.
  private _wave: PixelState[] | null

  // Directed graph of sourceColor --(direction)--> targetColor.
  private _propagator: ColorMap
  // Stores a map of (possible color --(direction)--> number of neighbor edges allowing that color) for every generation cell.
  // Neighbor edges are deleted as we observe neighbor colors + collapse neighbor states. When the number of neighbor
  // edges compatible with a given color reach zero for any direction, that color is no longer possible for the
  // generation cell.
  private _compatible: (Map<Color, Record<Dir, number>>)[]
  // Number of possible colors.
  private _numColors: number
  // Map of color IDs to color objects
  private _colorRGBA: Map<number, {r: number, g: number, b: number, a: number}>

  // WlogW for the given color with weight W, 1 per color
  private _weightLogWeights: number[]
  // prior probabilities of colors, 1 per color
  private _weights: number[]
  private _startingEntropy: number
  // entropies of generation cells, 1 per cell
  private _entropies: number[]

  // Final observed colors, 1 per generation cell.
  // Only set after generation completes.
  private _observed: number[]

  // Stack of (cellIndex, color) pairs banned during iterations, used for backtracking and propagation
  private _stack: {cellIndex: number; color: number}[]

  // imageData - Pixels to use as source image
  // width - Width of the generation
  // height - Height of the generation
  // isPeriodic - Whether the source image is considered a periodic pattern
  constructor(imageData: ImageData, width: number, height: number, isPeriodic: boolean) {
    this._FMX = width
    this._FMY = height
    this._FMXxFMY = width * height

    this._isPeriodic = isPeriodic

    const hexMap = new Map<Color, Record<Dir, Set<Color>>>()
    const hexCount = new Map<Color, number>()
    for (let i = 0; i < imageData.height; i++) {
      for (let j = 0; j < imageData.width; j++) {
        const r = imageData.data[i*4*imageData.width + j*4 + 0]
        const g = imageData.data[i*4*imageData.width + j*4 + 1]
        const b = imageData.data[i*4*imageData.width + j*4 + 2]
        const a = imageData.data[i*4*imageData.width + j*4 + 3]
        const hex = r | (g << 8) | (b << 16) | (a << 24)
        if (!hexCount.has(hex)) {
          hexCount.set(hex, 0)
        }
        hexCount.set(hex, hexCount.get(hex)! + 1)
        if (!hexMap.has(hex)) {
          hexMap.set(hex, {
            [Dir.RIGHT]: new Set(),
            [Dir.DOWN]: new Set(),
            [Dir.LEFT]: new Set(),
            [Dir.UP]: new Set(),
          })
        }
        const dirMap = hexMap.get(hex)!
        for (let d = Dir.RIGHT; d <= Dir.UP; d++) {
          let ii = i + DirVectors[d][1]
          let jj = j + DirVectors[d][0]
          if (ii < 0 || ii >= imageData.height) {
            if (this._isPeriodic) {
              ii = (imageData.height + ii) % imageData.height
            } else {
              continue
            }
          }
          if (jj < 0 || jj >= imageData.width) {
            if (this._isPeriodic) {
              jj = (imageData.width + jj) % imageData.width
            } else {
              continue
            }
          }
          const nR = imageData.data[ii*4*imageData.width + jj*4 + 0]
          const nG = imageData.data[ii*4*imageData.width + jj*4 + 1]
          const nB = imageData.data[ii*4*imageData.width + jj*4 + 2]
          const nA = imageData.data[ii*4*imageData.width + jj*4 + 3]
          const nHex = nR | (nG << 8) | (nB << 16) | (nA << 24)

          dirMap[d].add(nHex)
        }
      }
    }
    this._colorRGBA = new Map()
    const hexToID = new Map<number, number>()
    let colorID = 0
    hexMap.forEach((_, hex) => {
      const r = (hex >> 0) & 0xFF
      const g = (hex >> 8) & 0xFF
      const b = (hex >> 16) & 0xFF
      const a = (hex >> 24) & 0xFF
      this._colorRGBA.set(colorID, {r, g, b, a})
      hexToID.set(hex, colorID)
      colorID++
    })
    this._propagator = new Map()
    hexMap.forEach((dirMapHex, hex) => {
      const dirMapIDs: Record<Dir, Color[]> = {
        [Dir.RIGHT]: Array.from(dirMapHex[Dir.RIGHT].values()).map<number>((nHex) => hexToID.get(nHex)!),
        [Dir.DOWN]: Array.from(dirMapHex[Dir.DOWN].values()).map<number>((nHex) => hexToID.get(nHex)!),
        [Dir.LEFT]: Array.from(dirMapHex[Dir.LEFT].values()).map<number>((nHex) => hexToID.get(nHex)!),
        [Dir.UP]: Array.from(dirMapHex[Dir.UP].values()).map<number>((nHex) => hexToID.get(nHex)!),
      }
      this._propagator.set(hexToID.get(hex)!, dirMapIDs)
    })

    this._numColors = this._propagator.size
    // In original WFC SimpleTiledModel, the input data is made much smaller by
    // allowing multiple tiles to be specified using a single tile entry with
    // symmetry and rotation labels. In SimplePixelModel, tiles are pixels
    // and therefore are already unique up to reflection and rotation.
    // Input data are also given as a directed graph.
    this._weights = []
    for (let t = 0; t < this._numColors; t++) {
      const rgba = this._colorRGBA.get(t)!
      const hex = rgba.r | (rgba.g << 8) | (rgba.b << 16) | (rgba.a << 24)
      const count = hexCount.get(hex)!
      this._weights.push(count / this._FMXxFMY)
    }
  }

  initialize() {
    debugLog(`initializing wave`)
    this._wave = new Array(this._FMXxFMY)
    this._compatible = new Array(this._FMXxFMY)
    for (let i = 0; i < this._FMXxFMY; i++) {
      this._wave[i] = new Array(this._numColors)
      this._compatible[i] = new Map()
      for (let t = 0; t < this._numColors; t++) {
        this._compatible[i].set(t, {
          [Dir.RIGHT]: 0,
          [Dir.DOWN]: 0,
          [Dir.LEFT]: 0,
          [Dir.UP]: 0
        })
      }
    }

    this._startingEntropy = 0
    this._weightLogWeights = new Array(this._numColors)
    for (let t = 0; t < this._numColors; t++) {
      this._weightLogWeights[t] = this._weights[t] * Math.log(this._weights[t])
      this._startingEntropy -= this._weightLogWeights[t]
    }

    this._entropies = new Array(this._FMXxFMY)
    this._stack = []
    debugLog(`init done`, JSON.stringify(this))
  }

  putGeneratedData(array: Uint8ClampedArray) {
    if (!this._generationComplete) {
      console.error("Cannot putGeneratedData when generation incomplete")
      return
    }
    for (let i = 0; i < this._FMXxFMY; i++) {
      const colorID = this._observed[i]
      const rgba = this._colorRGBA.get(colorID)!
      array[4*i + 0] = rgba.r;
      array[4*i + 1] = rgba.g;
      array[4*i + 2] = rgba.b;
      array[4*i + 3] = rgba.a;
    }
  }

  // Execute a full new generation
  // rng - Random number generator function
  // Returns true iff generation succeeded.
  generate(rng?: () => number): boolean {
    if (!this._wave) {
      this.initialize()
    }
    rng = rng || Math.random
    debugLog(`[generate] clearing`)
    this.clear()
    let i = 0
    while (true) {
      debugLog(`[generate] iterate ${i}...`)
      const result = this.iterate(rng)
      if (result !== IterationResult.ONGOING) {
        debugLog(`[generate] iterations completed with result ${IterationResult[result]}`)
        return result === IterationResult.END_SUCCESS
      }
      i++
    }
  }

  iterate(rng: () => number): IterationResult {
    if (!this._wave) {
      this.initialize()
    }
    debugLog(`[iterate] observe`)
    const result = this._observe(rng)
    if (result !== IterationResult.ONGOING) {
      this._generationComplete = result === IterationResult.END_SUCCESS
      return result
    }
    debugLog(`[iterate] propagate`)
    this._propagate()
    return IterationResult.ONGOING
  }

  isGenerationComplete(): boolean {
    return this._generationComplete
  }

  clear() {
    for (let i = 0; i < this._FMXxFMY; i++) {
      for (let t = 0; t < this._numColors; t++) {
        this._wave![i][t] = true

        // Re-initialize the constraint edge graph `_compatible`.
        // Every cell in `_compatible` is reset to have all possible neighbor
        // colors in every direction.
        for (let d = Dir.RIGHT; d <= Dir.UP; d++) {
          // TODO: original WFC implementation seems to do something different to initialize `compatible`?
          for (let t2 = 0; t2 < this._numColors; t2++) {
            this._propagator.get(t2)![Opposite[d]].forEach(color => {
              if (color === t) {
                this._compatible[i].get(t)![d]++
              }
            })
          }
        }
      }

      this._entropies[i] = this._startingEntropy
    }
    this._generationComplete = false
    debugLog(`clear done`, JSON.stringify(this))
  }

  // Find cell with minimum non-zero entropy and collapse its wavefunction by setting it
  // to a single color. If no such cell exists, return IterationResult.END_SUCCESS.
  // If we find a contradiction (a cell with no possible colors), return IterationResult.END_FAILURE.
  // Else return IterationResult.ONGOING.
  private _observe(rng: () => number): IterationResult {
    let min = Infinity
    let argmin = -1

    // 1. Find cell with minimum non-zero entropy
    for (let i = 0; i < this._FMXxFMY; i++) {
      if (this._onBoundary(i % this._FMX, i / this._FMX | 0)) {
        continue
      }

      let numChoices = 0
      this._wave![i].forEach((isPossible) => {
        if (isPossible) {
          numChoices++
        }
      })
      if (numChoices === 0) {
        debugLog("[observe] found cell with 0 choices")
        return IterationResult.END_FAILURE
      }

      const entropy = this._entropies[i]
      if (numChoices > 1 && entropy <= min) {
        const noise = 1e-6 * rng()
        if (entropy + noise < min) {
          min = entropy + noise
          argmin = i
        }
      }
    }

    if (argmin === -1) {
      // No cell with non-zero entropy was found, which means
      // all cells only have 1 possible choice. All states
      // have been observed.
      this._observed = new Array(this._FMXxFMY)

      for (let i = 0; i < this._FMXxFMY; i++) {
        for (let t = 0; t < this._numColors; t++) {
          if (this._wave![i][t]) {
            this._observed[i] = t
            break
          }
        }
      }

      return IterationResult.END_SUCCESS
    }

    // 2. Collapse minimum cell wave function by sampling a color from its distribution
    const distribution = new Array(this._numColors)
    for (let t = 0; t < this._numColors; t++) {
      distribution[t] = this._wave![argmin][t] ? this._weights[t] : 0
    }

    const colorIndex = sampleDiscrete(distribution, rng())
    const w = this._wave![argmin]
    for (let t = 0; t < this._numColors; t++) {
      if (w[t] !== (t === colorIndex)) {
        this._ban(argmin, t)
      }
    }

    return IterationResult.ONGOING
  }

  // Propagate constraints affected by the observed cell through the wave.
  private _propagate() {
    while (this._stack.length > 0) {
      const e1 = this._stack.pop()!

      const i1 = e1.cellIndex
      const x1 = i1 % this._FMX
      const y1 = (i1 / this._FMX) | 0

      for (let d = Dir.RIGHT; d <= Dir.UP; d++) {
        const dx = DirVectors[d][0]
        const dy = DirVectors[d][1]

        let x2 = x1 + dx
        let y2 = y1 + dy

        if (this._onBoundary(x2, y2)) {
          continue
        }

        // `_onBoundary` returns false for periodic functions,
        // handle those here
        if (x2 < 0) {
          x2 += this._FMX
        } else if (x2 >= this._FMX) {
          x2 -= this._FMX
        }
        if (y2 < 0) {
          y2 += this._FMY
        } else if (y2 >= this._FMY) {
          y2 -= this._FMY
        }

        // ban possible colors for this neighbor that now have zero compatibilities
        const i2 = x2 + y2 * this._FMX
        const compatibleColors = this._compatible[i2]
        const targetColorsForDir = this._propagator.get(e1.color)![d]
        targetColorsForDir.forEach(t2 => {
          const compatibleNeighborEdges = compatibleColors.get(t2)
          compatibleNeighborEdges![d]--
          if (compatibleNeighborEdges![d] <= 0) {
            this._ban(i2, t2)
          }
        })
      }
    }
  }

  // Returns whether given x and y coordinates are on the boundary of generation.
  private _onBoundary(x: number, y: number): boolean {
    return !this._isPeriodic && (x < 0 || y < 0 || x >= this._FMX || y >= this._FMY)
  }

  // Removes color with index `t` from the possible colors for generation cell `i`.
  private _ban(i: number, t: number) {
    if (this._wave![i][t] === false) {
      return
    }
    this._wave![i][t] = false
    this._stack.push({cellIndex: i, color: t})

    // TODO: avoid C calls to `ban` resulting in C^2 computations
    let entropy = 0
    for (let c = 0; c < this._numColors; c++) {
      if (this._wave![i][c]) {
        entropy -= this._weightLogWeights[i]
      }
    }
    this._entropies[i] = entropy
  }

  // for debugging only
  countPossibilities(): number {
    let n = 0
    if (!this._wave) {
      return n
    }
    this._wave.forEach((choices) => {
      choices.forEach((choice) => {
        if (choice) {
          n++
        }
      })
    })
    return n
  }

}

// Sample an index from a discrete probability distribution.
// `weights` are probability masses of each index, `r` is
// a number between 0 and 1 (sampler)
function sampleDiscrete(weights: number[], r: number) {
  let sum = 0
  let x = 0

  for (let i = 0; i < weights.length; i++) {
    sum += weights[i]
  }

  let i = 0
  r *= sum

  // TODO: binary search instead?
  while (r && i < weights.length) {
    x += weights[i]
    if (r <= x) {
      return i
    }
    i++
  }
  return 0
}

const DEBUG_LOG = false
function debugLog(...args: any[]) {
  if (DEBUG_LOG) {
    console.log(arguments)
  }
}
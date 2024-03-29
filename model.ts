enum IterationResult {
  END_SUCCESS,
  END_FAILURE,
  ONGOING
}

type DirectionID = number
interface Basis {
  // Gives the number of directions that this basis defines.
  // If the number of directions is N, then this basis
  // defines a direction for every integer from 0 (inclusive)
  // until N (exclusive). These integers are the `DirectionID`s.
  //
  // The direction vectors can be accessed using the `vector`
  // method for every direction ID vector(0)... vector(N).
  readonly numDirections: number
  vector(i: DirectionID): number[]
  opposite(i: DirectionID): DirectionID
}

export const CardinalBasis: Basis = {
  numDirections: 4,
  vector: (i) => {
    switch (i) {
      case 0: {
        return [1, 0]
      }
      case 1: {
        return [0, 1]
      }
      case 2: {
        return [-1, 0]
      }
      case 3: {
        return [0, -1]
      }
    }
    throw new Error(`Unhandled direction ${i} for cardinal basis`)
  },
  opposite: (i) => {
    switch (i) {
      case 0: {
        return 2 as DirectionID
      }
      case 1: {
        return 3 as DirectionID
      }
      case 2: {
        return 0 as DirectionID
      }
      case 3: {
        return 1 as DirectionID
      }
    }
    throw new Error(`Unhandled direction ${i} for cardinal basis`)
  }
}

export const CardinalBasisWithDiagonals: Basis = {
  numDirections: 8,
  vector: (i) => {
    switch (i) {
      case 0: {
        return [1, 0]
      }
      case 1: {
        return [0, 1]
      }
      case 2: {
        return [-1, 0]
      }
      case 3: {
        return [0, -1]
      }
      case 4: {
        return [1, 1]
      }
      case 5: {
        return [1, -1]
      }
      case 6: {
        return [-1, -1]
      }
      case 7: {
        return [-1, 1]
      }
    }
    throw new Error(`Unhandled direction ${i} for cardinal basis`)
  },
  opposite: (i) => {
    switch (i) {
      case 0: {
        return 2 as DirectionID
      }
      case 1: {
        return 3 as DirectionID
      }
      case 2: {
        return 0 as DirectionID
      }
      case 3: {
        return 1 as DirectionID
      }
      case 4: {
        return 6 as DirectionID
      }
      case 5: {
        return 7 as DirectionID
      }
      case 6: {
        return 4 as DirectionID
      }
      case 7: {
        return 5 as DirectionID
      }
    }
    throw new Error(`Unhandled direction ${i} for cardinal basis with diagonals`)
  }
}

type ColorHex = number
type ColorID = number
type ColorMap = Map<ColorID, Map<DirectionID, ColorID[]>>
type Color = {r: number, g: number, b: number, a: number}

type PixelState = boolean[]

export class SimplePixelModel {
  private _generationComplete: boolean = false

  private _FMX: number
  private _FMY: number
  private _FMXxFMY: number

  private _isPeriodic: boolean
  private _basis: Basis

  // Array with dimensions of the output, each element represents the state
  // of a pixel in the output. Each state is a superposition of colors of the
  // input with boolean coefficients. `false` means the color is forbidden,
  // `true` means the color is not yet forbidden.
  private _wave: PixelState[] | null

  // Directed graph of sourceColor --(direction)--> [list of possible targetColors].
  private _propagator: ColorMap
  // Stores a map of (possible color --(direction)--> number of neighbor edges allowing that color) for every generation cell.
  // Neighbor edges are deleted as we observe neighbor colors + collapse neighbor states. When the number of neighbor
  // edges compatible with a given color reach zero for any direction, that color is no longer possible for the
  // generation cell.
  private _compatible: (Map<ColorID, Map<DirectionID, number>>)[]
  // Number of possible colors.
  private _numColors: number
  // Map of color IDs to color objects
  private _colorRGBA: Map<number, Color>

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
  // basis - A Basis object providing the constraining edges for each cell.
  constructor(imageData: ImageData, width: number, height: number, isPeriodic: boolean, basis: Basis) {
    this._FMX = width
    this._FMY = height
    this._FMXxFMY = width * height

    this._isPeriodic = isPeriodic
    this._basis = basis

    const hexMap = new Map<ColorHex, Map<DirectionID, Set<ColorHex>>>()
    const hexCount = new Map<ColorHex, number>()
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
          hexMap.set(hex, new Map())
        }
        const dirMap = hexMap.get(hex)!
        for (let d = 0; d < this._basis.numDirections; d++) {
          let ii = i + this._basis.vector(d)[1]
          let jj = j + this._basis.vector(d)[0]
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

          if (!dirMap.has(d)) {
            dirMap.set(d, new Set())
          }
          dirMap.get(d)!.add(nHex)
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
      const dirMapIDs: Map<DirectionID, ColorID[]> = new Map()
      for (let d = 0; d < this._basis.numDirections; d++) {
        dirMapIDs.set(d, Array.from(dirMapHex.get(d)!.values()).map<number>((nHex) => hexToID.get(nHex)!))
      }
      this._propagator.set(hexToID.get(hex)!, dirMapIDs)
    })

    this._numColors = this._propagator.size
    // In original WFC SimpleTiledModel, the input data is made much smaller by
    // allowing multiple tiles to be specified using a single tile entry with
    // symmetry and rotation labels. In SimplePixelModel, tiles are pixels
    // and therefore are already unique up to reflection and rotation.
    // Input data are also given as a source image rather than a tileset
    // with explicit edges.
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
        const dirCount: Map<DirectionID, number> = new Map()
        for (let d = 0; d < this._basis.numDirections; d++) {
          dirCount.set(d, 0)
        }
        this._compatible[i].set(t, dirCount)
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
        const compatDirMap = this._compatible[i].get(t)! // Map of directionID -> refcount of incoming edges
        for (let d = 0; d < this._basis.numDirections; d++) {
          // TODO: original WFC implementation seems to do something different to initialize `compatible`?
          for (let t2 = 0; t2 < this._numColors; t2++) {
            const t2DirMap = this._propagator.get(t2)! // Map of directionID -> [list of possible colors]
            t2DirMap.get(this._basis.opposite(d))?.forEach(color => {
              if (color === t) {
                const compatCount = compatDirMap.get(d)!
                compatDirMap.set(d, compatCount + 1)
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

      for (let d = 0; d < this._basis.numDirections; d++) {
        const dx = this._basis.vector(d)[0]
        const dy = this._basis.vector(d)[1]

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
        const targetColorsForDir = this._propagator.get(e1.color)!.get(d)
        targetColorsForDir?.forEach(t2 => {
          const compatibleNeighborEdges = compatibleColors.get(t2)!
          const compatCount = compatibleNeighborEdges.get(d)!
          compatibleNeighborEdges.set(d, compatCount - 1)
          if (compatibleNeighborEdges.get(d)! <= 0) {
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

interface TileData {
  // NxN array of RGBA pixels.
  // Pixels are stored in row-major order, e.g.
  // `data[i*N + j]` returns the pixel `i` rows from the top and `j` columns from the left.
  data: Color[]
}

type TileID = number
type TileMap = Map<TileID, Map<DirectionID, TileID[]>>

// NonOverlappingTileModel
//
// This model interprets the input image as a grid of non-overlapping tiles where
// each tile is a `tileWidth` x `tileWidth` square of pixels. The output is similarly
// constrained so that an output tile can only have a neighboring tile in a given direction
// if there also exists the same tile with the same neighbor in the same direction
// in the input image.
//
// `SimplePixelModel` can be interpreted as equivalent to a `NonOverlappingTileModel` with a
// `tileWidth` of 1.
export class NonOverlappingTileModel {
  private _generationComplete: boolean = false

  private _FMX: number
  private _FMY: number
  private _FMXxFMY: number

  private _isPeriodic: boolean
  private _basis: Basis

  // Array with dimensions of the output, each element represents the state
  // of a tile in the output. Each state is a superposition of tiles of the
  // input with boolean coefficients. `false` means the tile is forbidden,
  // `true` means the tile is not yet forbidden.
  private _wave: PixelState[] | null

  // Directed graph of sourceTile --(direction)--> [list of possible target tiles].
  private _propagator: TileMap
  // Stores a map of (possible tile --(direction)--> number of neighbor edges allowing that tile) for every generation cell.
  // Neighbor edges are deleted as we observe neighbor tiles + collapse neighbor states. When the number of neighbor
  // edges compatible with a given tile reach zero for any direction, that tile is no longer possible for the
  // generation cell.
  private _compatible: (Map<TileID, Map<DirectionID, number>>)[]
  // Number of possible tiles.
  private _numTiles: number
  // Length N of each NxN tile. All tiles in our tileset are size NxN, N>=1.
  private _tileSize: number
  // Map of tile IDs to tile data objects
  private _tileSet: Map<number, TileData>

  // WlogW for the given tile with weight W, 1 per tile
  private _weightLogWeights: number[]
  // prior probabilities of tiles, 1 per tile
  private _weights: number[]
  private _startingEntropy: number
  // entropies of generation cells, 1 per cell
  private _entropies: number[]

  // Final observed tiles, 1 per generation cell.
  // Only set after generation completes.
  private _observed: TileID[]

  // Stack of (cellIndex, tile) pairs banned during iterations, used for backtracking and propagation
  private _stack: {cellIndex: number; tile: TileID}[]

  // imageData - Pixels to use as source image
  // width - Width (in tiles) of the generation
  // height - Height (in tiles) of the generation
  // tileSize - Length N of each NxN square forming the basic unit of the generation
  // isPeriodic - Whether the source image is considered a periodic pattern
  // basis - A Basis object providing the constraining edges for each cell.
  constructor(imageData: ImageData, width: number, height: number, tileSize: number, isPeriodic: boolean, basis: Basis) {
    this._FMX = width
    this._FMY = height
    this._FMXxFMY = width * height

    this._tileSize = tileSize
    this._isPeriodic = isPeriodic
    this._basis = basis

    // 1. Count number of unique colors in source image and assign each an ID
    let nextColorID = 0
    const hexToID = new Map<ColorHex, number>()
    for (let i = 0; i < imageData.height; i++) {
      for (let j = 0; j < imageData.width; j++) {
        const r = imageData.data[i*4*imageData.width + j*4 + 0]
        const g = imageData.data[i*4*imageData.width + j*4 + 1]
        const b = imageData.data[i*4*imageData.width + j*4 + 2]
        const a = imageData.data[i*4*imageData.width + j*4 + 3]
        const hex = r | (g << 8) | (b << 16) | (a << 24)
        if (!hexToID.has(hex)) {
          hexToID.set(hex, nextColorID++)
        }
      }
    }
    const numColors = hexToID.size
    // 2. Get all unique tiles in source image, assign each an ID, and
    // construct a directed graph of unique tile IDs to possible neighbor
    // tile IDs
    const hexArrayToHash = (colorArr: ColorHex[]): number  => {
      // "Hash" each array of C colors by treating each color as a digit and computing the number.
      let result = 0
      for (let i = 0; i < colorArr.length; i++) {
        const hex = colorArr[colorArr.length - 1 - i]
        result += hexToID.get(hex)! * Math.pow(numColors, i)
      }
      return result
    }
    const tileHexDataAtPixelOffset = (i: number, j: number): ColorHex[] => {
      // Get a 1-dimensional array of NxN hex colors corresponding to the NxN tile at
      // pixel offset i,j in the source image.
      const data = new Array(this._tileSize * this._tileSize)
      let index = 0
      for (let di = 0; di < this._tileSize; di++) {
        for (let dj = 0; dj < this._tileSize; dj++) {
          const ii = (i + di) % imageData.height
          const jj = (j + dj) % imageData.width
          const r = imageData.data[ii*4*imageData.width + jj*4 + 0]
          const g = imageData.data[ii*4*imageData.width + jj*4 + 1]
          const b = imageData.data[ii*4*imageData.width + jj*4 + 2]
          const a = imageData.data[ii*4*imageData.width + jj*4 + 3]
          const hex = r | (g << 8) | (b << 16) | (a << 24)
          data[index] = hex
          index++
        }
      }
      return data
    }
    const tileHexDataToTileData = (hexData: ColorHex[]): TileData => {
      // TODO: We shouldn't need to do so much conversion between hex and RGBA format.
      // Should be able to simplify this code a bunch if we make `_tileSet` use
      // tile data with pixels in hex format.
      return {
        data: hexData.map<Color>(hex => {
            return {
            r: hex & 0xFF,
            g: (hex >> 8) & 0xFF,
            b: (hex >> 16) & 0xFF,
            a: (hex >> 24) & 0xFF,
          }
        })
      }
    }
    let nextTileID = 0
    const tileHashToID = new Map<number, TileID>()
    const tileIDToCount = new Map<TileID, number>()
    this._tileSet = new Map()
    this._propagator = new Map()

    const getTileIDForHexData = (tileHexData: ColorHex[]): TileID => {
      // If tile with the given hex data already exists, return its ID.
      // Else insert it into tileset and give it a new tile ID.
      const hash = hexArrayToHash(tileHexData)
      if (!tileHashToID.has(hash)) {
        const tileID = nextTileID++
        tileHashToID.set(hash, tileID)
        tileIDToCount.set(tileID, 0)
        const tileData = tileHexDataToTileData(tileHexData)
        this._tileSet.set(tileID, tileData)
        this._propagator.set(tileID, new Map())
      }
      const tileID = tileHashToID.get(hash)!
      return tileID
    }

    for (let i = 0; i < imageData.height; i += this._tileSize) {
      for (let j = 0; j < imageData.width; j += this._tileSize) {
        const tileHexData = tileHexDataAtPixelOffset(i, j)
        const tileID = getTileIDForHexData(tileHexData)
        tileIDToCount.set(tileID, tileIDToCount.get(tileID)! + 1)
        const dirMap = this._propagator.get(tileID)!
        for (let d = 0; d < this._basis.numDirections; d++) {
          let ii = i + this._basis.vector(d)[1] * this._tileSize
          let jj = j + this._basis.vector(d)[0] * this._tileSize
          if (ii < 0 || ii + this._tileSize > imageData.height) {
            if (this._isPeriodic) {
              ii = (imageData.height + ii) % imageData.height
            } else {
              continue
            }
          }
          if (jj < 0 || jj + this._tileSize > imageData.width) {
            if (this._isPeriodic) {
              jj = (imageData.width + jj) % imageData.width
            } else {
              continue
            }
          }
          const nTileID = getTileIDForHexData(tileHexDataAtPixelOffset(ii, jj))

          if (!dirMap.has(d)) {
            dirMap.set(d, [])
          }
          const neighborTileIDs = dirMap.get(d)!
          if (neighborTileIDs.indexOf(nTileID) === -1) {
            neighborTileIDs.push(nTileID)
          }
        }
      }
    }

    this._numTiles = this._tileSet.size
    this._weights = []
    for (let t = 0; t < this._numTiles; t++) {
      const count = tileIDToCount.get(t)!
      this._weights.push(count / this._FMXxFMY)
    }
  }

  initialize() {
    debugLog(`initializing wave`)
    this._wave = new Array(this._FMXxFMY)
    this._compatible = new Array(this._FMXxFMY)
    for (let i = 0; i < this._FMXxFMY; i++) {
      this._wave[i] = new Array(this._numTiles)
      this._compatible[i] = new Map()
      for (let t = 0; t < this._numTiles; t++) {
        const dirCount: Map<DirectionID, number> = new Map()
        for (let d = 0; d < this._basis.numDirections; d++) {
          dirCount.set(d, 0)
        }
        this._compatible[i].set(t, dirCount)
      }
    }

    this._startingEntropy = 0
    this._weightLogWeights = new Array(this._numTiles)
    for (let t = 0; t < this._numTiles; t++) {
      this._weightLogWeights[t] = this._weights[t] * Math.log(this._weights[t])
      if (isNaN(this._weightLogWeights[t])) {
        throw new Error("Unexpected NaN")
      }
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
    const N = this._tileSize
    for (let index = 0; index < this._FMXxFMY; index++) {
      const tileID = this._observed[index]
      const data = this._tileSet.get(tileID)!.data
      const i = (index / this._FMX) | 0
      const j = index % this._FMX
      for (let ii = 0; ii < N; ii++) {
        for (let jj = 0; jj < N; jj++) {
          //  FMX tiles, or FMX*N pixels
          //  -------------------------
          //
          //  N=4 pixels
          //  ----
          // |+---+---+---+---+---+---+        |
          // ||   |   |   |   |   |   |        |
          // ||   |   |   |   |   |   |        |
          // ||   |   |   |   |   |   |        |
          //  +---+---+---+---+---+---+        | -> i=2 tile heights, 2*N*FMX pixels in row major order
          //  |   |   |   |   |   |   |        |
          //  |   |   |   |   |   |   |        |
          //  |   |   |   |   |   |   |        |
          //  +---+---XXXX+---+---+---+ -------*
          //  |   |   XXXX|   |   |   |
          //  |   |   XXXX|   |   |   |
          //  |   |   XXXX|   |   |   |
          //  +---+---+---+---+---+---+
          //          ^
          //  --------*
          //  j=2 tile widths, or 2*N pixels offset from 2*N*FMX pixels in row major order
          const rgba = data[ii*N + jj]
          array[4*(i*this._FMX*N*N + j*N + ii*this._FMX*N + jj) + 0] = rgba.r;
          array[4*(i*this._FMX*N*N + j*N + ii*this._FMX*N + jj) + 1] = rgba.g;
          array[4*(i*this._FMX*N*N + j*N + ii*this._FMX*N + jj) + 2] = rgba.b;
          array[4*(i*this._FMX*N*N + j*N + ii*this._FMX*N + jj) + 3] = rgba.a;
        }
      }
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
      for (let t = 0; t < this._numTiles; t++) {
        this._wave![i][t] = true

        // Re-initialize the constraint edge graph `_compatible`.
        // Every cell in `_compatible` is reset to have all possible neighbor
        // tiles in every direction.
        const compatDirMap = this._compatible[i].get(t)! // Map of directionID -> refcount of incoming edges
        for (let d = 0; d < this._basis.numDirections; d++) {
          // TODO: original WFC implementation seems to do something different to initialize `compatible`?
          for (let t2 = 0; t2 < this._numTiles; t2++) {
            const t2DirMap = this._propagator.get(t2)! // Map of directionID -> [list of possible tiles]
            t2DirMap.get(this._basis.opposite(d))?.forEach(tile => {
              if (tile === t) {
                const compatCount = compatDirMap.get(d)!
                compatDirMap.set(d, compatCount + 1)
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
  // to a single tile. If no such cell exists, return IterationResult.END_SUCCESS.
  // If we find a contradiction (a cell with no possible tiles), return IterationResult.END_FAILURE.
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
        for (let t = 0; t < this._numTiles; t++) {
          if (this._wave![i][t]) {
            this._observed[i] = t
            break
          }
        }
      }

      return IterationResult.END_SUCCESS
    }

    // 2. Collapse minimum cell wave function by sampling a tile from its distribution
    const distribution = new Array(this._numTiles)
    for (let t = 0; t < this._numTiles; t++) {
      distribution[t] = this._wave![argmin][t] ? this._weights[t] : 0
    }

    const tileIndex = sampleDiscrete(distribution, rng())
    const w = this._wave![argmin]
    for (let t = 0; t < this._numTiles; t++) {
      if (w[t] !== (t === tileIndex)) {
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

      for (let d = 0; d < this._basis.numDirections; d++) {
        const dx = this._basis.vector(d)[0]
        const dy = this._basis.vector(d)[1]

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

        // ban possible tiles for this neighbor that now have zero compatibilities
        const i2 = x2 + y2 * this._FMX
        const compatibleTiles = this._compatible[i2]
        const targetTilesForDir = this._propagator.get(e1.tile)!.get(d)
        targetTilesForDir?.forEach(t2 => {
          const compatibleNeighborEdges = compatibleTiles.get(t2)!
          const compatCount = compatibleNeighborEdges.get(d)!
          compatibleNeighborEdges.set(d, compatCount - 1)
          if (compatibleNeighborEdges.get(d)! <= 0) {
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

  // Removes tile with index `t` from the possible tiles for generation cell `i`.
  private _ban(i: number, t: number) {
    if (this._wave![i][t] === false) {
      return
    }
    this._wave![i][t] = false
    this._stack.push({cellIndex: i, tile: t})

    // TODO: avoid C calls to `ban` resulting in C^2 computations
    let entropy = 0
    for (let t = 0; t < this._numTiles; t++) {
      if (this._wave![i][t]) {
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

// OverlappingTileModel
//
// This model interprets the input image as a set of possibly overlapping tiles
// where each tile is a `tileWidth` x `tileWidth` square of pixels. Every pixel
// in the input image provides the top-left corner of a tile.
//
// The output is constrained so that an output tile can only have a neighboring tile
// in a given direction if there also exists the same tile with the same neighbor in
// the same direction in the input image.
//
// `SimplePixelModel` can be interpreted as equivalent to a `NonOverlappingTileModel` with a
// `tileWidth` of 1.
export class OverlappingTileModel {
  private _generationComplete: boolean = false

  private _FMX: number
  private _FMY: number
  private _FMXxFMY: number

  private _isPeriodic: boolean
  private _basis: Basis

  // Array with dimensions of the output, each element represents the state
  // of a tile in the output. Each state is a superposition of tiles of the
  // input with boolean coefficients. `false` means the tile is forbidden,
  // `true` means the tile is not yet forbidden.
  private _wave: PixelState[] | null

  // Directed graph of sourceTile --(direction)--> [list of possible target tiles].
  private _propagator: TileMap
  // Stores a map of (possible tile --(direction)--> number of neighbor edges allowing that tile) for every generation cell.
  // Neighbor edges are deleted as we observe neighbor tiles + collapse neighbor states. When the number of neighbor
  // edges compatible with a given tile reach zero for any direction, that tile is no longer possible for the
  // generation cell.
  private _compatible: (Map<TileID, Map<DirectionID, number>>)[]
  // Number of possible tiles.
  private _numTiles: number
  // Length N of each NxN tile. All tiles in our tileset are size NxN, N>=1.
  private _tileSize: number
  // Map of tile IDs to tile data objects
  private _tileSet: Map<number, TileData>

  // WlogW for the given tile with weight W, 1 per tile
  private _weightLogWeights: number[]
  // prior probabilities of tiles, 1 per tile
  private _weights: number[]
  private _startingEntropy: number
  // entropies of generation cells, 1 per cell
  private _entropies: number[]

  // Final observed tiles, 1 per generation cell.
  // Only set after generation completes.
  private _observed: TileID[]

  // Stack of (cellIndex, tile) pairs banned during iterations, used for backtracking and propagation
  private _stack: {cellIndex: number; tile: TileID}[]

  // imageData - Pixels to use as source image
  // width - Width (in tiles) of the generation
  // height - Height (in tiles) of the generation
  // tileSize - Length N of each NxN square forming the basic unit of the generation
  // isPeriodic - Whether the source image is considered a periodic pattern
  // basis - A Basis object providing the constraining edges for each cell.
  constructor(imageData: ImageData, width: number, height: number, tileSize: number, isPeriodic: boolean, basis: Basis) {
    this._FMX = width
    this._FMY = height
    this._FMXxFMY = width * height

    this._tileSize = tileSize
    this._isPeriodic = isPeriodic
    this._basis = basis

    // 1. Count number of unique colors in source image and assign each an ID
    let nextColorID = 0
    const hexToID = new Map<ColorHex, number>()
    for (let i = 0; i < imageData.height; i++) {
      for (let j = 0; j < imageData.width; j++) {
        const r = imageData.data[i*4*imageData.width + j*4 + 0]
        const g = imageData.data[i*4*imageData.width + j*4 + 1]
        const b = imageData.data[i*4*imageData.width + j*4 + 2]
        const a = imageData.data[i*4*imageData.width + j*4 + 3]
        const hex = r | (g << 8) | (b << 16) | (a << 24)
        if (!hexToID.has(hex)) {
          hexToID.set(hex, nextColorID++)
        }
      }
    }
    const numColors = hexToID.size
    // 2. Get all unique tiles in source image, assign each an ID, and
    // construct a directed graph of unique tile IDs to possible neighbor
    // tile IDs
    const hexArrayToHash = (colorArr: ColorHex[]): number  => {
      // "Hash" each array of C colors by treating each color as a digit and computing the number.
      let result = 0
      for (let i = 0; i < colorArr.length; i++) {
        const hex = colorArr[colorArr.length - 1 - i]
        result += hexToID.get(hex)! * Math.pow(numColors, i)
      }
      return result
    }
    const tileHexDataAtPixelOffset = (i: number, j: number): ColorHex[] => {
      // Get a 1-dimensional array of NxN hex colors corresponding to the NxN tile at
      // pixel offset i,j in the source image.
      const data = new Array(this._tileSize * this._tileSize)
      let index = 0
      for (let di = 0; di < this._tileSize; di++) {
        for (let dj = 0; dj < this._tileSize; dj++) {
          const ii = (i + di) % imageData.height
          const jj = (j + dj) % imageData.width
          const r = imageData.data[ii*4*imageData.width + jj*4 + 0]
          const g = imageData.data[ii*4*imageData.width + jj*4 + 1]
          const b = imageData.data[ii*4*imageData.width + jj*4 + 2]
          const a = imageData.data[ii*4*imageData.width + jj*4 + 3]
          const hex = r | (g << 8) | (b << 16) | (a << 24)
          data[index] = hex
          index++
        }
      }
      return data
    }
    const tileHexDataToTileData = (hexData: ColorHex[]): TileData => {
      // TODO: We shouldn't need to do so much conversion between hex and RGBA format.
      // Should be able to simplify this code a bunch if we make `_tileSet` use
      // tile data with pixels in hex format.
      return {
        data: hexData.map<Color>(hex => {
            return {
            r: hex & 0xFF,
            g: (hex >> 8) & 0xFF,
            b: (hex >> 16) & 0xFF,
            a: (hex >> 24) & 0xFF,
          }
        })
      }
    }
    let nextTileID = 0
    const tileHashToID = new Map<number, TileID>()
    const tileIDToCount = new Map<TileID, number>()
    this._tileSet = new Map()
    this._propagator = new Map()

    const getTileIDForHexData = (tileHexData: ColorHex[]): TileID => {
      // If tile with the given hex data already exists, return its ID.
      // Else insert it into tileset and give it a new tile ID.
      const hash = hexArrayToHash(tileHexData)
      if (!tileHashToID.has(hash)) {
        const tileID = nextTileID++
        tileHashToID.set(hash, tileID)
        tileIDToCount.set(tileID, 0)
        const tileData = tileHexDataToTileData(tileHexData)
        this._tileSet.set(tileID, tileData)
        this._propagator.set(tileID, new Map())
      }
      const tileID = tileHashToID.get(hash)!
      return tileID
    }

    for (let i = 0; i < imageData.height; i += 1) {
      for (let j = 0; j < imageData.width; j += 1) {
        const tileHexData = tileHexDataAtPixelOffset(i, j)
        const tileID = getTileIDForHexData(tileHexData)
        tileIDToCount.set(tileID, tileIDToCount.get(tileID)! + 1)
        const dirMap = this._propagator.get(tileID)!
        for (let d = 0; d < this._basis.numDirections; d++) {
          let ii = i + this._basis.vector(d)[1] * this._tileSize
          let jj = j + this._basis.vector(d)[0] * this._tileSize
          if (ii < 0 || ii + this._tileSize > imageData.height) {
            if (this._isPeriodic) {
              ii = (imageData.height + ii) % imageData.height
            } else {
              continue
            }
          }
          if (jj < 0 || jj + this._tileSize > imageData.width) {
            if (this._isPeriodic) {
              jj = (imageData.width + jj) % imageData.width
            } else {
              continue
            }
          }
          const nTileID = getTileIDForHexData(tileHexDataAtPixelOffset(ii, jj))

          if (!dirMap.has(d)) {
            dirMap.set(d, [])
          }
          const neighborTileIDs = dirMap.get(d)!
          if (neighborTileIDs.indexOf(nTileID) === -1) {
            neighborTileIDs.push(nTileID)
          }
        }
      }
    }

    this._numTiles = this._tileSet.size
    this._weights = []
    for (let t = 0; t < this._numTiles; t++) {
      const count = tileIDToCount.get(t)!
      this._weights.push(count / (imageData.width * imageData.height))
    }
  }

  initialize() {
    debugLog(`initializing wave`)
    this._wave = new Array(this._FMXxFMY)
    this._compatible = new Array(this._FMXxFMY)
    for (let i = 0; i < this._FMXxFMY; i++) {
      this._wave[i] = new Array(this._numTiles)
      this._compatible[i] = new Map()
      for (let t = 0; t < this._numTiles; t++) {
        const dirCount: Map<DirectionID, number> = new Map()
        for (let d = 0; d < this._basis.numDirections; d++) {
          dirCount.set(d, 0)
        }
        this._compatible[i].set(t, dirCount)
      }
    }

    this._startingEntropy = 0
    this._weightLogWeights = new Array(this._numTiles)
    for (let t = 0; t < this._numTiles; t++) {
      this._weightLogWeights[t] = this._weights[t] * Math.log(this._weights[t])
      if (isNaN(this._weightLogWeights[t])) {
        throw new Error("Unexpected NaN")
      }
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
    const N = this._tileSize
    for (let index = 0; index < this._FMXxFMY; index++) {
      const tileID = this._observed[index]
      const data = this._tileSet.get(tileID)!.data
      const i = (index / this._FMX) | 0
      const j = index % this._FMX
      for (let ii = 0; ii < N; ii++) {
        for (let jj = 0; jj < N; jj++) {
          //  FMX tiles, or FMX*N pixels
          //  -------------------------
          //
          //  N=4 pixels
          //  ----
          // |+---+---+---+---+---+---+        |
          // ||   |   |   |   |   |   |        |
          // ||   |   |   |   |   |   |        |
          // ||   |   |   |   |   |   |        |
          //  +---+---+---+---+---+---+        | -> i=2 tile heights, 2*N*FMX pixels in row major order
          //  |   |   |   |   |   |   |        |
          //  |   |   |   |   |   |   |        |
          //  |   |   |   |   |   |   |        |
          //  +---+---XXXX+---+---+---+ -------*
          //  |   |   XXXX|   |   |   |
          //  |   |   XXXX|   |   |   |
          //  |   |   XXXX|   |   |   |
          //  +---+---+---+---+---+---+
          //          ^
          //  --------*
          //  j=2 tile widths, or 2*N pixels offset from 2*N*FMX pixels in row major order
          const rgba = data[ii*N + jj]
          array[4*(i*this._FMX*N*N + j*N + ii*this._FMX*N + jj) + 0] = rgba.r;
          array[4*(i*this._FMX*N*N + j*N + ii*this._FMX*N + jj) + 1] = rgba.g;
          array[4*(i*this._FMX*N*N + j*N + ii*this._FMX*N + jj) + 2] = rgba.b;
          array[4*(i*this._FMX*N*N + j*N + ii*this._FMX*N + jj) + 3] = rgba.a;
        }
      }
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
      for (let t = 0; t < this._numTiles; t++) {
        this._wave![i][t] = true

        // Re-initialize the constraint edge graph `_compatible`.
        // Every cell in `_compatible` is reset to have all possible neighbor
        // tiles in every direction.
        const compatDirMap = this._compatible[i].get(t)! // Map of directionID -> refcount of incoming edges
        for (let d = 0; d < this._basis.numDirections; d++) {
          // TODO: original WFC implementation seems to do something different to initialize `compatible`?
          for (let t2 = 0; t2 < this._numTiles; t2++) {
            const t2DirMap = this._propagator.get(t2)! // Map of directionID -> [list of possible tiles]
            t2DirMap.get(this._basis.opposite(d))?.forEach(tile => {
              if (tile === t) {
                const compatCount = compatDirMap.get(d)!
                compatDirMap.set(d, compatCount + 1)
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
  // to a single tile. If no such cell exists, return IterationResult.END_SUCCESS.
  // If we find a contradiction (a cell with no possible tiles), return IterationResult.END_FAILURE.
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
        for (let t = 0; t < this._numTiles; t++) {
          if (this._wave![i][t]) {
            this._observed[i] = t
            break
          }
        }
      }

      return IterationResult.END_SUCCESS
    }

    // 2. Collapse minimum cell wave function by sampling a tile from its distribution
    const distribution = new Array(this._numTiles)
    for (let t = 0; t < this._numTiles; t++) {
      distribution[t] = this._wave![argmin][t] ? this._weights[t] : 0
    }

    const tileIndex = sampleDiscrete(distribution, rng())
    const w = this._wave![argmin]
    for (let t = 0; t < this._numTiles; t++) {
      if (w[t] !== (t === tileIndex)) {
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

      for (let d = 0; d < this._basis.numDirections; d++) {
        const dx = this._basis.vector(d)[0]
        const dy = this._basis.vector(d)[1]

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

        // ban possible tiles for this neighbor that now have zero compatibilities
        const i2 = x2 + y2 * this._FMX
        const compatibleTiles = this._compatible[i2]
        const targetTilesForDir = this._propagator.get(e1.tile)!.get(d)
        targetTilesForDir?.forEach(t2 => {
          const compatibleNeighborEdges = compatibleTiles.get(t2)!
          const compatCount = compatibleNeighborEdges.get(d)!
          compatibleNeighborEdges.set(d, compatCount - 1)
          if (compatibleNeighborEdges.get(d)! <= 0) {
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

  // Removes tile with index `t` from the possible tiles for generation cell `i`.
  private _ban(i: number, t: number) {
    if (this._wave![i][t] === false) {
      return
    }
    this._wave![i][t] = false
    this._stack.push({cellIndex: i, tile: t})

    // TODO: avoid C calls to `ban` resulting in C^2 computations
    let entropy = 0
    for (let t = 0; t < this._numTiles; t++) {
      if (this._wave![i][t]) {
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

const DEBUG_LOG = true
function debugLog(...args: any[]) {
  if (DEBUG_LOG) {
    console.log.apply(this, args)
  }
}
import { SimplePixelModel, CardinalBasis, CardinalBasisWithDiagonals } from "./model"

const inputCanvas = document.getElementById("input-canvas") as HTMLCanvasElement
const outputBasis = document.getElementById("output-control-basis") as HTMLSelectElement

let outputBasisName = outputBasis.value

function generate() {
  const outputCanvas = document.getElementById("output-canvas") as HTMLCanvasElement
  const inputCtx = inputCanvas.getContext("2d")!
  const imageData = inputCtx.getImageData(0, 0, inputCanvas.width, inputCanvas.height)

  const modelBasis = outputBasisName === "cardinal" ? CardinalBasis : CardinalBasisWithDiagonals
  const model = new SimplePixelModel(imageData, outputCanvas.width, outputCanvas.height, true, modelBasis)
  let success = model.generate()
  const MAX_RETRIES = 10
  if (!success) {
    for (let i = 0; i < MAX_RETRIES && !success; i++) {
      console.log(`Generation failed, retrying ${i + 1} of ${MAX_RETRIES} times...`)
      success = model.generate()
    }
  }

  if (success) {
    const outputCtx = outputCanvas.getContext("2d")!
    const outputData = outputCtx.createImageData(outputCanvas.width, outputCanvas.height)
    model.putGeneratedData(outputData!.data)
    outputCtx.putImageData(outputData, 0, 0)
  } else {
    console.warn(`Generation failed with ${MAX_RETRIES} attempts. Click 'generate' again to retry.`)
  }
}

const generateButton = document.getElementById("generate")
generateButton?.addEventListener("click", (e) => {
  generate()
})
outputBasis.addEventListener("change", (e) => {
  outputBasisName = (e?.target as any)?.value
})
const inputFile = document.getElementById("input-file") as HTMLInputElement
inputFile?.addEventListener("change", (e) => {
  if (inputFile.files && inputFile.files.length > 0) {
    const file = inputFile.files[0]
    const img = new Image()
    img.src = URL.createObjectURL(file)
    img.onload = () => {
      inputCanvas.width = img.naturalWidth
      inputCanvas.height = img.naturalHeight
      const aspect = img.naturalWidth / img.naturalHeight
      inputCanvas.style.width = `${aspect * 128}px`
      inputCanvas.style.height = `128px`
      const ctx = inputCanvas.getContext("2d")
      ctx?.drawImage(img, 0, 0)
    }
  }
})
const inputSelect = document.getElementById("input-select")
inputSelect?.addEventListener("change", (e) => {
  const value = (e?.target as any)?.value
  if (value) {
    const img = new Image()
    img.src = value
    img.onload = () => {
      inputCanvas.width = img.naturalWidth
      inputCanvas.height = img.naturalHeight
      const aspect = img.naturalWidth / img.naturalHeight
      inputCanvas.style.width = `${aspect * 128}px`
      inputCanvas.style.height = `128px`
      const ctx = inputCanvas.getContext("2d")
      ctx?.drawImage(img, 0, 0)
    }
  }
})
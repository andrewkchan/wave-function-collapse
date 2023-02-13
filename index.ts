import { SimplePixelModel } from "./model"

const input = document.getElementById("input-img") as HTMLImageElement
const outputCanvas = document.getElementById("output-canvas") as HTMLCanvasElement

function generate() {
  const canvas = document.createElement("canvas")
  canvas.width = input.naturalWidth
  canvas.height = input.naturalHeight
  const inputCtx = canvas.getContext("2d")!
  inputCtx.drawImage(input, 0, 0)
  const imageData = inputCtx.getImageData(0, 0, canvas.width, canvas.height)

  const model = new SimplePixelModel(imageData, outputCanvas.width, outputCanvas.height, true)
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
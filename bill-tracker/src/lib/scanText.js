// Reads the text in an image — a screenshot of an Apple Wallet transaction,
// or a receipt photo — right on the device. Tesseract.js (and its English
// language data, fetched the first time) only loads when someone scans,
// so it costs nothing until then. `onProgress` gets 0–1.
export async function readImageText(file, onProgress) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m) => { if (m.status === "recognizing text") onProgress?.(m.progress); },
  });
  try {
    const { data } = await worker.recognize(file);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}

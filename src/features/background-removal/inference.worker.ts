import { getModel } from './models.ts';
import { applyAlpha, createMask, preprocess } from './processing.ts';
import type { OrtRuntime, OrtSession, OrtTensor, Provider, WorkerRequest, WorkerResponse } from './types.ts';

const post = (message: WorkerResponse) => self.postMessage(message);

function float16(values: Float32Array): Uint16Array {
  const bits = new Uint32Array(values.buffer, values.byteOffset, values.length);
  return Uint16Array.from(bits, value => {
    const sign = (value >>> 16) & 0x8000;
    const exponent = ((value >>> 23) & 255) - 127 + 15;
    const mantissa = value & 0x7fffff;
    if (exponent <= 0) return sign | ((mantissa | 0x800000) >>> (14 - exponent));
    if (exponent >= 31) return sign | 0x7c00;
    return sign | (exponent << 10) | ((mantissa + 0x1000) >>> 13);
  });
}

async function run(request: WorkerRequest): Promise<void> {
  const urls: string[] = [];
  let bitmap: ImageBitmap | undefined;
  let session: OrtSession | undefined;
  let input: OrtTensor | undefined;
  let outputs: Record<string, OrtTensor> | undefined;
  const objectUrl = (blob: Blob, type: string) => {
    const url = URL.createObjectURL(blob.slice(0, blob.size, type));
    urls.push(url);
    return url;
  };
  try {
    post({ type: 'progress', stage: 'runtime' });
    const script = objectUrl(request.runtime.script, 'text/javascript');
    const ort = await import(/* @vite-ignore */ script) as OrtRuntime;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = {
      mjs: objectUrl(request.runtime.loader, 'text/javascript'),
      wasm: objectUrl(request.runtime.wasm, 'application/wasm')
    };
    const model = getModel(request.modelId);
    const bytes = new Uint8Array(await request.model.arrayBuffer());
    post({ type: 'progress', stage: 'model' });
    const providers: Provider[] = request.device === 'auto'
      ? ('gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm']) : [request.device];
    let lastError: unknown;
    let result: Blob | undefined;
    let provider: Provider = 'wasm';
    bitmap = await createImageBitmap(request.image);
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) {
      throw new Error('Image exceeds 40 megapixels');
    }
    const resized = new OffscreenCanvas(model.inputSize, model.inputSize);
    const resizedContext = resized.getContext('2d');
    if (!resizedContext) throw new Error('Canvas is unavailable');
    resizedContext.drawImage(bitmap, 0, 0, model.inputSize, model.inputSize);
    const values = preprocess(resizedContext.getImageData(0, 0, model.inputSize, model.inputSize).data, model.id);
    for (const candidate of providers) {
      try {
        session = await ort.InferenceSession.create(bytes, { executionProviders: [candidate] });
        const metadata = session.inputMetadata[0];
        if (session.inputNames.length !== 1 || !metadata || !['float32', 'float16'].includes(metadata.type)) {
          throw new Error('Unsupported model input; expected a single RGB float tensor');
        }
        const expected = [1, 3, model.inputSize, model.inputSize];
        if (metadata.shape.length !== 4 || metadata.shape.some((dimension, index) =>
          typeof dimension === 'number' && dimension > 0 && dimension !== expected[index])) {
          throw new Error(`Model input must be 1x3x${model.inputSize}x${model.inputSize}`);
        }
        input = new ort.Tensor(metadata.type, metadata.type === 'float16' ? float16(values) : values, expected);
        post({ type: 'progress', stage: candidate });
        outputs = await session.run({ [session.inputNames[0]]: input });
        const output = outputs[session.outputNames[0]];
        const height = output?.dims.at(-2) || 0;
        const width = output?.dims.at(-1) || 0;
        if (!output || !width || !height || output.data.length !== width * height ||
            !['float32', 'float16'].includes(output.type)) throw new Error('Unsupported model mask output');
        const mask = new OffscreenCanvas(width, height);
        const maskContext = mask.getContext('2d');
        if (!maskContext) throw new Error('Canvas is unavailable');
        maskContext.putImageData(new ImageData(createMask(output.data, model.id), width, height), 0, 0);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable');
        context.drawImage(mask, 0, 0, bitmap.width, bitmap.height);
        const alpha = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0);
        const original = context.getImageData(0, 0, canvas.width, canvas.height);
        applyAlpha(original.data, alpha);
        context.putImageData(original, 0, 0);
        result = await canvas.convertToBlob({ type: 'image/png' });
        provider = candidate;
        break;
      } catch (error) {
        lastError = error;
        if (candidate === 'webgpu' && providers.includes('wasm')) post({ type: 'progress', stage: 'fallback' });
      } finally {
        input?.dispose();
        input = undefined;
        if (outputs) Object.values(outputs).forEach(tensor => tensor.dispose());
        outputs = undefined;
        await session?.release();
        session = undefined;
      }
    }
    if (!result) throw lastError || new Error('Inference failed');
    post({ type: 'result', blob: result, provider });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap?.close();
    urls.forEach(url => URL.revokeObjectURL(url));
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => { void run(event.data); };
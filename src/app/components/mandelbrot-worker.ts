// Web Worker for parallel Mandelbrot computation
interface WorkerMessage {
  type: 'compute';
  data: {
    startY: number;
    endY: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    zoom: number;
    maxIterations: number;
  };
}

interface WorkerResponse {
  type: 'result';
  data: {
    startY: number;
    endY: number;
    imageData: Uint8ClampedArray;
  };
}

const mandelbrot = (cx: number, cy: number, maxIter: number = 100): number => {
  let x = 0;
  let y = 0;
  let iter = 0;

  while (x * x + y * y <= 4 && iter < maxIter) {
    const xtemp = x * x - y * y + cx;
    y = 2 * x * y + cy;
    x = xtemp;
    iter++;
  }

  return iter;
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data;
  
  if (type === 'compute') {
    const { startY, endY, width, height, centerX, centerY, zoom, maxIterations } = data;
    
    const zoomScale = Math.min(width, height) / 3.5 * zoom;
    const canvasCenterX = width / 2;
    const canvasCenterY = height / 2;
    
    const rowCount = endY - startY;
    const imageData = new Uint8ClampedArray(rowCount * width * 4);
    
    for (let py = startY; py < endY; py++) {
      for (let px = 0; px < width; px++) {
        const x = (px - canvasCenterX) / zoomScale + centerX;
        const y = (py - canvasCenterY) / zoomScale + centerY;
        
        const iter = mandelbrot(x, y, maxIterations);
        const index = ((py - startY) * width + px) * 4;

        if (iter === maxIterations) {
          imageData[index] = 0;     // R
          imageData[index + 1] = 0; // G
          imageData[index + 2] = 0; // B
        } else {
          // Same color calculation as original
          const normalizedIter = iter / maxIterations;
          
          let baseR: number, baseG: number, baseB: number;
          
          if (normalizedIter < 0.33) {
            const t = normalizedIter * 3;
            baseR = 20 + t * 60;
            baseG = 30 + t * 120;
            baseB = 120 + t * 135;
          } else if (normalizedIter < 0.66) {
            const t = (normalizedIter - 0.33) * 3;
            baseR = 80 + t * 20;
            baseG = 150 + t * 105;
            baseB = 255 - t * 50;
          } else {
            const t = (normalizedIter - 0.66) * 3;
            baseR = 100 + t * 100;
            baseG = 255 - t * 155;
            baseB = 205 + t * 50;
          }
          
          const redBoost = Math.sin(iter * 0.4) * 0.3 + 0.3;
          const redIntensity = Math.sin(iter * 0.15 + normalizedIter * 6) * 60;
          
          const finalR = Math.floor(baseR + redIntensity * redBoost);
          const finalG = Math.floor(baseG);
          const finalB = Math.floor(baseB);
          
          imageData[index] = Math.max(0, Math.min(255, finalR));
          imageData[index + 1] = Math.max(0, Math.min(255, finalG));
          imageData[index + 2] = Math.max(0, Math.min(255, finalB));
        }
        imageData[index + 3] = 255; // A
      }
    }
    
    const response: WorkerResponse = {
      type: 'result',
      data: {
        startY,
        endY,
        imageData
      }
    };
    
    self.postMessage(response);
  }
};
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface FractalExplorerProps {}

interface ViewState {
  zoom: number;
  centerX: number;
  centerY: number;
}

export default function FractalExplorer({}: FractalExplorerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [viewState, setViewState] = useState<ViewState>({
    zoom: 1,
    centerX: -0.5,
    centerY: 0
  });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const renderFractal = useCallback(() => {
    if (!canvasRef.current || dimensions.width === 0 || dimensions.height === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    renderMandelbrot(ctx, dimensions.width, dimensions.height, viewState);
  }, [dimensions, viewState]);

  useEffect(() => {
    renderFractal();
  }, [renderFractal]);

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

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    
    setViewState(prev => {
      const currentZoom = Math.min(dimensions.width, dimensions.height) / 3.5 * prev.zoom;
      const newZoom = prev.zoom * zoomFactor;
      
      const mouseRealX = (mouseX - dimensions.width / 2) / currentZoom + prev.centerX;
      const mouseRealY = (mouseY - dimensions.height / 2) / currentZoom + prev.centerY;
      
      const newCenterX = mouseRealX - (mouseX - dimensions.width / 2) / (currentZoom * zoomFactor);
      const newCenterY = mouseRealY - (mouseY - dimensions.height / 2) / (currentZoom * zoomFactor);
      
      return {
        zoom: newZoom,
        centerX: newCenterX,
        centerY: newCenterY
      };
    });
  }, [dimensions]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    setIsDragging(true);
    setLastMousePos({ x: event.clientX, y: event.clientY });
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!isDragging) return;

    const deltaX = event.clientX - lastMousePos.x;
    const deltaY = event.clientY - lastMousePos.y;
    
    setViewState(prev => {
      const currentZoom = Math.min(dimensions.width, dimensions.height) / 3.5 * prev.zoom;
      return {
        ...prev,
        centerX: prev.centerX - deltaX / currentZoom,
        centerY: prev.centerY - deltaY / currentZoom
      };
    });
    
    setLastMousePos({ x: event.clientX, y: event.clientY });
  }, [isDragging, lastMousePos, dimensions]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('wheel', handleWheel);
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const renderMandelbrot = (ctx: CanvasRenderingContext2D, width: number, height: number, view: ViewState) => {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    const zoom = Math.min(width, height) / 3.5 * view.zoom;
    const centerX = width / 2;
    const centerY = height / 2;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const x = (px - centerX) / zoom + view.centerX;
        const y = (py - centerY) / zoom + view.centerY;
        
        const iter = mandelbrot(x, y, 100);
        const index = (py * width + px) * 4;

        if (iter === 100) {
          data[index] = 0;     // R
          data[index + 1] = 0; // G
          data[index + 2] = 0; // B
        } else {
          const hue = (iter * 8) % 360;
          const saturation = 100;
          const lightness = iter < 100 ? 50 : 0;
          
          const [r, g, b] = hslToRgb(hue / 360, saturation / 100, lightness / 100);
          data[index] = r;     // R
          data[index + 1] = g; // G
          data[index + 2] = b; // B
        }
        data[index + 3] = 255; // A
      }
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h * 6) % 2 - 1));
    const m = l - c / 2;
    
    let r = 0, g = 0, b = 0;
    
    if (0 <= h && h < 1/6) {
      r = c; g = x; b = 0;
    } else if (1/6 <= h && h < 2/6) {
      r = x; g = c; b = 0;
    } else if (2/6 <= h && h < 3/6) {
      r = 0; g = c; b = x;
    } else if (3/6 <= h && h < 4/6) {
      r = 0; g = x; b = c;
    } else if (4/6 <= h && h < 5/6) {
      r = x; g = 0; b = c;
    } else if (5/6 <= h && h < 1) {
      r = c; g = 0; b = x;
    }
    
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  };

  return (
    <canvas
      ref={canvasRef}
      className="block"
      style={{
        width: '100vw',
        height: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 0,
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface FractalExplorerProps {}

interface ViewState {
  zoom: number;
  centerX: number;
  centerY: number;
}

interface WebGPURenderer {
  device: GPUDevice;
  context: GPUCanvasContext;
  renderPipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
  vertexBuffer: GPUBuffer;
}

interface Bookmark {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  zoom: number;
  timestamp: number;
}

interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
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
  const [webgpuRenderer, setWebgpuRenderer] = useState<WebGPURenderer | null>(null);
  const [supportsWebGPU, setSupportsWebGPU] = useState<boolean | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);

  const initWebGPU = useCallback(async (): Promise<WebGPURenderer | null> => {
    if (!navigator.gpu) {
      setSupportsWebGPU(false);
      return null;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        setSupportsWebGPU(false);
        return null;
      }

      const device = await adapter.requestDevice();
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const context = canvas.getContext('webgpu') as GPUCanvasContext;
      if (!context) {
        setSupportsWebGPU(false);
        return null;
      }

      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      context.configure({
        device,
        format: canvasFormat,
      });

      const shaderModule = device.createShaderModule({
        code: `
          struct Uniforms {
            screenWidth: f32,
            screenHeight: f32,
            centerX: f32,
            centerY: f32,
            zoom: f32,
            maxIterations: f32,
          }

          struct VertexOutput {
            @builtin(position) position: vec4<f32>,
            @location(0) uv: vec2<f32>,
          }

          @binding(0) @group(0) var<uniform> uniforms: Uniforms;

          @vertex
          fn vs_main(@location(0) position: vec2<f32>) -> VertexOutput {
            var output: VertexOutput;
            output.position = vec4<f32>(position, 0.0, 1.0);
            output.uv = position * 0.5 + 0.5;
            return output;
          }

          fn mandelbrot(cx: f32, cy: f32) -> u32 {
            var x: f32 = 0.0;
            var y: f32 = 0.0;
            var iter: u32 = 0u;
            let maxIter: u32 = u32(uniforms.maxIterations);

            while (x * x + y * y <= 4.0 && iter < maxIter) {
              let xtemp = x * x - y * y + cx;
              y = 2.0 * x * y + cy;
              x = xtemp;
              iter = iter + 1u;
            }

            return iter;
          }

          fn hslToRgb(h: f32, s: f32, l: f32) -> vec3<f32> {
            let c = (1.0 - abs(2.0 * l - 1.0)) * s;
            let x = c * (1.0 - abs((h * 6.0) % 2.0 - 1.0));
            let m = l - c / 2.0;
            
            var rgb: vec3<f32>;
            if (h < 1.0 / 6.0) {
              rgb = vec3<f32>(c, x, 0.0);
            } else if (h < 2.0 / 6.0) {
              rgb = vec3<f32>(x, c, 0.0);
            } else if (h < 3.0 / 6.0) {
              rgb = vec3<f32>(0.0, c, x);
            } else if (h < 4.0 / 6.0) {
              rgb = vec3<f32>(0.0, x, c);
            } else if (h < 5.0 / 6.0) {
              rgb = vec3<f32>(x, 0.0, c);
            } else {
              rgb = vec3<f32>(c, 0.0, x);
            }
            
            return rgb + vec3<f32>(m, m, m);
          }

          @fragment
          fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
            let px = input.uv.x * uniforms.screenWidth;
            let py = (1.0 - input.uv.y) * uniforms.screenHeight;
            
            let zoomScale = min(uniforms.screenWidth, uniforms.screenHeight) / 3.5 * uniforms.zoom;
            let centerX = uniforms.screenWidth / 2.0;
            let centerY = uniforms.screenHeight / 2.0;
            
            let x = (px - centerX) / zoomScale + uniforms.centerX;
            let y = (py - centerY) / zoomScale + uniforms.centerY;
            
            let iter = mandelbrot(x, y);
            
            if (iter == u32(uniforms.maxIterations)) {
              return vec4<f32>(0.0, 0.0, 0.0, 1.0);
            }
            
            let hue = (f32(iter) * 8.0) % 360.0;
            let saturation = 1.0;
            let lightness = 0.5;
            
            let rgb = hslToRgb(hue / 360.0, saturation, lightness);
            return vec4<f32>(rgb, 1.0);
          }
        `
      });

      // Create fullscreen quad vertices
      const vertices = new Float32Array([
        -1.0, -1.0,  // Bottom left
         1.0, -1.0,  // Bottom right
        -1.0,  1.0,  // Top left
        -1.0,  1.0,  // Top left
         1.0, -1.0,  // Bottom right
         1.0,  1.0,  // Top right
      ]);

      const vertexBuffer = device.createBuffer({
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      });
      new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
      vertexBuffer.unmap();

      const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: shaderModule,
          entryPoint: 'vs_main',
          buffers: [
            {
              arrayStride: 2 * 4, // 2 floats * 4 bytes
              attributes: [
                {
                  shaderLocation: 0,
                  offset: 0,
                  format: 'float32x2',
                },
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs_main',
          targets: [
            {
              format: canvasFormat,
            },
          ],
        },
        primitive: {
          topology: 'triangle-list',
        },
      });

      const uniformBuffer = device.createBuffer({
        size: 6 * 4, // 6 floats * 4 bytes each
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const bindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: uniformBuffer,
            },
          },
        ],
      });

      setSupportsWebGPU(true);

      return {
        device,
        context,
        renderPipeline,
        uniformBuffer,
        bindGroup,
        vertexBuffer,
      };
    } catch (error) {
      console.error('WebGPU initialization failed:', error);
      setSupportsWebGPU(false);
      return null;
    }
  }, []);

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

  // Load bookmarks from localStorage on mount
  useEffect(() => {
    const savedBookmarks = localStorage.getItem('fractal-bookmarks');
    if (savedBookmarks) {
      try {
        setBookmarks(JSON.parse(savedBookmarks));
      } catch (error) {
        console.error('Failed to load bookmarks:', error);
      }
    }
  }, []);

  // Save bookmarks to localStorage when they change
  useEffect(() => {
    localStorage.setItem('fractal-bookmarks', JSON.stringify(bookmarks));
  }, [bookmarks]);

  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0 && supportsWebGPU === null) {
      initWebGPU().then(setWebgpuRenderer);
    }
  }, [dimensions, supportsWebGPU, initWebGPU]);

  const renderFractalWebGPU = useCallback(() => {
    if (!webgpuRenderer || !canvasRef.current || dimensions.width === 0 || dimensions.height === 0) return;

    const canvas = canvasRef.current;
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const { device, context, renderPipeline, uniformBuffer, bindGroup, vertexBuffer } = webgpuRenderer;

    // Update uniforms
    const uniformData = new Float32Array([
      dimensions.width,
      dimensions.height,
      viewState.centerX,
      viewState.centerY,
      viewState.zoom,
      100 // maxIterations
    ]);

    device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer);

    // Create command encoder
    const commandEncoder = device.createCommandEncoder();

    // Begin render pass
    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };

    const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.draw(6, 1, 0, 0); // 6 vertices for 2 triangles (fullscreen quad)
    renderPass.end();

    // Submit commands
    device.queue.submit([commandEncoder.finish()]);
  }, [webgpuRenderer, dimensions, viewState]);

  const renderFractal = useCallback(() => {
    if (!canvasRef.current || dimensions.width === 0 || dimensions.height === 0) return;

    if (webgpuRenderer && supportsWebGPU) {
      renderFractalWebGPU();
    } else {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = dimensions.width;
      canvas.height = dimensions.height;

      renderMandelbrot(ctx, dimensions.width, dimensions.height, viewState);
    }
  }, [dimensions, viewState, webgpuRenderer, supportsWebGPU, renderFractalWebGPU]);

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

  const saveBookmark = useCallback((rect: SelectionRect) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Calculate center and zoom from selection rectangle
    const rectCenterX = (rect.startX + rect.endX) / 2;
    const rectCenterY = (rect.startY + rect.endY) / 2;
    const rectWidth = Math.abs(rect.endX - rect.startX);
    const rectHeight = Math.abs(rect.endY - rect.startY);

    // Convert screen coordinates to fractal coordinates
    const currentZoom = Math.min(dimensions.width, dimensions.height) / 3.5 * viewState.zoom;
    const fractalCenterX = (rectCenterX - dimensions.width / 2) / currentZoom + viewState.centerX;
    const fractalCenterY = (rectCenterY - dimensions.height / 2) / currentZoom + viewState.centerY;

    // Calculate zoom level to fit the selection
    const zoomFactorX = dimensions.width / rectWidth;
    const zoomFactorY = dimensions.height / rectHeight;
    const newZoom = viewState.zoom * Math.min(zoomFactorX, zoomFactorY) * 0.8; // 0.8 for some padding

    const bookmark: Bookmark = {
      id: Date.now().toString(),
      name: `Bookmark ${bookmarks.length + 1}`,
      centerX: fractalCenterX,
      centerY: fractalCenterY,
      zoom: newZoom,
      timestamp: Date.now(),
    };

    setBookmarks(prev => [...prev, bookmark]);
  }, [canvasRef, dimensions, viewState, bookmarks.length]);

  const animateToBookmark = useCallback((bookmark: Bookmark) => {
    if (isAnimating) return;
    
    setIsAnimating(true);
    const startState = { ...viewState };
    const endState = {
      zoom: bookmark.zoom,
      centerX: bookmark.centerX,
      centerY: bookmark.centerY
    };
    
    const duration = 2000;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeInOutQuad = (t: number) => 
        t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      
      const easedProgress = easeInOutQuad(progress);
      
      const currentZoom = startState.zoom + (endState.zoom - startState.zoom) * easedProgress;
      const currentCenterX = startState.centerX + (endState.centerX - startState.centerX) * easedProgress;
      const currentCenterY = startState.centerY + (endState.centerY - startState.centerY) * easedProgress;
      
      setViewState({
        zoom: currentZoom,
        centerX: currentCenterX,
        centerY: currentCenterY
      });
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
      }
    };
    
    requestAnimationFrame(animate);
  }, [viewState, isAnimating]);

  const deleteBookmark = useCallback((id: string) => {
    setBookmarks(prev => prev.filter(bookmark => bookmark.id !== id));
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.shiftKey) {
      // Start rectangle selection when Shift is held
      setIsSelecting(true);
      setSelectionRect({
        startX: event.clientX,
        startY: event.clientY,
        endX: event.clientX,
        endY: event.clientY,
      });
    } else {
      // Normal dragging
      setIsDragging(true);
      setLastMousePos({ x: event.clientX, y: event.clientY });
    }
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (isSelecting && selectionRect) {
      // Update selection rectangle
      setSelectionRect(prev => prev ? {
        ...prev,
        endX: event.clientX,
        endY: event.clientY,
      } : null);
    } else if (isDragging) {
      // Normal panning
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
    }
  }, [isDragging, isSelecting, lastMousePos, dimensions, selectionRect]);

  const handleMouseUp = useCallback(() => {
    if (isSelecting && selectionRect) {
      // Save the selection as a bookmark
      const rectWidth = Math.abs(selectionRect.endX - selectionRect.startX);
      const rectHeight = Math.abs(selectionRect.endY - selectionRect.startY);
      
      // Only save if the selection is large enough
      if (rectWidth > 20 && rectHeight > 20) {
        saveBookmark(selectionRect);
      }
      
      setIsSelecting(false);
      setSelectionRect(null);
    } else {
      setIsDragging(false);
    }
  }, [isSelecting, selectionRect, saveBookmark]);

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
    <>
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
          cursor: isDragging ? 'grabbing' : isSelecting ? 'crosshair' : 'grab'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      
      {/* Selection Rectangle */}
      {isSelecting && selectionRect && (
        <div
          className="fixed border-2 border-yellow-400 bg-yellow-400 bg-opacity-20 pointer-events-none z-5"
          style={{
            left: Math.min(selectionRect.startX, selectionRect.endX),
            top: Math.min(selectionRect.startY, selectionRect.endY),
            width: Math.abs(selectionRect.endX - selectionRect.startX),
            height: Math.abs(selectionRect.endY - selectionRect.startY),
          }}
        />
      )}

      {/* Bookmarks Panel */}
      {bookmarks.length > 0 && (
        <div className="fixed top-6 right-6 z-10 bg-black bg-opacity-80 text-white p-4 rounded-lg max-w-xs">
          <div className="text-sm font-bold mb-3">📍 Bookmarks</div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="flex items-center justify-between bg-gray-800 p-2 rounded text-xs">
                <div className="flex-1 min-w-0">
                  <div className="font-mono truncate">{bookmark.name}</div>
                  <div className="text-gray-400 text-xs">
                    {bookmark.zoom.toFixed(1)}x zoom
                  </div>
                </div>
                <div className="flex gap-1 ml-2">
                  <button
                    onClick={() => animateToBookmark(bookmark)}
                    className="bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs"
                    disabled={isAnimating}
                  >
                    Go
                  </button>
                  <button
                    onClick={() => deleteBookmark(bookmark.id)}
                    className="bg-red-600 hover:bg-red-700 px-2 py-1 rounded text-xs"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-400 mt-3 border-t border-gray-600 pt-2">
            Hold Shift + drag to create new bookmark
          </div>
        </div>
      )}
      
      {/* Instructions overlay when no bookmarks */}
      {bookmarks.length === 0 && (
        <div className="fixed top-6 right-6 z-10 bg-black bg-opacity-70 text-white p-3 rounded-lg text-sm">
          <div className="text-yellow-400 mb-1">📍 Create Bookmarks</div>
          <div className="text-xs">Hold Shift + drag to select areas</div>
        </div>
      )}

      {/* Render Info Overlay */}
      <div className="fixed bottom-6 right-6 z-10 bg-black bg-opacity-70 text-white p-3 rounded-lg font-mono text-sm">
        <div className="text-xs opacity-75 mb-1">Render Info</div>
        <div>X: {viewState.centerX.toFixed(6)}</div>
        <div>Y: {viewState.centerY.toFixed(6)}</div>
        <div>Zoom: {viewState.zoom.toFixed(2)}x</div>
        <div className="text-xs opacity-75 mt-1">
          {supportsWebGPU ? '🚀 WebGPU' : '🐌 CPU'}
        </div>
      </div>
    </>
  );
}
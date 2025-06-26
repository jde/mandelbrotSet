'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

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
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
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
  const [is3D, setIs3D] = useState(true);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isRotating, setIsRotating] = useState(false);
  const [resolution, setResolution] = useState(128);
  const [lightSettings, setLightSettings] = useState({
    intensity: 0.8,
    x: 10,
    y: 10,
    z: 5,
    color: '#ffffff'
  });
  const lightRef = useRef<THREE.DirectionalLight | null>(null);

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

  const init3DScene = useCallback(() => {
    if (!mountRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, dimensions.width / dimensions.height, 0.1, 1000);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(dimensions.width, dimensions.height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // Clear any existing canvas
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 100;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    scene.add(directionalLight);
    lightRef.current = directionalLight;

    // Controls
    const animate = () => {
      requestAnimationFrame(animate);
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();
  }, [dimensions]);

  const generateMandelbrotHeightMap = useCallback((meshResolution: number) => {
    const heightData = new Float32Array(meshResolution * meshResolution);
    const colorData = new Uint8Array(meshResolution * meshResolution * 3);
    
    const zoomScale = Math.min(dimensions.width, dimensions.height) / 3.5 * viewState.zoom;
    
    for (let y = 0; y < meshResolution; y++) {
      for (let x = 0; x < meshResolution; x++) {
        const index = y * meshResolution + x;
        
        // Map pixel to fractal coordinates
        const fx = ((x / meshResolution) - 0.5) * 4 / viewState.zoom + viewState.centerX;
        const fy = ((y / meshResolution) - 0.5) * 4 / viewState.zoom + viewState.centerY;
        
        // Calculate Mandelbrot
        const iter = mandelbrot(fx, fy, 100);
        
        // Height based on iteration count
        const normalizedIter = iter / 100;
        heightData[index] = iter === 100 ? 0 : normalizedIter * 2; // Scale height
        
        // Color based on iteration count
        const colorIndex = index * 3;
        if (iter === 100) {
          colorData[colorIndex] = 0;     // R
          colorData[colorIndex + 1] = 0; // G
          colorData[colorIndex + 2] = 0; // B
        } else {
          const hue = (iter * 8) % 360;
          const [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
          colorData[colorIndex] = r;
          colorData[colorIndex + 1] = g;
          colorData[colorIndex + 2] = b;
        }
      }
    }
    
    return { heightData, colorData, resolution: meshResolution };
  }, [viewState, dimensions]);

  const create3DMesh = useCallback(() => {
    if (!sceneRef.current) return;

    // Remove existing mesh
    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      if (meshRef.current.geometry) meshRef.current.geometry.dispose();
      if (meshRef.current.material) {
        if (Array.isArray(meshRef.current.material)) {
          meshRef.current.material.forEach(mat => mat.dispose());
        } else {
          meshRef.current.material.dispose();
        }
      }
    }

    const { heightData, colorData, resolution: meshRes } = generateMandelbrotHeightMap(resolution);

    // Create geometry
    const geometry = new THREE.PlaneGeometry(8, 8, meshRes - 1, meshRes - 1);
    const vertices = geometry.attributes.position.array as Float32Array;
    const colors = new Float32Array(vertices.length);

    // Apply height and color data
    for (let i = 0; i < vertices.length / 3; i++) {
      const heightIndex = i;
      vertices[i * 3 + 2] = heightData[heightIndex]; // Z coordinate for height
      
      const colorIndex = heightIndex * 3;
      colors[i * 3] = colorData[colorIndex] / 255;     // R
      colors[i * 3 + 1] = colorData[colorIndex + 1] / 255; // G
      colors[i * 3 + 2] = colorData[colorIndex + 2] / 255; // B
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    // Create material
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      wireframe: false,
      side: THREE.DoubleSide,
    });

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // Rotate to make it horizontal
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    
    sceneRef.current.add(mesh);
    meshRef.current = mesh;
  }, [generateMandelbrotHeightMap]);

  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0) {
      if (is3D) {
        init3DScene();
      } else if (supportsWebGPU === null) {
        initWebGPU().then(setWebgpuRenderer);
      }
    }
  }, [dimensions, is3D, supportsWebGPU, initWebGPU, init3DScene]);

  // Update light properties
  useEffect(() => {
    if (lightRef.current) {
      lightRef.current.intensity = lightSettings.intensity;
      lightRef.current.position.set(lightSettings.x, lightSettings.y, lightSettings.z);
      lightRef.current.color.setStyle(lightSettings.color);
    }
  }, [lightSettings]);

  useEffect(() => {
    if (is3D && sceneRef.current) {
      create3DMesh();
    }
  }, [is3D, viewState, resolution, create3DMesh]);

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
    if (is3D) return; // 3D rendering is handled by Three.js
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
  }, [dimensions, viewState, webgpuRenderer, supportsWebGPU, renderFractalWebGPU, is3D]);

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
    if (event.shiftKey && !is3D) {
      // Start rectangle selection when Shift is held (only in 2D mode)
      setIsSelecting(true);
      setSelectionRect({
        startX: event.clientX,
        startY: event.clientY,
        endX: event.clientX,
        endY: event.clientY,
      });
    } else if (is3D && event.button === 0) {
      // 3D camera rotation
      setIsRotating(true);
      setMousePos({ x: event.clientX, y: event.clientY });
    } else if (!is3D) {
      // Normal 2D dragging
      setIsDragging(true);
      setLastMousePos({ x: event.clientX, y: event.clientY });
    }
  }, [is3D]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (isSelecting && selectionRect && !is3D) {
      // Update selection rectangle (2D mode only)
      setSelectionRect(prev => prev ? {
        ...prev,
        endX: event.clientX,
        endY: event.clientY,
      } : null);
    } else if (isRotating && is3D && cameraRef.current) {
      // 3D camera rotation
      const deltaX = event.clientX - mousePos.x;
      const deltaY = event.clientY - mousePos.y;
      
      const rotationSpeed = 0.005;
      const camera = cameraRef.current;
      
      // Rotate around Y axis (horizontal mouse movement)
      const spherical = new THREE.Spherical();
      spherical.setFromVector3(camera.position);
      spherical.theta -= deltaX * rotationSpeed;
      spherical.phi += deltaY * rotationSpeed;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
      
      camera.position.setFromSpherical(spherical);
      camera.lookAt(0, 0, 0);
      
      setMousePos({ x: event.clientX, y: event.clientY });
    } else if (isDragging && !is3D) {
      // Normal 2D panning
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
  }, [isDragging, isSelecting, isRotating, lastMousePos, mousePos, dimensions, selectionRect, is3D]);

  const handleMouseUp = useCallback(() => {
    if (isSelecting && selectionRect && !is3D) {
      // Save the selection as a bookmark (2D mode only)
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
      setIsRotating(false);
    }
  }, [isSelecting, selectionRect, saveBookmark, is3D]);

  const handleWheel3D = useCallback((event: WheelEvent) => {
    if (!is3D || !cameraRef.current) return;
    
    event.preventDefault();
    const camera = cameraRef.current;
    const zoomSpeed = 0.1;
    
    // Zoom in/out by moving camera closer/further
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    
    if (event.deltaY > 0) {
      camera.position.add(direction.multiplyScalar(zoomSpeed));
    } else {
      camera.position.sub(direction.multiplyScalar(zoomSpeed));
    }
    
    // Prevent camera from going too close or too far
    const distance = camera.position.length();
    if (distance < 2) {
      camera.position.normalize().multiplyScalar(2);
    } else if (distance > 50) {
      camera.position.normalize().multiplyScalar(50);
    }
  }, [is3D]);

  useEffect(() => {
    const element = is3D ? mountRef.current : canvasRef.current;
    if (!element) return;

    const wheelHandler = is3D ? handleWheel3D : handleWheel;
    element.addEventListener('wheel', wheelHandler);
    return () => element.removeEventListener('wheel', wheelHandler);
  }, [handleWheel, handleWheel3D, is3D]);

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
      {/* 3D Mount Point */}
      <div
        ref={mountRef}
        className={`fixed top-0 left-0 w-full h-full ${is3D ? 'block' : 'hidden'}`}
        style={{ zIndex: 0 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* 2D Canvas */}
      <canvas
        ref={canvasRef}
        className={`block ${is3D ? 'hidden' : 'block'}`}
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
      
      {/* 3D/2D Toggle and Controls */}
      <div className="fixed top-6 left-6 z-10 bg-black bg-opacity-80 text-white p-3 rounded-lg">
        <div className="text-sm font-bold mb-2">View Mode</div>
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setIs3D(false)}
            className={`px-3 py-1 rounded text-xs ${!is3D ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`}
          >
            2D
          </button>
          <button
            onClick={() => setIs3D(true)}
            className={`px-3 py-1 rounded text-xs ${is3D ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`}
          >
            3D
          </button>
        </div>
        
        {is3D && (
          <>
            {/* Resolution Slider */}
            <div className="mb-3 border-t border-gray-600 pt-3">
              <div className="text-xs font-bold mb-2">Resolution: {resolution}x{resolution}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs">Low</span>
                <input
                  type="range"
                  min="32"
                  max="512"
                  step="32"
                  value={resolution}
                  onChange={(e) => setResolution(parseInt(e.target.value))}
                  className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                  style={{
                    background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((resolution - 32) / (512 - 32)) * 100}%, #4b5563 ${((resolution - 32) / (512 - 32)) * 100}%, #4b5563 100%)`
                  }}
                />
                <span className="text-xs">High</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {resolution <= 64 && "⚡ Fast"}
                {resolution > 64 && resolution <= 256 && "⚖️ Balanced"}
                {resolution > 256 && "🎯 Detailed"}
              </div>
            </div>
            
            {/* Lighting Controls */}
            <div className="mb-3 border-t border-gray-600 pt-3">
              <div className="text-xs font-bold mb-2">🔆 Lighting</div>
              
              {/* Light Intensity */}
              <div className="mb-2">
                <div className="text-xs mb-1">Intensity: {lightSettings.intensity.toFixed(1)}</div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={lightSettings.intensity}
                  onChange={(e) => setLightSettings(prev => ({ ...prev, intensity: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* Light Position X */}
              <div className="mb-2">
                <div className="text-xs mb-1">X Position: {lightSettings.x.toFixed(0)}</div>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="1"
                  value={lightSettings.x}
                  onChange={(e) => setLightSettings(prev => ({ ...prev, x: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* Light Position Y */}
              <div className="mb-2">
                <div className="text-xs mb-1">Y Position: {lightSettings.y.toFixed(0)}</div>
                <input
                  type="range"
                  min="2"
                  max="30"
                  step="1"
                  value={lightSettings.y}
                  onChange={(e) => setLightSettings(prev => ({ ...prev, y: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* Light Position Z */}
              <div className="mb-2">
                <div className="text-xs mb-1">Z Position: {lightSettings.z.toFixed(0)}</div>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="1"
                  value={lightSettings.z}
                  onChange={(e) => setLightSettings(prev => ({ ...prev, z: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* Light Color */}
              <div className="mb-2">
                <div className="text-xs mb-1">Color</div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={lightSettings.color}
                    onChange={(e) => setLightSettings(prev => ({ ...prev, color: e.target.value }))}
                    className="w-8 h-6 rounded border-none cursor-pointer"
                  />
                  <span className="text-xs text-gray-300">{lightSettings.color}</span>
                </div>
              </div>

              {/* Reset Button */}
              <button
                onClick={() => setLightSettings({ intensity: 0.8, x: 10, y: 10, z: 5, color: '#ffffff' })}
                className="w-full bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded text-xs"
              >
                Reset Light
              </button>
            </div>

            {/* Controls */}
            <div className="text-xs text-gray-400 border-t border-gray-600 pt-2">
              <div>🖱️ Drag to rotate</div>
              <div>🔍 Scroll to zoom</div>
            </div>
          </>
        )}
      </div>

      {/* Selection Rectangle (2D only) */}
      {isSelecting && selectionRect && !is3D && (
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

      {/* Bookmarks Panel (2D only) */}
      {bookmarks.length > 0 && !is3D && (
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
      
      {/* Instructions overlay when no bookmarks (2D only) */}
      {bookmarks.length === 0 && !is3D && (
        <div className="fixed top-6 right-6 z-10 bg-black bg-opacity-70 text-white p-3 rounded-lg text-sm">
          <div className="text-yellow-400 mb-1">📍 Create Bookmarks</div>
          <div className="text-xs">Hold Shift + drag to select areas</div>
        </div>
      )}

      {/* Render Info Overlay */}
      <div className="fixed bottom-6 right-6 z-10 bg-black bg-opacity-70 text-white p-3 rounded-lg font-mono text-sm">
        <div className="text-xs opacity-75 mb-1">Render Info</div>
        <div>Mode: {is3D ? '3D Height Map' : '2D Fractal'}</div>
        <div>X: {viewState.centerX.toFixed(6)}</div>
        <div>Y: {viewState.centerY.toFixed(6)}</div>
        <div>Zoom: {viewState.zoom.toFixed(2)}x</div>
        {is3D && <div>Mesh: {resolution}x{resolution}</div>}
        <div className="text-xs opacity-75 mt-1">
          {is3D ? '🎮 Three.js' : (supportsWebGPU ? '🚀 WebGPU' : '🐌 CPU')}
        </div>
      </div>
    </>
  );
}
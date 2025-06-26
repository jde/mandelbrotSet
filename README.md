# WebGL Fractal Explorer 🌌

An interactive 3D fractal visualization experiment using WebGL, WebGPU, and physics simulation.

## Features 🚀

### Multi-Mode Rendering
- **2D Mode**: High-performance fractal rendering with WebGPU/Canvas fallback
- **3D Mode**: Real-time height-mapped fractal terrain with Three.js
- **Smart Fallback**: WebGPU → CPU Canvas for maximum compatibility

### Interactive 3D Experience
- **Dynamic Resolution**: 32x32 to 512x512 mesh detail slider
- **Advanced Lighting**: Controllable directional light with position, intensity, and color
- **Physics Simulation**: Bouncing balls with realistic gravity and collision detection
- **Camera Controls**: Orbital camera with mouse drag and scroll zoom

### Fractal Navigation
- **Bookmark System**: Draw rectangles to save interesting fractal locations
- **Smooth Animation**: Animated transitions between bookmarked areas
- **Real-time Exploration**: Pan, zoom, and explore the Mandelbrot set
- **Persistent Storage**: Bookmarks saved to localStorage

### Technical Stack
- **Next.js 15** with React 19
- **Three.js** for 3D rendering and WebGL
- **WebGPU** for high-performance 2D fractal computation
- **Cannon.js** for physics simulation
- **TailwindCSS** for UI styling

## Development 🛠️

```bash
npm install
npm run dev
```

Open [http://localhost:4242](http://localhost:4242) to explore the fractal universe!

## Usage 🎮

### 2D Mode
- **Mouse**: Drag to pan, scroll to zoom
- **Shift + Drag**: Create bookmarks by drawing rectangles
- **Bookmarks**: Click "Go" to animate to saved locations

### 3D Mode  
- **Mouse**: Drag to rotate camera, scroll to zoom
- **Resolution Slider**: Adjust mesh detail (performance vs quality)
- **Lighting Controls**: Position and customize the light source
- **Physics Toggle**: Enable/disable bouncing ball simulation

## Performance 📊

The application automatically selects the best rendering method:
1. **WebGPU** (fastest) - Modern browsers with experimental features
2. **CPU Canvas** (fallback) - Universal compatibility

3D mode uses WebGL through Three.js for hardware-accelerated rendering.

---

*An experiment in mathematical visualization, interactive graphics, and web performance optimization.*

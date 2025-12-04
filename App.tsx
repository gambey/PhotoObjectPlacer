import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToolType, Transform, AppState, ObjectSource } from './types';
import { BrushIcon, HandIcon, UndoIcon, ResetIcon, DownloadIcon, UploadIcon, MagicIcon } from './components/Icons';
import { generateImageFromText, placeObjectInImage, eraseObjectInImage } from './services/geminiService';
import { ComparisonSlider } from './components/ComparisonSlider';

// Helper to resize image to match target dimensions
const resizeImage = (base64Str: string, width: number, height: number): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      } else {
        resolve(base64Str);
      }
    };
    img.src = base64Str;
  });
};

function App() {
  // --- State ---
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [baseImage, setBaseImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  
  // Canvas State
  const [tool, setTool] = useState<ToolType>(ToolType.BRUSH);
  const [brushSize, setBrushSize] = useState<number>(30);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [history, setHistory] = useState<ImageData[]>([]);
  const [isHoveringCanvas, setIsHoveringCanvas] = useState(false);
  
  // Object Placement State
  const [objectMode, setObjectMode] = useState<'upload' | 'text'>('upload');
  const [objectSource, setObjectSource] = useState<ObjectSource | null>(null);
  const [textPrompt, setTextPrompt] = useState<string>('');
  const [isGeneratingObject, setIsGeneratingObject] = useState(false);

  // Model Selection
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-pro-image-preview');

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null); // Off-screen canvas for mask
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // --- Initialization ---

  // Initialize mask canvas when base image loads
  useEffect(() => {
    if (baseImage && !maskCanvasRef.current) {
      const img = new Image();
      img.onload = () => {
        const mc = document.createElement('canvas');
        mc.width = img.width;
        mc.height = img.height;
        const ctx = mc.getContext('2d');
        if(ctx) {
           // Initialize transparent
           ctx.clearRect(0,0, mc.width, mc.height);
           setHistory([ctx.getImageData(0, 0, mc.width, mc.height)]);
        }
        maskCanvasRef.current = mc;
        fitImageToScreen(img.width, img.height);
        draw();
      };
      img.src = baseImage;
    }
  }, [baseImage]);

  const fitImageToScreen = (w: number, h: number) => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const padding = 40;
    
    const scale = Math.min((cw - padding) / w, (ch - padding) / h);
    setTransform({
      x: (cw - w * scale) / 2,
      y: (ch - h * scale) / 2,
      k: scale
    });
  };

  // --- Canvas Logic ---

  const getMaskContext = () => maskCanvasRef.current?.getContext('2d', { willReadFrequently: true });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !baseImage || !maskCanvasRef.current) return;

    // Clear Screen
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Apply Transform
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Draw Base Image
    const img = new Image();
    img.src = baseImage;
    // Note: In a real high-perf app, we wouldn't create new Image() every frame, 
    // but for React state simplicity in this prototype, we rely on browser cache.
    // Ideally store HTMLImageElement in a ref.
    if (img.complete) {
        ctx.drawImage(img, 0, 0);
        
        // Draw Mask Overlay (Uniform Red semi-transparent)
        if (maskCanvasRef.current) {
            ctx.save();
            ctx.globalAlpha = 0.5; // Apply opacity to the entire mask layer
            ctx.drawImage(maskCanvasRef.current, 0, 0);
            ctx.restore();
        }
    } else {
        img.onload = () => {
            ctx.drawImage(img, 0, 0);
            if (maskCanvasRef.current) {
                ctx.save();
                ctx.globalAlpha = 0.5;
                ctx.drawImage(maskCanvasRef.current, 0, 0);
                ctx.restore();
            }
        }
    }

    ctx.restore();
  }, [baseImage, transform]);

  useEffect(() => {
    draw();
  }, [draw, transform, history]); // Redraw on changes

  // Resize observer for canvas resolution
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        draw();
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [draw, appState]); // Added appState dependency to re-init canvas when returning from Comparison

  // --- Interaction Handlers ---

  const getImageCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    
    // Invert transform to get image space coords
    return {
      x: (cx - transform.x) / transform.k,
      y: (cy - transform.y) / transform.k
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (appState !== AppState.IDLE) return;
    
    isDraggingRef.current = true;
    const coords = getImageCoords(e);
    lastPosRef.current = { x: e.clientX, y: e.clientY };

    if (tool === ToolType.BRUSH && maskCanvasRef.current) {
      paintMask(coords.x, coords.y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // Update Custom Cursor Position
    if (cursorRef.current) {
      cursorRef.current.style.left = `${e.clientX}px`;
      cursorRef.current.style.top = `${e.clientY}px`;
    }

    if (!isDraggingRef.current) return;

    if (tool === ToolType.HAND) {
      const dx = e.clientX - (lastPosRef.current?.x || e.clientX);
      const dy = e.clientY - (lastPosRef.current?.y || e.clientY);
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    } else if (tool === ToolType.BRUSH) {
      const coords = getImageCoords(e);
      paintMask(coords.x, coords.y);
    }
  };

  const handleMouseUp = () => {
    if (isDraggingRef.current && tool === ToolType.BRUSH) {
        saveHistory();
    }
    isDraggingRef.current = false;
    lastPosRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (appState !== AppState.IDLE) return;
    e.preventDefault(); 
    
    const zoomIntensity = 0.1;
    const delta = e.deltaY > 0 ? (1 - zoomIntensity) : (1 + zoomIntensity);
    
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setTransform(prev => {
        const newK = Math.max(0.1, Math.min(prev.k * delta, 5));
        const kRatio = newK / prev.k;
        
        return {
            x: mouseX - (mouseX - prev.x) * kRatio,
            y: mouseY - (mouseY - prev.y) * kRatio,
            k: newK
        };
    });
  };

  const paintMask = (x: number, y: number) => {
    const ctx = getMaskContext();
    if (!ctx) return;

    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    // Use solid red. Transparency is handled in global draw() to ensure uniform opacity.
    ctx.fillStyle = '#ff0000'; 
    ctx.fill();
    draw();
  };

  const saveHistory = () => {
    const ctx = getMaskContext();
    if (ctx && maskCanvasRef.current) {
        const data = ctx.getImageData(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
        setHistory(prev => [...prev.slice(-10), data]); // Keep last 10
    }
  };

  const handleUndo = () => {
    if (history.length <= 1) return; // Always keep initial clear state
    const newHistory = [...history];
    newHistory.pop(); // Remove current
    const previousState = newHistory[newHistory.length - 1];
    setHistory(newHistory);
    
    const ctx = getMaskContext();
    if (ctx && previousState) {
        ctx.putImageData(previousState, 0, 0);
        draw();
    }
  };

  const handleResetMask = () => {
      const ctx = getMaskContext();
      if(ctx && maskCanvasRef.current) {
          ctx.clearRect(0,0, maskCanvasRef.current.width, maskCanvasRef.current.height);
          saveHistory();
          draw();
      }
  };

  // --- Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'SELECT') return;

      const key = e.key.toLowerCase();

      if (key === 'b') setTool(ToolType.BRUSH);
      if (key === 'h') setTool(ToolType.HAND);
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault();
        handleUndo();
      }

      // Brush resizing shortcuts
      if (tool === ToolType.BRUSH) {
        if (e.key === '[' || e.key === '-') {
          setBrushSize(prev => Math.max(5, prev - 5));
        }
        if (e.key === ']' || e.key === '=') {
          setBrushSize(prev => Math.min(100, prev + 5));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, tool]);

  // --- File Handling ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isBase: boolean = true) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (typeof evt.target?.result === 'string') {
          if (isBase) {
            setBaseImage(evt.target.result);
            setProcessedImage(null);
            setAppState(AppState.IDLE);
            maskCanvasRef.current = null; // Force reset mask canvas
            setHistory([]);
          } else {
            setObjectSource({ type: 'image', data: evt.target.result, previewUrl: evt.target.result });
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleDrop = (e: React.DragEvent, isBase: boolean = true) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (evt) => {
            if (typeof evt.target?.result === 'string') {
                 if (isBase) {
                    setBaseImage(evt.target.result);
                    setProcessedImage(null);
                    setAppState(AppState.IDLE);
                    maskCanvasRef.current = null;
                    setHistory([]);
                 } else {
                    setObjectSource({ type: 'image', data: evt.target.result, previewUrl: evt.target.result });
                 }
            }
        };
        reader.readAsDataURL(file);
      }
  };

  // --- AI Operations ---
  
  const handleGenerateObject = async () => {
      if (!textPrompt.trim()) return;
      setIsGeneratingObject(true);
      try {
          const base64Image = await generateImageFromText(textPrompt);
          setObjectSource({ type: 'text', data: base64Image, previewUrl: base64Image });
      } catch (err) {
          alert('生成物体失败，请重试');
      } finally {
          setIsGeneratingObject(false);
      }
  };

  const getMaskDataUrl = () => {
    if (!maskCanvasRef.current) return null;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = maskCanvasRef.current.width;
    tempCanvas.height = maskCanvasRef.current.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return null;
    
    // Draw the current mask (red + transparent)
    ctx.drawImage(maskCanvasRef.current, 0, 0);
    
    // Create strict binary mask by manipulating pixel data
    // This avoids anti-aliasing issues where edges might be gray
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      // If pixel is even slightly visible (painted), make it solid White
      if (alpha > 0) {
        data[i] = 255;     // R
        data[i + 1] = 255; // G
        data[i + 2] = 255; // B
        data[i + 3] = 255; // A (Fully Opaque)
      } else {
        // Otherwise make it solid Black
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255; // A (Fully Opaque)
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    return tempCanvas.toDataURL('image/png');
  };

  const handlePlaceObject = async () => {
    if (!baseImage || !objectSource || !maskCanvasRef.current) {
        alert("请确保已有底图、蒙版区域和放置物体");
        return;
    }
    
    setAppState(AppState.PROCESSING);

    try {
        const maskDataUrl = getMaskDataUrl();
        if (!maskDataUrl) throw new Error("Failed to generate mask");

        // Call API with selected model
        const resultImage = await placeObjectInImage(baseImage, maskDataUrl, objectSource.data, selectedModel);
        
        // Resize to match original dimensions
        const resizedImage = await resizeImage(resultImage, maskCanvasRef.current.width, maskCanvasRef.current.height);

        setProcessedImage(resizedImage);
        setAppState(AppState.COMPARING);

    } catch (error) {
        console.error(error);
        alert("放置失败，请检查网络或 Key");
        setAppState(AppState.IDLE);
    }
  };

  const handleErase = async () => {
    if (!baseImage || !maskCanvasRef.current) {
        alert("请确保已有底图和涂抹的蒙版区域");
        return;
    }

    setAppState(AppState.PROCESSING);
    
    try {
        const maskDataUrl = getMaskDataUrl();
        if (!maskDataUrl) throw new Error("Failed to generate mask");

        // Call API with selected model
        const resultImage = await eraseObjectInImage(baseImage, maskDataUrl, selectedModel);
        
        // Resize to match original dimensions
        const resizedImage = await resizeImage(resultImage, maskCanvasRef.current.width, maskCanvasRef.current.height);

        setProcessedImage(resizedImage);
        setAppState(AppState.COMPARING);

    } catch (error) {
        console.error(error);
        alert("擦除失败，请检查网络或 Key");
        setAppState(AppState.IDLE);
    }
  };

  const applyChanges = () => {
      if (processedImage) {
          setBaseImage(processedImage);
          setProcessedImage(null);
          setAppState(AppState.IDLE);
          handleResetMask();
      }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#18181b] text-gray-100 font-sans">
      
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-6 bg-[#27272a] border-b border-[#3f3f46] shrink-0 z-20">
        <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          图像物体放置 V1.0 <span className="text-xs text-gray-400 font-normal">By Gambey</span>
        </h1>
        <div className="text-xs text-gray-500">React + Gemini 2.5 Flash Image</div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Sidebar: Object Selection */}
        <div className="w-80 bg-[#27272a] border-r border-[#3f3f46] flex flex-col p-4 gap-6 shrink-0 z-10 overflow-y-auto">
             <div className="space-y-4">
                 <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">1. 待放置物体</h2>
                 
                 <div className="flex bg-[#18181b] p-1 rounded-lg border border-[#3f3f46]">
                     <button 
                        onClick={() => setObjectMode('upload')}
                        className={`flex-1 text-xs py-2 rounded-md transition-colors ${objectMode === 'upload' ? 'bg-[#3f3f46] text-white' : 'text-gray-400 hover:text-gray-200'}`}
                     >
                         上传图片
                     </button>
                     <button 
                        onClick={() => setObjectMode('text')}
                        className={`flex-1 text-xs py-2 rounded-md transition-colors ${objectMode === 'text' ? 'bg-[#3f3f46] text-white' : 'text-gray-400 hover:text-gray-200'}`}
                     >
                         文字生成
                     </button>
                 </div>

                 {objectMode === 'upload' ? (
                     <div 
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleDrop(e, false)}
                        className="border-2 border-dashed border-[#52525b] rounded-lg p-4 flex flex-col items-center justify-center min-h-[140px] hover:bg-[#3f3f46] transition-colors relative"
                     >
                         <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, false)} className="absolute inset-0 opacity-0 cursor-pointer" />
                         <UploadIcon />
                         <span className="mt-2 text-xs text-gray-400 text-center">点击或拖入图片<br/>作为放置对象</span>
                     </div>
                 ) : (
                     <div className="space-y-2">
                         <textarea 
                            value={textPrompt}
                            onChange={(e) => setTextPrompt(e.target.value)}
                            placeholder="描述物体，例如：一个红色的苹果"
                            className="w-full h-24 bg-[#18181b] border border-[#52525b] rounded-md p-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 resize-none"
                         />
                         <button 
                            onClick={handleGenerateObject}
                            disabled={isGeneratingObject || !textPrompt}
                            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs py-2 rounded-md transition-colors"
                         >
                             {isGeneratingObject ? '生成中...' : <><MagicIcon /> 生成物体</>}
                         </button>
                     </div>
                 )}

                 {objectSource && (
                     <div className="relative group">
                         <div className="text-xs text-gray-400 mb-1">当前选择:</div>
                         <img src={objectSource.previewUrl} alt="Object" className="w-full h-40 object-contain bg-[#18181b] rounded-md border border-[#52525b]" />
                         <button 
                            onClick={() => setObjectSource(null)}
                            className="absolute top-2 right-2 bg-red-500/80 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                         >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                         </button>
                     </div>
                 )}
             </div>

             <div className="h-px bg-[#3f3f46]"></div>
             
             <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">2. 操作步骤</h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                    1. 确保已选择"待放置物体"。<br/>
                    2. 在右侧画布上用画笔涂抹出放置区域。<br/>
                    3. 点击下方"开始放置"按钮。<br/>
                    4. 如需擦除，直接涂抹后点击"擦除"。
                </p>
             </div>
        </div>

        {/* Center Canvas */}
        <div 
            className="flex-1 relative bg-[#09090b] overflow-hidden" 
            ref={containerRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, true)}
        >
          {/* Custom Cursor */}
          <div 
              ref={cursorRef}
              className="fixed pointer-events-none rounded-full bg-yellow-400/50 -translate-x-1/2 -translate-y-1/2 z-50 transition-none"
              style={{
                  width: brushSize * transform.k,
                  height: brushSize * transform.k,
                  display: (tool === ToolType.BRUSH && isHoveringCanvas && appState === AppState.IDLE) ? 'block' : 'none',
                  willChange: 'left, top, width, height'
              }}
          />

          {appState === AppState.COMPARING && baseImage && processedImage ? (
             <ComparisonSlider beforeImage={baseImage} afterImage={processedImage} />
          ) : (
            <>
                <canvas 
                    ref={canvasRef}
                    className="block"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={(e) => {
                        handleMouseUp();
                        setIsHoveringCanvas(false);
                    }}
                    onMouseEnter={() => setIsHoveringCanvas(true)}
                    onWheel={handleWheel}
                    style={{ 
                        cursor: tool === ToolType.HAND ? 'grab' : (tool === ToolType.BRUSH ? 'none' : 'crosshair') 
                    }}
                />
                {!baseImage && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-gray-500">
                        <UploadIcon />
                        <p className="mt-4">拖入底图 或 点击工具栏上传</p>
                    </div>
                )}
            </>
          )}

          {appState === AppState.PROCESSING && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-50 backdrop-blur-sm">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <div className="text-white text-lg font-medium animate-pulse">AI 正在努力处理中...</div>
                  <div className="text-gray-400 text-sm mt-2">模型: {selectedModel}</div>
              </div>
          )}
        </div>

      </div>

      {/* Footer Toolbar */}
      <footer className="h-16 bg-[#27272a] border-t border-[#3f3f46] flex items-center justify-between px-8 shrink-0 z-20">
          
          {/* Left: Tools */}
          <div className="flex items-center gap-4">
             {appState !== AppState.COMPARING ? (
                <>
                    <input 
                        type="file" 
                        id="base-upload" 
                        className="hidden" 
                        accept="image/*" 
                        onChange={(e) => handleFileUpload(e, true)} 
                    />
                    <label 
                        htmlFor="base-upload" 
                        className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#3f3f46] hover:bg-[#52525b] cursor-pointer text-xs transition-colors"
                    >
                        <UploadIcon /> 底图
                    </label>

                    <div className="w-px h-8 bg-[#3f3f46] mx-2"></div>

                    <div className="flex bg-[#18181b] rounded-lg p-1 gap-1">
                        <button 
                            onClick={() => setTool(ToolType.BRUSH)}
                            className={`p-2 rounded ${tool === ToolType.BRUSH ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                            title="画笔 (B)"
                        >
                            <BrushIcon />
                        </button>
                        <button 
                            onClick={() => setTool(ToolType.HAND)}
                            className={`p-2 rounded ${tool === ToolType.HAND ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                            title="抓手 (H)"
                        >
                            <HandIcon />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                        <span className="text-xs text-gray-500">笔刷大小</span>
                        <input 
                            type="range" 
                            min="5" 
                            max="100" 
                            value={brushSize} 
                            onChange={(e) => setBrushSize(parseInt(e.target.value))}
                            className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>

                    <div className="flex gap-2 ml-4">
                        <button onClick={handleUndo} className="p-2 text-gray-400 hover:text-white transition-colors" title="撤销 (Ctrl+Z)">
                            <UndoIcon />
                        </button>
                        <button onClick={handleResetMask} className="p-2 text-gray-400 hover:text-white transition-colors" title="重置涂抹">
                            <ResetIcon />
                        </button>
                    </div>
                </>
             ) : (
                 <div className="text-sm text-gray-300">
                     对比模式：拖拽滑块查看效果
                 </div>
             )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-3">
              {appState === AppState.COMPARING ? (
                  <>
                    <button 
                        onClick={() => { setAppState(AppState.IDLE); setProcessedImage(null); }}
                        className="px-4 py-2 rounded-md border border-[#52525b] text-gray-300 hover:bg-[#3f3f46] text-sm transition-colors"
                    >
                        放弃
                    </button>
                    <button 
                        onClick={applyChanges}
                        className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors shadow-lg shadow-blue-900/20"
                    >
                        应用当前效果
                    </button>
                    <a 
                        href={processedImage!} 
                        download="result.png"
                        className="px-4 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm transition-colors flex items-center gap-2"
                    >
                        <DownloadIcon /> 下载
                    </a>
                  </>
              ) : (
                  <>
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="bg-[#3f3f46] hover:bg-[#52525b] text-white text-xs px-3 py-2 rounded border border-[#52525b] outline-none cursor-pointer"
                        title="选择 AI 模型"
                    >
                        <option value="gemini-3-pro-image-preview">Gemini 3 Pro (高精度)</option>
                        <option value="gemini-2.5-flash-image">Gemini 2.5 Flash (快速)</option>
                    </select>

                    <button 
                        onClick={handleErase}
                        disabled={!baseImage}
                        className="px-6 py-2 rounded-md bg-[#3f3f46] hover:bg-[#52525b] disabled:opacity-50 text-white font-medium text-sm transition-colors border border-[#52525b]"
                    >
                        擦除
                    </button>
                    <button 
                        onClick={handlePlaceObject}
                        disabled={!baseImage || !objectSource}
                        className="px-6 py-2 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white font-medium text-sm transition-all shadow-lg disabled:shadow-none"
                    >
                        开始放置
                    </button>
                  </>
              )}
          </div>
      </footer>
    </div>
  );
}

export default App;
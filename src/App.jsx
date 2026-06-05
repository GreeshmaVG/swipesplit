import React, { useState, useEffect, useRef } from 'react';
import { Download, Upload, Video, Layers, CheckCircle, AlertCircle, Loader2, ChevronRight, Share2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getVideoMetadata, captureFirstFrame } from './utils/videoMetadata';
import { loadFFmpeg } from './utils/ffmpegHelper';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { fetchFile } from '@ffmpeg/util';

// Utility for tailwind classes
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Robust download helper
const downloadBlob = async (blob, name) => {
  // 1. Try Native File System Access API (Premium Save As experience)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{
          description: name.endsWith('.zip') ? 'ZIP Archive' : 'Video File',
          accept: name.endsWith('.zip') ? {'application/zip': ['.zip']} : {'video/mp4': ['.mp4']},
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('File Picker failed, falling back...', err);
    }
  }

  // 2. Fallback to older link injection method
  const downloadLinkBlob = new Blob([blob], { type: 'application/octet-stream' });
  const url = window.URL.createObjectURL(downloadLinkBlob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
};

export default function App() {
  const [file, setFile] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [splitDirection, setSplitDirection] = useState('vertical'); // vertical = split along width
  const [splitMethod, setSplitMethod] = useState('blocks'); // blocks or width
  const [numBlocks, setNumBlocks] = useState(6);
  const [blockWidth, setBlockWidth] = useState(1080);
  const [instagramMode, setInstagramMode] = useState(true);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSlice, setCurrentSlice] = useState(0);
  const [totalSlices, setTotalSlices] = useState(0);
  const [generatedFiles, setGeneratedFiles] = useState([]);
  const [error, setError] = useState(null);
  const [isFFmpegLoaded, setIsFFmpegLoaded] = useState(false);
  const [isFFmpegLoading, setIsFFmpegLoading] = useState(false);
  const [sabSupported, setSabSupported] = useState(true);

  useEffect(() => {
    if (typeof SharedArrayBuffer === 'undefined') {
      setSabSupported(false);
    }
  }, []);

  const ffmpegRef = useRef(null);

  const onFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    if (!uploadedFile.type.startsWith('video/')) {
      setError('Please upload a valid video file.');
      return;
    }

    setFile(uploadedFile);
    setError(null);
    setGeneratedFiles([]);
    
    try {
      const meta = await getVideoMetadata(uploadedFile);
      setMetadata(meta);
      
      const frame = await captureFirstFrame(uploadedFile);
      setPreviewUrl(frame);

      // Reset block width if it exceeds video width
      if (meta.width < blockWidth) {
        setBlockWidth(Math.floor(meta.width / 2));
      }
    } catch (err) {
      setError('Error reading video metadata: ' + err);
    }
  };

  const initFFmpeg = async () => {
    if (isFFmpegLoaded) return;
    setIsFFmpegLoading(true);
    try {
      ffmpegRef.current = await loadFFmpeg(
        (msg) => console.log(msg),
        (p) => {
          // Inner progress not used directly
        }
      );
      setIsFFmpegLoaded(true);
    } catch (err) {
      setError('Failed to load FFmpeg: ' + err);
    } finally {
      setIsFFmpegLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!file || !metadata) return;
    
    setError(null);
    setProgress(0);
    setGeneratedFiles([]);

    try {
      if (!isFFmpegLoaded) {
        await initFFmpeg();
      }
      
      setIsProcessing(true);
      const ffmpeg = ffmpegRef.current;
      
      const totalSize = splitDirection === 'vertical' ? metadata.width : metadata.height;
      const step = splitMethod === 'blocks' ? Math.floor(totalSize / numBlocks) : blockWidth;
      const count = splitMethod === 'blocks' ? numBlocks : Math.ceil(totalSize / blockWidth);
      setTotalSlices(count);

      await ffmpeg.writeFile('input.mp4', await fetchFile(file));

      const newFiles = [];
      for (let i = 0; i < count; i++) {
        setCurrentSlice(i + 1);
        setProgress(Math.round((i / count) * 100));

        const start = i * step;
        let currentStep = step;
        
        if (i === count - 1) {
          currentStep = totalSize - start;
        }

        const outputName = `slide_${i + 1}.mp4`;
        const cropFilter = splitDirection === 'vertical' 
          ? `crop=${currentStep}:${metadata.height}:${start}:0`
          : `crop=${metadata.width}:${currentStep}:0:${start}`;

        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-vf', cropFilter,
          '-c:v', 'libx264',
          '-crf', '17',           // High quality (visually lossless)
          '-preset', 'superfast', // Better compression than ultrafast
          '-profile:v', 'high',   // High profile for better detail
          '-pix_fmt', 'yuv420p',  // Keep compatibility
          '-c:a', 'copy',
          outputName
        ]);

        console.log(`Finished slice ${i + 1}`);
        const data = await ffmpeg.readFile(outputName);
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        
        newFiles.push({
          name: outputName,
          blob: blob,
          url: url
        });
        
        setProgress(Math.round(((i + 1) / count) * 100));
      }

      setGeneratedFiles(newFiles);
    } catch (err) {
      console.error(err);
      setError('Processing failed: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadAll = async () => {
    try {
      const zip = new JSZip();
      generatedFiles.forEach((f) => {
        zip.file(f.name, f.blob);
      });
      const content = await zip.generateAsync({ type: 'blob' });
      downloadBlob(content, 'swipesplit-export.zip');
    } catch (err) {
      setError('Failed to generate ZIP: ' + err);
    }
  };

  // Helper to get suggested blocks for Instagram
  const getSuggestions = () => {
    if (!metadata || splitDirection !== 'vertical') return [];
    const ratios = [
      { name: '4:5 (Standard)', ratio: 4/5 },
      { name: '1:1 (Square)', ratio: 1/1 },
    ];
    
    // Width for a 4:5 slide with current height
    const targetWidth = Math.round(metadata.height * (4/5));
    const suggestedBlocks = Math.round(metadata.width / targetWidth);
    
    return [
      { blocks: Math.max(2, suggestedBlocks - 1), label: `${suggestedBlocks - 1} Slides` },
      { blocks: suggestedBlocks, label: `${suggestedBlocks} Slides (Recommended)`, recommended: true },
      { blocks: suggestedBlocks + 1, label: `${suggestedBlocks + 1} Slides` },
    ];
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-blue-100 pb-20">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl text-white">
              <Share2 size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight">SwipeSplit</h1>
              <p className="text-sm text-neutral-500 font-medium">Instagram Carousel Splitter</p>
            </div>
          </div>
          <div className="hidden sm:block text-right">
            <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest bg-neutral-100 px-2 py-1 rounded">Private & Secure</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-8 space-y-8">
        {/* Intro */}
        <section className="text-center space-y-2">
          <h2 className="text-3xl font-black text-neutral-900">Split panoramic videos locally.</h2>
          <p className="text-neutral-500 max-w-xl mx-auto">
            No uploads. No servers. Everything runs entirely in your browser using FFmpeg technology.
          </p>
        </section>

        {!sabSupported && (
          <div className="bg-amber-50 border-2 border-amber-100 p-6 rounded-3xl flex items-center gap-4 text-amber-800 animate-pulse">
            <AlertCircle size={24} className="shrink-0" />
            <div className="flex-1 text-sm">
              <p className="font-black uppercase tracking-tight">Warning: Limited Browser Support</p>
              <p className="font-medium opacity-80">Your browser doesn't support SharedArrayBuffer. Processing might be extremely slow or fail. Please use a modern desktop browser like Chrome or Firefox.</p>
            </div>
          </div>
        )}

        {/* Upload Section */}
        <section className={cn(
          "bg-white border-2 border-dashed rounded-3xl p-8 transition-all",
          file ? "border-blue-200 bg-blue-50/30" : "border-neutral-200 hover:border-neutral-300"
        )}>
          {!file ? (
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="p-4 bg-white rounded-full shadow-sm">
                <Upload size={32} className="text-blue-600" />
              </div>
              <div className="text-center">
                <label className="cursor-pointer">
                  <span className="text-blue-600 font-bold hover:underline">Click to upload</span>
                  <span className="text-neutral-500"> or drag and drop</span>
                  <input type="file" className="hidden" accept="video/mp4,video/mov,video/webm" onChange={onFileUpload} />
                </label>
                <p className="text-xs text-neutral-400 mt-1 uppercase font-bold tracking-tighter">MP4, MOV, WEBM (UP TO 200MB RECOMMENDED)</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row items-center gap-6">
              {previewUrl && (
                <div className="relative group overflow-hidden rounded-xl border bg-black aspect-video w-full md:w-48 shrink-0">
                  <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-lg truncate max-w-[250px]">{file.name}</h3>
                  <button onClick={() => {setFile(null); setMetadata(null); setGeneratedFiles([]);}} className="text-neutral-400 hover:text-red-500 transition-colors">
                    <AlertCircle size={16} />
                  </button>
                </div>
                {metadata && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm font-medium">
                    <div className="flex flex-col">
                      <span className="text-neutral-400 text-xs uppercase">Resolution</span>
                      <span>{metadata.width} × {metadata.height}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-neutral-400 text-xs uppercase">Duration</span>
                      <span>{metadata.duration.toFixed(1)}s</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-neutral-400 text-xs uppercase">Size</span>
                      <span>{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-neutral-400 text-xs uppercase">Type</span>
                      <span>{file.type.split('/')[1].toUpperCase()}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {file && metadata && !isProcessing && generatedFiles.length === 0 && (
          <>
            {/* Settings & Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Settings */}
              <div className="space-y-6">
                <div className="bg-white rounded-3xl border p-6 space-y-6 shadow-sm">
                  <h3 className="font-extrabold flex items-center gap-2">
                    <Layers size={18} className="text-blue-600" />
                    Split Settings
                  </h3>
                  
                  {/* Direction */}
                  <div className="space-y-3">
                    <label className="text-sm font-bold text-neutral-500 uppercase tracking-wider">Direction</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setSplitDirection('vertical')}
                        className={cn(
                          "px-4 py-3 rounded-xl font-bold flex flex-col items-center gap-1 transition-all border-2",
                          splitDirection === 'vertical' ? "border-blue-600 bg-blue-50 text-blue-600" : "border-neutral-100 hover:border-neutral-200 text-neutral-400"
                        )}
                      >
                        <span className="text-lg">|||</span>
                        Vertical
                      </button>
                      <button 
                        onClick={() => setSplitDirection('horizontal')}
                        className={cn(
                          "px-4 py-3 rounded-xl font-bold flex flex-col items-center gap-1 transition-all border-2",
                          splitDirection === 'horizontal' ? "border-blue-600 bg-blue-50 text-blue-600" : "border-neutral-100 hover:border-neutral-200 text-neutral-400"
                        )}
                      >
                        <span className="rotate-90 text-lg">|||</span>
                        Horizontal
                      </button>
                    </div>
                  </div>

                  {/* Method */}
                  <div className="space-y-3">
                    <label className="text-sm font-bold text-neutral-500 uppercase tracking-wider">Split Method</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer font-bold">
                        <input type="radio" checked={splitMethod === 'blocks'} onChange={() => setSplitMethod('blocks')} className="w-4 h-4 accent-blue-600" />
                        By Blocks
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer font-bold">
                        <input type="radio" checked={splitMethod === 'width'} onChange={() => setSplitMethod('width')} className="w-4 h-4 accent-blue-600" />
                        By Size (px)
                      </label>
                    </div>
                    
                    {splitMethod === 'blocks' ? (
                      <div className="space-y-2">
                        <input 
                          type="range" min="2" max="20" value={numBlocks} 
                          onChange={(e) => setNumBlocks(parseInt(e.target.value))}
                          className="w-full accent-blue-600"
                        />
                        <div className="flex justify-between font-black text-xl">
                          <span>{numBlocks} Blocks</span>
                          <span className="text-neutral-400 font-medium text-sm">
                            {splitDirection === 'vertical' 
                              ? `${Math.floor(metadata.width / numBlocks)}px each`
                              : `${Math.floor(metadata.height / numBlocks)}px each`}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <input 
                          type="number" value={blockWidth} 
                          onChange={(e) => setBlockWidth(parseInt(e.target.value))}
                          className="w-full px-4 py-3 rounded-xl border-2 border-neutral-100 focus:border-blue-600 outline-none font-bold text-lg"
                        />
                        <div className="flex justify-between text-sm font-bold text-neutral-500">
                          <span>~{Math.ceil((splitDirection === 'vertical' ? metadata.width : metadata.height) / blockWidth)} segments</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Instagram Mode */}
                  <div className="pt-4 border-t space-y-4">
                    <label className="flex items-center justify-between cursor-pointer group">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-12 h-6 rounded-full p-1 transition-colors",
                          instagramMode ? "bg-blue-600" : "bg-neutral-200"
                        )}>
                          <div className={cn(
                            "w-4 h-4 bg-white rounded-full transition-transform",
                            instagramMode ? "translate-x-6" : ""
                          )} />
                        </div>
                        <span className="font-bold">Instagram Carousel Mode</span>
                      </div>
                      <input type="checkbox" checked={instagramMode} onChange={(e) => setInstagramMode(e.target.checked)} className="hidden" />
                    </label>

                    {instagramMode && splitDirection === 'vertical' && (
                      <div className="bg-neutral-50 p-4 rounded-2xl space-y-3">
                        <p className="text-xs font-bold text-neutral-400 uppercase">Suggested Slides</p>
                        <div className="flex flex-col gap-2">
                          {getSuggestions().map((s) => (
                            <button 
                              key={s.blocks}
                              onClick={() => {
                                setSplitMethod('blocks');
                                setNumBlocks(s.blocks);
                              }}
                              className={cn(
                                "text-left px-3 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-between",
                                numBlocks === s.blocks ? "bg-blue-600 text-white" : "hover:bg-neutral-100 text-neutral-600"
                              )}
                            >
                              {s.label}
                              {numBlocks === s.blocks && <ChevronRight size={14} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-3xl border p-6 shadow-sm space-y-4">
                  <h3 className="font-extrabold">Final Output</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-neutral-50 rounded-xl">
                      <p className="text-[10px] text-neutral-400 font-black uppercase">Videos</p>
                      <p className="text-xl font-black">{splitMethod === 'blocks' ? numBlocks : Math.ceil((splitDirection === 'vertical' ? metadata.width : metadata.height) / blockWidth)}</p>
                    </div>
                    <div className="p-3 bg-neutral-50 rounded-xl">
                      <p className="text-[10px] text-neutral-400 font-black uppercase">Resolution</p>
                      <p className="text-xl font-black">
                        {splitDirection === 'vertical' 
                          ? `${splitMethod === 'blocks' ? Math.floor(metadata.width / numBlocks) : blockWidth}×${metadata.height}`
                          : `${metadata.width}×${splitMethod === 'blocks' ? Math.floor(metadata.height / numBlocks) : blockWidth}`}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={handleGenerate}
                    disabled={isProcessing || isFFmpegLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {isFFmpegLoading ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        Loading FFmpeg...
                      </>
                    ) : (
                      <>
                        Generate Carousel
                        <ChevronRight size={20} />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div className="space-y-4">
                <div className="sticky top-24">
                  <div className="bg-white rounded-3xl border p-4 shadow-sm space-y-4">
                    <h3 className="font-extrabold px-2">Visual Preview</h3>
                    <div className="relative rounded-2xl overflow-hidden bg-neutral-900 border">
                      <img src={previewUrl} className="w-full h-auto opacity-80" alt="Video preview" />
                      
                      {/* Guides */}
                      <div className={cn(
                        "absolute inset-0 flex",
                        splitDirection === 'vertical' ? "flex-row" : "flex-col"
                      )}>
                        {Array.from({ length: (splitMethod === 'blocks' ? numBlocks : Math.ceil((splitDirection === 'vertical' ? metadata.width : metadata.height) / blockWidth)) }).map((_, i) => (
                          <div 
                            key={i} 
                            className={cn(
                              "border-white/40 flex items-center justify-center relative group",
                              splitDirection === 'vertical' ? "h-full border-r last:border-r-0" : "w-full border-b last:border-b-0",
                              "flex-1"
                            )}
                          >
                            <span className="bg-white/20 backdrop-blur-md rounded-full w-6 h-6 flex items-center justify-center text-[10px] font-black text-white border border-white/30">
                              {i + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="text-center text-xs text-neutral-400 font-bold uppercase tracking-tight">Slice Visualization (Frame 1)</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Processing State */}
        {isProcessing && (
          <section className="bg-white rounded-3xl border p-12 shadow-sm text-center space-y-8">
            <div className="relative inline-flex items-center justify-center">
              <Loader2 size={64} className="text-blue-600 animate-spin" />
              <span className="absolute text-sm font-black text-blue-600">{progress}%</span>
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black">Processing your video...</h3>
              <p className="text-neutral-500 font-medium">Generating slice {currentSlice} of {totalSlices}</p>
            </div>
            
            <div className="max-w-md mx-auto h-3 bg-neutral-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            
            <p className="text-xs text-neutral-400 font-bold uppercase">This may take a minute. Please keep this tab open.</p>
          </section>
        )}

        {/* Results Section */}
        {generatedFiles.length > 0 && !isProcessing && (
          <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-blue-600 rounded-3xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl shadow-blue-200">
              <div className="flex items-center gap-4">
                <div className="bg-white/20 p-3 rounded-2xl">
                  <CheckCircle size={32} />
                </div>
                <div>
                  <h3 className="text-2xl font-black">Split Complete!</h3>
                  <p className="font-medium text-blue-100">{generatedFiles.length} videos generated successfully.</p>
                </div>
              </div>
              <button 
                onClick={downloadAll}
                className="bg-white text-blue-600 hover:bg-blue-50 px-8 py-4 rounded-2xl font-black flex items-center gap-2 transition-all active:scale-95 shadow-lg"
              >
                <Download size={20} />
                Download All (ZIP)
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {generatedFiles.map((file, idx) => (
                <div key={idx} className="bg-white border rounded-2xl p-3 space-y-3 group hover:border-blue-300 transition-all">
                  <div className="aspect-square bg-neutral-100 rounded-xl overflow-hidden relative">
                    <video src={file.url} className="w-full h-full object-cover pointer-events-none" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-all gap-2">
                       <button 
                         onClick={() => downloadBlob(file.blob, file.name)} 
                         className="p-3 bg-white rounded-xl text-blue-600 shadow-xl scale-90 group-hover:scale-100 transition-all font-black flex items-center gap-2 hover:bg-blue-50 active:scale-95"
                       >
                         <Download size={18} />
                         Save MP4
                       </button>
                    </div>
                  </div>
                  <p className="text-xs font-bold text-center truncate">{file.name}</p>
                </div>
              ))}
            </div>

            <div className="text-center">
              <button 
                onClick={() => {
                  setGeneratedFiles([]);
                  setFile(null);
                  setMetadata(null);
                }}
                className="text-neutral-400 font-bold text-sm hover:text-neutral-600 underline"
              >
                Split another video
              </button>
            </div>
          </section>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border-2 border-red-100 p-6 rounded-3xl flex items-center gap-4 text-red-700">
            <AlertCircle size={24} className="shrink-0" />
            <div className="flex-1">
              <p className="font-black">Something went wrong</p>
              <p className="text-sm font-medium opacity-80">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-sm font-black hover:underline uppercase">Dismiss</button>
          </div>
        )}
      </main>

      <footer className="max-w-4xl mx-auto px-6 mt-12 py-8 border-t text-neutral-400">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs font-bold uppercase tracking-widest">© 2026 SwipeSplit · No cookies · No tracking</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-blue-600 transition-colors">
              <Video size={18} />
            </a>
            <a href="#" className="hover:text-blue-600 transition-colors">
              <Share2 size={18} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";
import { Upload, Music, Play, Pause, Trash2, Download, ListPlus, Link as LinkIcon, Loader2, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";

// NOTE: This app is designed to be LEGAL-SAFE. Do not use for YouTube ripping or any site/content you don't have rights to.
// Users should only upload their own files or files they have explicit permission to convert. You can deploy on static hosting.

const ffmpeg = createFFmpeg({ log: false });

function bytesToSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"]; 
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function useFFmpeg() {
  const [ready, setReady] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Initializing media engine…");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoadingMessage("Downloading ffmpeg.wasm (~25–30MB) – one time per browser cache…");
        await ffmpeg.load();
        if (!mounted) return;
        setReady(true);
      } catch (e) {
        console.error(e);
        setLoadingMessage("Failed to initialize ffmpeg. Try refreshing the page.");
      }
    })();
    return () => { mounted = false; };
  }, []);

  return { ready, loadingMessage };
}

const ACCEPTED_VIDEO = [
  ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".mpg", ".mpeg", ".wmv", ".flv"
];

function isAcceptedFile(file) {
  const name = file?.name?.toLowerCase?.() || "";
  return ACCEPTED_VIDEO.some(ext => name.endsWith(ext));
}

export default function App() {
  const { ready, loadingMessage } = useFFmpeg();
  const [items, setItems] = useState([]); // { id, file, source, name, size, status, progress, mp3Blob, error }
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [convertingAll, setConvertingAll] = useState(false);

  const fileInputRef = useRef(null);

  function addFiles(files) {
    const next = [];
    for (const f of files) {
      if (!isAcceptedFile(f)) continue;
      next.push({
        id: crypto.randomUUID(),
        file: f,
        source: "upload",
        name: f.name,
        size: f.size,
        status: "ready",
        progress: 0,
        mp3Blob: null,
        error: null,
      });
    }
    if (next.length) setItems(prev => [...prev, ...next]);
  }

  async function addUrl(u) {
    try {
      const url = u.trim();
      if (!url) return;
      // SECURITY & LEGAL NOTE: Only allow direct, CORS-enabled file URLs that the user has rights to use.
      // This is NOT for YouTube or any site that forbids downloading.
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok) throw new Error("Could not access the URL");
      const type = res.headers.get("content-type") || "";
      const len = Number(res.headers.get("content-length") || 0);
      if (!type.includes("video") && !/\.\w+$/.test(url)) {
        throw new Error("URL doesn't look like a direct video file");
      }
      const nameGuess = url.split("/").pop()?.split("?")[0] || `video-${Date.now()}.mp4`;
      setItems(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          file: { name: nameGuess, url, remote: true, size: len },
          source: "url",
          name: nameGuess,
          size: len,
          status: "ready",
          progress: 0,
          mp3Blob: null,
          error: null,
        }
      ]);
      setUrlInput("");
    } catch (e) {
      alert(e.message || "Failed to add URL");
    }
  }

  async function fetchAsFile(item) {
    if (item.file.remote) {
      const resp = await fetch(item.file.url);
      if (!resp.ok) throw new Error("Failed to download remote file");
      const blob = await resp.blob();
      return new File([blob], item.name, { type: blob.type || "video/mp4" });
    }
    return item.file;
  }

  async function convertOne(itemId) {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, status: "fetching", progress: 0, error: null } : it));
    try {
      const item = items.find(it => it.id === itemId);
      const file = await fetchAsFile(item);

      setItems(prev => prev.map(it => it.id === itemId ? { ...it, status: "converting", progress: 0 } : it));

      const inputName = `input_${itemId}` + (file.name.includes(".") ? "" : ".mp4");
      const outputName = `output_${itemId}.mp3`;

      ffmpeg.FS("writeFile", inputName, await fetchFile(file));

      // Run ffmpeg to extract audio to MP3 (128k, joint stereo)
      // You can tweak the bitrate/channel/sample rate as needed.
      await ffmpeg.run(
        "-i", inputName,
        "-vn",
        "-acodec", "libmp3lame",
        "-b:a", "192k",
        outputName
      );

      const data = ffmpeg.FS("readFile", outputName);
      const mp3Blob = new Blob([data.buffer], { type: "audio/mpeg" });

      // Clean up FS to save memory
      try { ffmpeg.FS("unlink", inputName); } catch {}
      try { ffmpeg.FS("unlink", outputName); } catch {}

      setItems(prev => prev.map(it => it.id === itemId ? { ...it, status: "done", progress: 100, mp3Blob } : it));
    } catch (e) {
      console.error(e);
      setItems(prev => prev.map(it => it.id === itemId ? { ...it, status: "error", error: e?.message || "Conversion failed" } : it));
    }
  }

  async function convertAll() {
    setConvertingAll(true);
    for (const it of items) {
      if (it.status === "done") continue;
      // eslint-disable-next-line no-await-in-loop
      await convertOne(it.id);
    }
    setConvertingAll(false);
  }

  function removeItem(id) {
    setItems(prev => prev.filter(it => it.id !== id));
  }

  const totalSize = useMemo(() => items.reduce((acc, it) => acc + (it.size || 0), 0), [items]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-3xl md:text-4xl font-bold tracking-tight mb-2"
        >
          Client‑side Playlist Video → MP3 Converter
        </motion.h1>
        <p className="text-slate-600 mb-6">
          Convert videos you <span className="font-semibold">own or have permission to use</span> into MP3. All processing happens locally in your browser (WebAssembly), using your device & connection. 
          <span className="ml-1">Do <span className="font-semibold">NOT</span> use for YouTube or any site that forbids downloading.</span>
        </p>

        <div className="grid md:grid-cols-3 gap-4">
          <Card className="md:col-span-2 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" /> Add Videos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                onDragOver={(e)=>{e.preventDefault(); setDragOver(true);}}
                onDragLeave={()=>setDragOver(false)}
                onDrop={(e)=>{
                  e.preventDefault(); setDragOver(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={
                  "border-2 border-dashed rounded-2xl p-8 text-center transition " +
                  (dragOver ? "border-slate-800 bg-slate-100" : "border-slate-300 bg-white")
                }
              >
                <p className="mb-3">Drag & drop videos here</p>
                <p className="text-xs text-slate-500 mb-4">Accepted: {ACCEPTED_VIDEO.join(", ")}</p>
                <div className="flex items-center justify-center gap-3">
                  <Button onClick={() => fileInputRef.current?.click()}>
                    <ListPlus className="w-4 h-4 mr-2" /> Choose Files
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPTED_VIDEO.join(",")}
                    onChange={(e)=> addFiles(e.target.files)}
                    className="hidden"
                  />
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2 mb-2">
                  <LinkIcon className="w-4 h-4" />
                  <span className="text-sm">Add a direct video URL (CORS-enabled, legal to use)</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://example.com/path/video.mp4"
                    value={urlInput}
                    onChange={(e)=> setUrlInput(e.target.value)}
                  />
                  <Button variant="secondary" onClick={() => addUrl(urlInput)}>Add URL</Button>
                </div>
                <p className="text-xs text-slate-500 mt-2">Do not paste YouTube or other prohibited links. Only use material you have rights to.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Music className="w-5 h-5" /> Playlist Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-2">
                <Badge variant="secondary">Items: {items.length}</Badge>
                <Badge variant="secondary">Total size: {bytesToSize(totalSize)}</Badge>
              </div>
              <Button className="w-full" onClick={convertAll} disabled={!ready || !items.length || convertingAll}>
                {convertingAll ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Converting…</>
                ) : (
                  <><RefreshCw className="w-4 h-4 mr-2" /> Convert All to MP3</>
                )}
              </Button>
              {!ready && (
                <div className="text-xs text-slate-500 mt-3">{loadingMessage}</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-3">
          {items.map((it) => (
            <motion.div key={it.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="shadow-sm">
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium truncate">{it.name}</div>
                          <div className="text-xs text-slate-500">{bytesToSize(it.size || 0)} • Source: {it.source}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {it.status === "done" && it.mp3Blob && (
                            <a
                              href={URL.createObjectURL(it.mp3Blob)}
                              download={it.name.replace(/\.[^/.]+$/, "") + ".mp3"}
                            >
                              <Button size="sm" variant="secondary"><Download className="w-4 h-4 mr-1"/> Download MP3</Button>
                            </a>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => removeItem(it.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3">
                        <Progress value={it.status === "done" ? 100 : (it.status === "converting" || it.status === "fetching" ? 60 : 0)} />
                        <div className="flex items-center justify-between mt-1 text-xs text-slate-500">
                          <span>Status: {it.status}</span>
                          {it.error && <span className="text-red-600">{it.error}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => convertOne(it.id)} disabled={!ready || it.status === "converting"}>
                        {it.status === "converting" ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Play className="w-4 h-4 mr-2"/>}
                        {it.status === "done" ? "Reconvert" : "Convert"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <footer className="mt-10 text-xs text-slate-500">
          <p>
            ⚠️ Use only with content you own or have permission to convert. This app does not fetch or download from YouTube and is not a YouTube ripper.
          </p>
        </footer>
      </div>
    </div>
  );
}

import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const FFMPEG = "ffmpeg";

async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

app.get("/health", (_, res) => res.send("ok"));

app.post("/concat", async (req, res) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "urls must be a non-empty array" });
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-"));
    const listPath = path.join(dir, "list.txt");
    const outPath = path.join(dir, "final.mp4");
    
    const OUTPUTS_DIR = path.join(process.cwd(), "outputs");
    
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// URL로 접근 가능하게
app.use("/outputs", express.static(OUTPUTS_DIR));


    const files = [];
    for (let i = 0; i < urls.length; i++) {
      const f = path.join(dir, `clip_${String(i).padStart(3, "0")}.mp4`);
      await download(urls[i], f);
      files.push(f);
    }

    const listTxt = files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join("\n");
    fs.writeFileSync(listPath, listTxt);

    try {
      await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
    } catch {
      await runFFmpeg([
        "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        outPath
      ]);
    }

   // res.setHeader("Content-Type", "video/mp4");
   // res.setHeader("Content-Disposition", 'attachment; filename="final.mp4"');
   // fs.createReadStream(outPath).pipe(res);
        // 최종 파일을 /outputs 로 복사 (서빙 가능)
    const fileName = `final_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
    const publicPath = path.join(OUTPUTS_DIR, fileName);
    fs.copyFileSync(outPath, publicPath);

    // URL 반환
    const base = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
    return res.json({
      success: true,
      url: `${base}/outputs/${fileName}`,
      fileName
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("concat server on :" + PORT));
    // tmp 정리(선택)
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

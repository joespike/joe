import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const FFMPEG = "ffmpeg";
const PORT = process.env.PORT || 3000;

// ✅ outputs 폴더 전역 생성 + 정적 서빙 (여기서 1번만)
const OUTPUTS_DIR = path.join(process.cwd(), "outputs");
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
app.use("/outputs", express.static(OUTPUTS_DIR));

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
  let dir = null;
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "urls must be a non-empty array" });
    }

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-"));
    const listPath = path.join(dir, "list.txt");
    const outPath = path.join(dir, "final.mp4");

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

    // ✅ outputs로 복사
    const fileName = `final_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
    const publicPath = path.join(OUTPUTS_DIR, fileName);
    fs.copyFileSync(outPath, publicPath);

    // ✅ URL 만들기 (Render에서는 PUBLIC_BASE_URL 넣어둔 값 사용)
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

    return res.json({
      success: true,
      url: `${base}/outputs/${fileName}`,
      fileName
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    // ✅ tmp 정리 (return 해도 finally는 실행됨)
    if (dir) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
});

app.listen(PORT, () => console.log("concat server on :" + PORT));

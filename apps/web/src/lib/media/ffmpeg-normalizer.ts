import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;

export const loadFfmpeg = async (): Promise<FFmpeg> => {
	if (ffmpeg) return ffmpeg;
	ffmpeg = new FFmpeg();
	const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
	await ffmpeg.load({
		coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
		wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
	});
	return ffmpeg;
};

export const isProblematicFormat = (file: File): boolean => {
	if (!file.type.startsWith("video/")) return false;
	const name = file.name.toLowerCase();
	const isMov = name.endsWith(".mov");
	const isGoPro = name.match(/gh\d{2}|gx\d{2}|max\d{2}/i) !== null;
	return isMov || isGoPro;
};

export const normalizeVideo = async (
	file: File,
	onProgress?: (p: number) => void,
): Promise<File> => {
	const ff = await loadFfmpeg();

	ff.on("progress", ({ progress }) => {
		if (onProgress) onProgress(progress * 100);
	});

	await ff.writeFile("input", await fetchFile(file));

	// Convert to 1080p maximum to avoid WASM memory limits, encode using libx264
	await ff.exec([
		"-i",
		"input",
		"-vf",
		"scale='min(1920,iw)':min'(1080,ih)':force_original_aspect_ratio=decrease",
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-crf",
		"23",
		"-c:a",
		"aac",
		"-movflags",
		"+faststart",
		"output.mp4",
	]);

	const data = await ff.readFile("output.mp4");

	// Cleanup
	await ff.deleteFile("input");
	await ff.deleteFile("output.mp4");

	return new File([data], `normalized_${file.name.replace(/\.[^.]+$/, ".mp4")}`, {
		type: "video/mp4",
	});
};
